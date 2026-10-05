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

/**
 * A turn in the rendered conversation.
 *
 * `usage` exists only on assistant turns and only when the provider actually
 * reported it. It is never filled in locally: a turn without the field means the
 * upstream gave ORVYN no numbers, which the UI states rather than approximates.
 */
export interface ConversationTurn extends ChatTurn {
  readonly usage?: ChatUsage | undefined;
}

export type UseConversation = {
  readonly turns: readonly ConversationTurn[];
  readonly isStreaming: boolean;
  readonly error: ChatStreamError | null;
  /** The model the gateway actually selected, once the first frame arrives. */
  readonly activeModel: ChatStreamMeta | null;
  /** Running sum of every reported reading in this conversation. */
  readonly conversationUsage: ChatUsage | null;
  send: (text: string) => void;
  stop: () => void;
  reset: () => void;
};

/**
 * Owns one conversation's turns and the in-flight request.
 *
 * The turn list is held in a ref as well as state. Reading history from a
 * `setState` updater would be a side effect inside a function React may call
 * twice, so the ref is the source of truth and state is only the render copy.
 *
 * Deltas are applied as each frame arrives rather than at the end — buffering
 * them would make a streamed answer indistinguishable from a blocking one.
 *
 * Stopping is a real abort, not a UI flag: the request is cancelled, which ends
 * generation upstream instead of discarding tokens after paying for them.
 */
export function useConversation(): UseConversation {
  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatStreamError | null>(null);
  const [activeModel, setActiveModel] = useState<ChatStreamMeta | null>(null);

  const turnsRef = useRef<ConversationTurn[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: ConversationTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      // One request at a time: a second send would race the streaming update to
      // the shared turn list.
      if (text === "" || controllerRef.current !== null) return;

      const assistantId = newId();
      const history: ConversationTurn[] = [...turnsRef.current, { id: newId(), role: "user", text }];
      const controller = new AbortController();

      controllerRef.current = controller;
      setError(null);
      setActiveModel(null);
      setIsStreaming(true);
      commit([...history, { id: assistantId, role: "assistant", text: "" }]);

      // The assistant turn is always last while streaming, so the growing answer
      // is rewritten in place instead of appending a turn per token.
      let answer = "";
      let usage: ChatUsage | null = null;
      const rewrite = () => {
        const current = turnsRef.current;
        commit([
          ...current.slice(0, -1),
          { id: assistantId, role: "assistant", text: answer, ...(usage === null ? {} : { usage }) },
        ]);
      };
      /** A failed or cancelled turn leaves nothing behind when no text arrived. */
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
          // An abort is the user's own decision, not a failure to report.
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
          // A late settle from a superseded request must not clear the
          // controller belonging to the one now in flight.
          if (controllerRef.current === controller) {
            controllerRef.current = null;
            setIsStreaming(false);
          }
        });
    },
    [commit],
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
    commit([]);
  }, [commit]);

  return {
    turns,
    isStreaming,
    error,
    activeModel,
    conversationUsage: sumConversationUsage(turns),
    send,
    stop,
    reset,
  };
}

/**
 * Totals every reading the providers actually reported in this conversation.
 *
 * Returns `null` until at least one response reported usage, so an empty or
 * entirely unreported conversation shows "unavailable" rather than a confident 0.
 */
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

/**
 * Posts the conversation and reports each frame as it arrives.
 *
 * Resolves with the failure instead of rejecting it: a pre-stream HTTP error and
 * an in-band error frame carry the same shape, so there is one path to handle.
 * Only a transport failure rejects, and the caller reports that separately.
 */
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
    // Only the message itself is sent. Usage is a server-side accounting
    // concern and is never accepted back from the client.
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

/**
 * Reads newline-delimited JSON frames.
 *
 * Decoding is streamed and split on newlines rather than buffering the body, so
 * the first token renders while the rest is still arriving. A partial trailing
 * line is held back until its newline arrives.
 */
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
    // Releases the socket even when the caller stopped reading.
    reader.releaseLock();
  }
}

function emit(line: string, onEvent: (event: ChatStreamEvent) => void): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    // A frame that is not JSON is dropped rather than failing the request: the
    // stream may still carry a usable answer.
    return;
  }
  const event = parseChatStreamEvent(parsed);
  if (event !== null) onEvent(event);
}

/** Reads the route's pre-stream `{"error": {...}}` body. */
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
