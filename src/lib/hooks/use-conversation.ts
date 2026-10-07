"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  parseChatStreamEvent,
  type ChatStreamError,
  type ChatStreamEvent,
  type ChatStreamMeta,
  type ChatTurn,
  type ChatUsage,
} from "@/lib/ai/chat-protocol";
import { sumUsage } from "@/lib/ai/usage";
import { conversationCache } from "./conversation-cache";

const ENDPOINT = "/api/chat";

export interface ConversationTurn extends ChatTurn {
  readonly usage?: ChatUsage | undefined;
}

export type UseConversation = {
  readonly turns: readonly ConversationTurn[];
  readonly isStreaming: boolean;
  readonly error: ChatStreamError | null;
  readonly activeModel: ChatStreamMeta | null;
  readonly conversationUsage: ChatUsage | null;
  readonly conversationId: string | null;
  send: (text: string) => void;
  stop: () => void;
  reset: () => void;
  loadConversation: (id: string) => Promise<void>;
  createConversation: () => Promise<string>;
  /** Warms the cache for a conversation without opening it. */
  prefetchConversation: (id: string) => void;
};

export type UseConversationOptions = {
  /**
   * Invoked once a conversation row exists in Supabase, so the
   * caller can show it immediately instead of on the next load.
   */
  readonly onConversationCreated?: (id: string) => void;
  /**
   * Invoked when a stream finishes — answered, failed or
   * stopped — for the conversation the exchange belongs to.
   * The user's message is already persisted at that point, so
   * a caller can refresh anything derived from the
   * conversation's record, such as its automatic title.
   */
  readonly onStreamComplete?: (conversationId: string) => void;
};

