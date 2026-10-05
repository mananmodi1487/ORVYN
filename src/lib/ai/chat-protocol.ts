/**
 * The wire contract between the ORVYN chat client and `POST /api/chat`.
 *
 * This module is intentionally importable from the browser: it depends only on
 * `types.ts` (type-level) and holds no provider, gateway, or credential logic.
 * The browser sends turns and renders events; it never chooses a provider and
 * never sees a key.
 */
import type { AiErrorCode } from "./errors";
import type { ChatRole, FinishReason, RoutingStrategy, TokenUsage } from "./types";

/** One message in the conversation. `id` is client-generated for reconciliation. */
export interface ChatTurn {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
}

export interface PinnedModelRef {
  readonly provider: string;
  readonly modelId: string;
}

/** The JSON body the client posts. Omitted fields mean "let the gateway decide". */
export interface ChatRequestBody {
  readonly turns: readonly ChatTurn[];
  readonly strategy?: RoutingStrategy | undefined;
  readonly pinnedModel?: PinnedModelRef | undefined;
}

/** Which model actually served the request. Sent first, before any text. */
export interface ChatStreamMeta {
  readonly provider: string;
  readonly modelId: string;
  readonly displayName: string;
}

/**
 * The error shape the client is allowed to see.
 *
 * `message` is written for a person and carries no request content, no
 * credentials, and no upstream stack. `code` is what callers branch on.
 */
export interface ChatStreamError {
  readonly code: AiErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly detail: string | null;
}

export type ChatStreamEvent =
  | { readonly type: "meta"; readonly model: ChatStreamMeta }
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done"; readonly finishReason: FinishReason; readonly usage: TokenUsage | null }
  | { readonly type: "error"; readonly error: ChatStreamError };

/**
 * HTTP status for each failure code.
 *
 * `INVALID_REQUEST` is the only 400: a malformed or oversized body fails
 * identically next time. `MODEL_UNAVAILABLE` is a 422 because it means the caller
 * pinned a model that is not usable. The rest are 5xx — either the operator has
 * no usable model configured or an upstream provider failed — so they reflect a
 * server-side condition rather than a fault in the request.
 *
 * Status and `retryable` are deliberately independent. A 503 raised because
 * nothing is configured is still not worth retrying in a loop: the environment
 * has to change first, and the gateway reports it that way.
 */
export const ERROR_STATUS: Readonly<Record<AiErrorCode, number>> = {
  INVALID_REQUEST: 400,
  MODEL_UNAVAILABLE: 422,
  NO_ELIGIBLE_MODEL: 503,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_REQUEST_FAILED: 502,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses one decoded stream frame.
 *
 * Unknown frames are dropped rather than trusted: the route is the only producer,
 * but a client that trusts its own parser shape is one deploy away from rendering
 * `[object Object]`.
 */
export function parseChatStreamEvent(value: unknown): ChatStreamEvent | null {
  if (!isRecord(value)) return null;
  const type = value["type"];

  if (type === "meta") {
    const model = value["model"];
    if (!isRecord(model)) return null;
    const provider = model["provider"];
    const modelId = model["modelId"];
    if (typeof provider !== "string" || typeof modelId !== "string") return null;
    return {
      type: "meta",
      model: {
        provider,
        modelId,
        displayName: typeof model["displayName"] === "string" ? model["displayName"] : modelId,
      },
    };
  }

  if (type === "delta") {
    const text = value["text"];
    return typeof text === "string" && text !== "" ? { type: "delta", text } : null;
  }

  if (type === "done") {
    const finishReason = value["finishReason"];
    const usage = value["usage"];
    return {
      type: "done",
      finishReason: typeof finishReason === "string" ? (finishReason as FinishReason) : "stop",
      usage: isRecord(usage) ? (usage as unknown as TokenUsage) : null,
    };
  }

  if (type === "error") {
    const error = value["error"];
    if (!isRecord(error)) return null;
    const code = error["code"];
    if (typeof code !== "string") return null;
    return {
      type: "error",
      error: {
        code: code as AiErrorCode,
        message: typeof error["message"] === "string" ? error["message"] : "Request failed",
        retryable: error["retryable"] === true,
        detail: typeof error["detail"] === "string" ? error["detail"] : null,
      },
    };
  }

  return null;
}
