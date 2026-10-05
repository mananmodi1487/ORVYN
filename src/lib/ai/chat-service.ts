/**
 * Turns a validated `ChatRequest` into the client-facing event stream.
 *
 * Framework-light on purpose: it knows about the gateway and the wire protocol
 * but nothing about HTTP or Next.js, so the sequencing rules can be tested
 * directly. The route handler is then a thin translation to and from the Web
 * `Response` API.
 *
 * Selection and streaming are two separate calls, and that split is the point.
 * `selectChatModel` can fail before a response exists, so its failure becomes a
 * real HTTP status. `streamChatEvents` can only fail once bytes are on the wire,
 * so it reports a single terminal `error` frame instead. Without the split, a
 * missing model would be reported as `200 OK` with the error hidden in the body.
 */
import type { ChatStreamError, ChatStreamEvent } from "./chat-protocol";
import { isAiProviderError } from "./errors";
import type { AiGateway } from "./gateway";
import type { ChatRequest, FinishReason, ModelDescriptor, TokenUsage } from "./types";

/**
 * Person-readable failure text. Deliberately vague about cause: the client is
 * not the operator, and upstream error text can be arbitrary provider prose.
 */
const FAILURE_MESSAGE = {
  INVALID_REQUEST: "That message could not be sent.",
  MODEL_UNAVAILABLE: "That model is not available right now.",
  NO_ELIGIBLE_MODEL: "No AI model is available yet.",
  PROVIDER_UNAVAILABLE: "The AI provider is unavailable.",
  PROVIDER_REQUEST_FAILED: "The AI provider could not complete the request.",
} as const satisfies Readonly<Record<ChatStreamError["code"], string>>;

/** Projects any thrown value onto the one error shape the client understands. */
export function toChatStreamError(cause: unknown): ChatStreamError {
  if (isAiProviderError(cause)) {
    return {
      code: cause.code,
      message: FAILURE_MESSAGE[cause.code],
      retryable: cause.retryable,
      detail: cause.detail ?? null,
    };
  }
  // Anything else is an unexpected internal failure. Reported as an upstream
  // failure so the client retries rather than treating it as a bad request, and
  // without echoing the original error, which may carry request content.
  return {
    code: "PROVIDER_REQUEST_FAILED",
    message: FAILURE_MESSAGE.PROVIDER_REQUEST_FAILED,
    retryable: true,
    detail: "unexpected internal failure",
  };
}

export interface ChatStreamOptions {
  readonly signal?: AbortSignal | undefined;
}

/**
 * Chooses the model that will answer, or throws `AiProviderError`.
 *
 * Streaming is required unconditionally: this endpoint only ever streams, so a
 * non-streaming model must never be selected for it.
 */
export async function selectChatModel(
  gateway: AiGateway,
  request: ChatRequest,
): Promise<ModelDescriptor> {
  const { model } = await gateway.select({ ...request, requireStreaming: true });
  return model;
}

/**
 * Streams one assistant answer as `meta` → `delta`* → `done`, or a single
 * terminal `error`.
 *
 * The model is already known, so `meta` is emitted before the first token is
 * requested rather than being interleaved with it.
 *
 * The stream simply ends when `signal` aborts, with no `error` and no `done`:
 * the caller asked to stop, so either would be misleading.
 */
export async function* streamChatEvents(
  gateway: AiGateway,
  model: ModelDescriptor,
  request: ChatRequest,
  options: ChatStreamOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  yield metaEvent(model);
  if (isAborted(options.signal)) return;

  let usage: TokenUsage | null = null;
  let finishReason: FinishReason = "stop";

  try {
    const chunks = gateway.streamSelected(
      model,
      request,
      options.signal === undefined ? undefined : { signal: options.signal },
    );

    for await (const chunk of chunks) {
      if (chunk.type === "text") {
        yield { type: "delta", text: chunk.delta };
      } else if (chunk.type === "usage") {
        usage = chunk.usage;
      } else {
        finishReason = chunk.finishReason;
      }
    }

    // The provider ends iteration cleanly when the caller aborts, so the loop
    // exiting does not mean the answer completed. Reporting `done` here would
    // tell the client a truncated reply was a finished one.
    if (isAborted(options.signal)) return;

    yield { type: "done", finishReason, usage };
  } catch (cause) {
    // Re-read the signal here: control-flow narrowing from the guard above
    // would otherwise make this look impossible, though the abort can happen at
    // any point during iteration.
    if (isAborted(options.signal)) return;
    yield { type: "error", error: toChatStreamError(cause) };
  }
}

/**
 * Reads the current abort state.
 *
 * A function rather than an inline check so the value is re-read at the point of
 * use instead of being narrowed once at the top of the function.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function metaEvent(model: ModelDescriptor): ChatStreamEvent {
  return {
    type: "meta",
    model: {
      provider: model.provider,
      modelId: model.modelId,
      displayName: model.displayName,
    },
  };
}