export function useConversation(
  options: UseConversationOptions = {},
): UseConversation {
  const { onConversationCreated, onStreamComplete } = options;

  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatStreamError | null>(null);
  const [activeModel, setActiveModel] = useState<ChatStreamMeta | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const turnsRef = useRef<readonly ConversationTurn[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  /** Texts sent before a conversation row could be created. */
  const pendingTurnsRef = useRef<readonly string[]>([]);
  /** The conversation the view is on, readable from async callbacks. */
  const conversationIdRef = useRef<string | null>(null);

  const commit = useCallback((next: readonly ConversationTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  /** Moves the view to a conversation (or to none), keeping the
   *  ref the async load paths read in step with the state. */
  const openConversation = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setConversationId(id);
  }, []);

  // Subscribes the hook to the conversation cache: a write — a
  // background revalidation landing, a prefetch completing, a
  // finished answer being cached — bumps the snapshot version
  // and re-renders here, where the effect below follows it.
  const cacheVersion = useSyncExternalStore(
    conversationCache.subscribe,
    conversationCache.getSnapshot,
  );

  // Keeps the view in step with the cache for the open
  // conversation. A cached entry renders the moment its
  // conversation is opened; this effect is what lands the
  // server's reconciliation — and any prefetch that completed
  // first — without the open having to wait for either.
  // Skipped while streaming, because the stream owns the
  // screen until it ends.
  useEffect(() => {
    if (conversationId === null || isStreaming) return;
    const cached = conversationCache.getTurns(conversationId);
    if (cached === undefined || sameTurns(turnsRef.current, cached)) return;
    commit(cached);
  }, [cacheVersion, conversationId, isStreaming, commit]);

  const loadConversation = useCallback(
    (id: string): Promise<void> => {
      setError(null);
      setActiveModel(null);
      setIsStreaming(false);
      // Switching away mid-stream cancels it: the answer the
      // user saw is still persisted, but no further deltas
      // belong to the conversation being left.
      controllerRef.current?.abort();
      controllerRef.current = null;
      pendingTurnsRef.current = [];

      // The conversation is open from this call onward: the
      // sidebar's active state follows immediately, and a
      // cached entry renders without waiting for the network.
      openConversation(id);
      const cached = conversationCache.getTurns(id);
      if (cached !== undefined && !sameTurns(turnsRef.current, cached)) {
        commit(cached);
      }

      // Revalidate in the background. The open does not wait
      // for it: a cold open keeps whatever is on screen —
      // the existing loading state — until the response
      // arrives and the cache subscription commits it.
      conversationCache.load(id, () => fetchConversationTurns(id)).catch(() => {
        // Nothing was cached and the server could not be
        // read: the existing failure behavior is an empty
        // conversation. A cached conversation survives a
        // failed revalidation with its cached turns.
        if (conversationIdRef.current === id && !conversationCache.has(id)) {
          commit([]);
          openConversation(null);
        }
      });

      return Promise.resolve();
    },
    [commit, openConversation],
  );

  /**
   * Warms the cache for a conversation without opening it,
   * so the click that follows renders from the cache. Called
   * from the sidebar on hover and focus; navigation itself
   * is unchanged. A prefetch that fails is silent: opening
   * the conversation starts the load again.
   */
  const prefetchConversation = useCallback((id: string) => {
    if (conversationCache.has(id) || conversationCache.isPending(id)) return;
    void conversationCache
      .load(id, () => fetchConversationTurns(id))
      .catch(() => {
        // Invisible by design: the next open retries.
      });
  }, []);

  const createConversation = useCallback(async (): Promise<string> => {
    const response = await fetch("/api/conversations", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("failed_to_create");
    }
    const data = (await response.json()) as { conversation: { id: string } };
    const id = data.conversation.id;
    openConversation(id);
    onConversationCreated?.(id);
    return id;
  }, [onConversationCreated, openConversation]);

  const persistMessage = useCallback(
    (conversationId: string, role: "user" | "assistant", content: string) => {
      fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content }),
      }).catch(() => {
        // Persistence failure is non-blocking.
      });
    },
    [],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text === "" || controllerRef.current !== null) return;

      let currentConversationId = conversationId;
      if (currentConversationId === null) {
        try {
          currentConversationId = await createConversation();
        } catch {
          // The conversation row could not be created, but the user's
          // words must survive: keep the turn on screen and queue its
          // text so the next successful create persists it too.
          const orphan: ConversationTurn = { id: newId(), role: "user", text };
          pendingTurnsRef.current = [...pendingTurnsRef.current, text];
          commit([...turnsRef.current, orphan]);
          setError({
            code: "PROVIDER_REQUEST_FAILED",
            message: "Could not create conversation.",
            retryable: true,
            detail: null,
          });
          return;
        }

        const pending = pendingTurnsRef.current;
        pendingTurnsRef.current = [];
        for (const pendingText of pending) {
          persistMessage(currentConversationId, "user", pendingText);
        }
      }

      const assistantId = newId();
      const history: ConversationTurn[] = [...turnsRef.current, { id: newId(), role: "user", text }];
      const controller = new AbortController();

      controllerRef.current = controller;
      setError(null);
      setActiveModel(null);
      setIsStreaming(true);
      commit([...history, { id: assistantId, role: "assistant", text: "" }]);
      persistMessage(currentConversationId, "user", text);

      let answer = "";
      let usage: ChatUsage | null = null;
      const rewrite = () => {
        const current = turnsRef.current;
        commit([
          ...current.slice(0, -1),
          { id: assistantId, role: "assistant", text: answer, ...(usage === null ? {} : { usage }) },
        ]);
      };
      const dropEmptyAnswer = () => {
        if (answer === "") commit(history);
      };

      void runRequest({
        history,
        controller,
        onDelta: (delta) => {
          answer += delta;
          rewrite();
        },
        onMeta: (model) => setActiveModel(model),
        onUsage: (reported) => {
          usage = reported;
          rewrite();
        },
      })
        .then((failure) => {
          dropEmptyAnswer();
          if (failure !== null) setError(failure);
        })
        .catch((cause: unknown) => {
          dropEmptyAnswer();
          if (controller.signal.aborted) return;
          setError({
            code: "PROVIDER_REQUEST_FAILED",
            message: "ORVYN could not reach the server.",
            retryable: true,
            detail: cause instanceof Error ? cause.message : null,
          });
        })
        .finally(() => {
          if (controllerRef.current === controller) {
            controllerRef.current = null;
            setIsStreaming(false);
          }

          // The user's message was persisted before the stream
          // started, whatever the outcome: the conversation's
          // record — its automatic title included — may have
          // changed since the view last looked.
          if (currentConversationId !== null) {
            onStreamComplete?.(currentConversationId);
          }

          // Persist even when a reset or navigation cleared the
          // controller mid-stream: the user saw this answer, so it
          // belongs in the conversation's record.
          if (currentConversationId && answer !== "") {
            persistMessage(currentConversationId, "assistant", answer);
            // The completed exchange is what the server will
            // hold, so this conversation opens from the cache
            // next time.
            conversationCache.setTurns(currentConversationId, [
              ...history,
              {
                id: assistantId,
                role: "assistant",
                text: answer,
                ...(usage === null ? {} : { usage }),
              },
            ]);
          }
        });
    },
    [commit, conversationId, createConversation, onStreamComplete, persistMessage],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsStreaming(false);
    setError(null);
    setActiveModel(null);
    openConversation(null);
    pendingTurnsRef.current = [];
    commit([]);
  }, [commit, openConversation]);

  return {
    turns,
    isStreaming,
    error,
    activeModel,
    conversationUsage: sumConversationUsage(turns),
    conversationId,
    send,
    stop,
    reset,
    loadConversation,
    createConversation,
    prefetchConversation,
  };
}

