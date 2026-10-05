"use client";

import { useCallback, useRef, useState } from "react";
import {
  parseChatStreamEvent,
  type ChatStreamError,
  type ChatStreamEvent,
  type ChatStreamMeta,
  type ChatTurn,
} from "@/lib/ai/chat-protocol";

const ENDPOINT = "/api/chat";

export type UseConversation = {
  readonly turns: readonly ChatTurn[];
  readonly isStreaming: boolean;
  readonly error: ChatStreamError | null;
  /** The model the gateway actually selected, once the first frame arrives. */
  readonly activeModel: ChatStreamMeta | null;
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
  const [turns, setTurns] = useState<readonly ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatStreamError | null>(null);
  const [activeModel, setActiveModel] = useState<ChatStreamMeta | null>(null);

  const turnsRef = useRef<ChatTurn[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: ChatTurn[]) => {
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
      const history: ChatTurn[] = [...turnsRef.current, { id: newId(), role: "user", text }];
      const controller = new AbortController();

      controllerRef.current = controller;
      setError(null);
      setActiveModel(null);
      setIsStreaming(true);
      commit([...history, { id: assistantId, role: "assistant", text: "" }]);

      // The assistant turn is always last while streaming, so the growing answer
      // is rewritten in place instead of appending a turn per token.
      let answer = "";
      const writeAnswer = (value: string) => {
        answer = value;
        const current = turnsRef.current;
        commit([...current.slice(0, -1), { id: assistantId, role: "assistant", text: value }]);
      };
      /** A failed or cancelled turn leaves nothing behind when no text arrived. */
      const dropEmptyAnswer = () => {
        if (answer === "") commit(history);
      };

      void runRequest({
        history,
        controller,
        onDelta: (delta) => writeAnswer(answer + delta),
        onMeta: (model) => setActiveModel(model),
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

  return { turns, isStreaming, error, activeModel, send, stop, reset };
}

/**
 * Posts the conversation and reports each frame as it arrives.
 *
 * Resolves with the failure instead of rejecting it: a pre-stream HTTP error and
 * an in-band error frame carry the same shape, so there is one path to handle.
 * Only a transport failure rejects, and the caller reports that separately.
 */
async function runRequest(input: {
  readonly history: readonly ChatTurn[];
  readonly controller: AbortController;
  readonly onDelta: (text: string) => void;
  readonly onMeta: (model: ChatStreamMeta) => void;
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
