/**
 * Turns a validated `ChatRequest` into the client-facing event stream.
 *
 * Framework-light on purpose: it knows about the gateway and the wire protocol
 * but nothing about HTTP or Next.js, so the sequencing and fallback rules can be
 * tested directly. The route handler is then a thin translation to and from the
 * Web `Response` API.
 *
 * Two responsibilities, deliberately separated:
 * - `rankedCandidates` resolves what *may* answer. It fails before a response
 *   exists, so its failure becomes a real HTTP status.
 * - `streamChatEvents` generates. It can only fail once bytes are on the wire,
 *   so it reports a single terminal `error` frame instead.
 */
import type { ChatStreamError, ChatStreamEvent, ChatUsage } from "./chat-protocol";
import { NO_FREE_MODEL_DETAIL } from "./eligibility";
import { isAiProviderError, noEligibleModel, type AiProviderError } from "./errors";
import type { AiGateway } from "./gateway";
import type {
  ChatRequest,
  FinishReason,
  GenerationChunk,
  ModelDescriptor,
  TokenUsage,
} from "./types";
import { totalTokens } from "./usage";

/**
 * Person-readable failure text. Deliberately vague about cause: the client is
 * not the operator, and upstream error text can be arbitrary provider prose.
 */
const FAILURE_MESSAGE = {
  INVALID_REQUEST: "That message could not be sent.",
  MODEL_UNAVAILABLE: "That model is not available right now.",
  NO_ELIGIBLE_MODEL: "No free AI model is available yet.",
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
 * The model that would answer, without starting a generation.
 *
 * Used for pre-flight checks where a caller needs to know whether anything is
 * reachable before committing to a response. Prefer `rankedCandidates` when the
 * caller also needs the fallbacks behind this choice.
 *
 * @throws AiProviderError `NO_ELIGIBLE_MODEL` when no free model is eligible.
 */
export async function selectChatModel(
  gateway: AiGateway,
  request: ChatRequest,
): Promise<ModelDescriptor> {
  const [first] = await gateway.rankedCandidates(request);
  if (first === undefined) throw noEligibleModel(NO_FREE_MODEL_DETAIL);
  return first;
}

/** Mutable state carried across the chunks of one provider stream. */
interface StreamProgress {
  usage: TokenUsage | null;
  finishReason: FinishReason;
}

/**
 * Converts a provider reading into the wire shape, or `null` when incomplete.
 *
 * This is the only place a total is produced, and it refuses to add a known
 * output count to a missing input count.
 */
function toChatUsage(usage: TokenUsage | null): ChatUsage | null {
  if (usage === null) return null;
  const total = totalTokens(usage);
  if (total === null || usage.inputTokens === null || usage.outputTokens === null) return null;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: total };
}

/**
 * Converts a provider chunk into a client frame, accumulating the parts that are
 * reported once at the end.
 *
 * Usage and finish reason are provider-level summaries rather than content, so
 * they ride on the terminal `done` frame instead of being sent mid-stream.
 */
function forwardChunk(chunk: GenerationChunk, progress: StreamProgress): ChatStreamEvent | null {
  if (chunk.type === "text") return { type: "delta", text: chunk.delta };
  if (chunk.type === "usage") {
    progress.usage = chunk.usage;
    return null;
  }
  progress.finishReason = chunk.finishReason;
  return null;
}

/** One model that was tried and why it did not serve the request. */
interface FailedAttempt {
  readonly ref: string;
  readonly reason: string;
}

function refOf(model: ModelDescriptor): string {
  return `${model.provider}/${model.modelId}`;
}

/** Operator-facing reason for a skipped candidate: no request content. */
function describeFailure(error: AiProviderError): string {
  return error.status === undefined ? error.code : `${error.code} (HTTP ${error.status})`;
}

/** Appends the attempted models so a repeated failure is diagnosable. */
function augmentFailure(error: ChatStreamError, attempts: readonly FailedAttempt[]): ChatStreamError {
  if (attempts.length === 0) return error;
  const trail = attempts.map((attempt) => `${attempt.ref}: ${attempt.reason}`).join("; ");
  return { ...error, detail: error.detail === null ? trail : `${error.detail}; tried ${trail}` };
}

/**
 * Streams one assistant answer as `meta` → `delta`* → `done`, or a single
 * terminal `error`, walking `candidates` in ranked order until one serves.
 *
 * Fallback only happens while nothing has been emitted. Once a token reaches the
 * client the answer is already partly on screen, so switching providers would
 * splice two different models into one reply; a failure after the first token is
 * therefore reported rather than retried. The first chunk is pulled before `meta`
 * is emitted because that is the moment the provider commits.
 *
 * A retryable failure — timeout, rate limit, 5xx — abandons that candidate and
 * moves to the next-best free model. A non-retryable failure stops immediately:
 * it describes the request or the credentials rather than this provider's mood,
 * so every other candidate would fail identically.
 *
 * @param candidates Ranked eligible models from `AiGateway.rankedCandidates`.
 */
export async function* streamChatEvents(
  gateway: AiGateway,
  candidates: readonly ModelDescriptor[],
  request: ChatRequest,
  options: ChatStreamOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const attempts: FailedAttempt[] = [];
  const tried = new Set<string>();
  let lastFailure: AiProviderError | null = null;

  for (const candidate of candidates) {
    if (isAborted(options.signal)) return;

    // A repeated ref would spend a second request to learn the same thing.
    const ref = refOf(candidate);
    if (tried.has(ref)) continue;
    tried.add(ref);

    const chunks = gateway.streamSelected(
      candidate,
      request,
      options.signal === undefined ? undefined : { signal: options.signal },
    );

    let first: IteratorResult<GenerationChunk>;
    try {
      first = await chunks.next();
    } catch (cause) {
      if (isAborted(options.signal)) return;
      if (!isAiProviderError(cause) || !cause.retryable) {
        yield { type: "error", error: toChatStreamError(cause) };
        return;
      }
      lastFailure = cause;
      attempts.push({ ref, reason: describeFailure(cause) });
      continue;
    }

    // Committed. This model owns the answer from here, including its failures.
    yield metaEvent(candidate);
    const progress: StreamProgress = { usage: null, finishReason: "stop" };

    try {
      if (first.done !== true) {
        const leading = forwardChunk(first.value, progress);
        if (leading !== null) yield leading;
        for await (const chunk of chunks) {
          const event = forwardChunk(chunk, progress);
          if (event !== null) yield event;
        }
      }

      // The provider ends iteration cleanly when the caller aborts, so the loop
      // exiting does not mean the answer completed. Reporting `done` here would
      // tell the client a truncated reply was a finished one.
      if (isAborted(options.signal)) return;

      yield {
        type: "done",
        finishReason: progress.finishReason,
        usage: toChatUsage(progress.usage),
      };
    } catch (cause) {
      if (!isAborted(options.signal)) {
        yield { type: "error", error: toChatStreamError(cause) };
      }
      return;
    }
    return;
  }

  // Nothing served the request. Prefer the last real failure so the cause
  // survives, and name what was tried so the operator can see the gap.
  if (lastFailure !== null) {
    yield { type: "error", error: augmentFailure(toChatStreamError(lastFailure), attempts) };
    return;
  }
  yield {
    type: "error",
    error: {
      code: "NO_ELIGIBLE_MODEL",
      message: FAILURE_MESSAGE.NO_ELIGIBLE_MODEL,
      retryable: false,
      detail: NO_FREE_MODEL_DETAIL,
    },
  };
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