/**
 * The conversation's turns from the server, in the shape
 * the transcript renders. The same `GET /api/conversations/[id]`
 * endpoint as before — the cache changes when the conversation
 * is asked, not what is asked.
 */
async function fetchConversationTurns(
  id: string,
): Promise<readonly ConversationTurn[]> {
  const response = await fetch(`/api/conversations/${id}`);
  if (!response.ok) {
    throw new Error("failed_to_load");
  }
  const data = (await response.json()) as {
    conversation: { id: string };
    messages: Array<{ role: string; content: string }>;
  };

  return data.messages.map((msg) => ({
    id: newId(),
    role: msg.role as "user" | "assistant",
    text: msg.content,
  }));
}

/**
 * Whether two turn lists carry the same conversation content.
 * Turn ids are client-generated and change on every load, so
 * identity is compared on what the server knows: the roles
 * and texts, in order. This keeps a rendered conversation on
 * screen when a revalidation lands with the same content,
 * instead of remounting every turn with fresh ids.
 */
function sameTurns(
  previous: readonly ConversationTurn[],
  next: readonly ConversationTurn[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((turn, index) => {
    const other = next[index];
    return (
      other !== undefined && turn.role === other.role && turn.text === other.text
    );
  });
}

function sumConversationUsage(turns: readonly ConversationTurn[]): ChatUsage | null {
  const readings = turns
    .map((turn) => turn.usage)
    .filter((usage): usage is ChatUsage => usage !== undefined);
  if (readings.length === 0) return null;

  const summed = sumUsage(readings);
  if (summed.inputTokens === null || summed.outputTokens === null) return null;

  const total = summed.inputTokens + summed.outputTokens;
  return { inputTokens: summed.inputTokens, outputTokens: summed.outputTokens, totalTokens: total };
}

async function runRequest(input: {
  readonly history: readonly ConversationTurn[];
  readonly controller: AbortController;
  readonly onDelta: (text: string) => void;
  readonly onMeta: (model: ChatStreamMeta) => void;
  readonly onUsage: (usage: ChatUsage | null) => void;
}): Promise<ChatStreamError | null> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      turns: input.history.map(({ id, role, text }) => ({ id, role, text })),
    }),
    signal: input.controller.signal,
  });

  if (!response.ok) return readErrorBody(response);
  if (response.body === null) {
    return {
      code: "PROVIDER_REQUEST_FAILED",
      message: "The server returned an empty response.",
      retryable: true,
      detail: null,
    };
  }

  let failure: ChatStreamError | null = null;
  await readFrames(response.body, (event) => {
    if (event.type === "delta") input.onDelta(event.text);
    else if (event.type === "meta") input.onMeta(event.model);
    else if (event.type === "done") input.onUsage(event.usage);
    else if (event.type === "error") failure = event.error;
  });
  return failure;
}

async function readFrames(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const drain = (final: boolean) => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== "") emit(line, onEvent);
    }
    if (final && buffer.trim() !== "") emit(buffer.trim(), onEvent);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain(false);
    }
    drain(true);
  } finally {
    reader.releaseLock();
  }
}

function emit(line: string, onEvent: (event: ChatStreamEvent) => void): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return;
  }
  const event = parseChatStreamEvent(parsed);
  if (event !== null) onEvent(event);
}

async function readErrorBody(response: Response): Promise<ChatStreamError> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    const event = parseChatStreamEvent({ type: "error", error: parsed.error });
    if (event?.type === "error") return event.error;
  } catch {
    // Fall through to a status-derived default.
  }
  return {
    code: response.status >= 500 ? "PROVIDER_REQUEST_FAILED" : "INVALID_REQUEST",
    message: "The request could not be completed.",
    retryable: response.status >= 500,
    detail: `HTTP ${response.status}`,
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
