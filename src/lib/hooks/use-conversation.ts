"use client";

import { useCallback, useRef, useState } from "react";
import {
  parseChatStreamEvent,
  type ChatStreamError,
  type ChatStreamEvent,
  type ChatStreamMeta,
  type ChatTurn,
  type ChatUsage,
} from "@/lib/ai/chat-protocol";
import { sumUsage } from "@/lib/ai/usage";

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
};

export function useConversation(): UseConversation {
  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatStreamError | null>(null);
  const [activeModel, setActiveModel] = useState<ChatStreamMeta | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const turnsRef = useRef<ConversationTurn[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: ConversationTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setError(null);
    setActiveModel(null);
    setIsStreaming(false);
    controllerRef.current?.abort();
    controllerRef.current = null;

    try {
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) {
        throw new Error("failed_to_load");
      }
      const data = (await response.json()) as {
        conversation: { id: string };
        messages: Array<{ role: string; content: string }>;
      };

      const loadedTurns: ConversationTurn[] = data.messages.map((msg) => ({
        id: newId(),
        role: msg.role as "user" | "assistant",
        text: msg.content,
      }));

      commit(loadedTurns);
      setConversationId(data.conversation.id);
    } catch {
      commit([]);
      setConversationId(null);
    }
  }, [commit]);

  const createConversation = useCallback(async (): Promise<string> => {
    const response = await fetch("/api/conversations", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("failed_to_create");
    }
    const data = (await response.json()) as { conversation: { id: string } };
    const id = data.conversation.id;
    setConversationId(id);
    return id;
  }, []);

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
          setError({
            code: "PROVIDER_REQUEST_FAILED",
            message: "Could not create conversation.",
            retryable: true,
            detail: null,
          });
          return;
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

            if (currentConversationId && answer !== "") {
              persistMessage(currentConversationId, "assistant", answer);
            }
          }
        });
    },
    [commit, conversationId, createConversation, persistMessage],
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
    setConversationId(null);
    commit([]);
  }, [commit]);

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
  };
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
