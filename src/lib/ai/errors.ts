import type { ProviderId } from "./types";

/**
 * Structured, machine-readable error codes. Callers branch on `code` rather
 * than parsing messages.
 */
export const AI_ERROR_CODES = [
  "PROVIDER_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "NO_ELIGIBLE_MODEL",
  "PROVIDER_REQUEST_FAILED",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export interface AiProviderErrorOptions {
  readonly status?: number | undefined;
  readonly retryable?: boolean | undefined;
  readonly detail?: string | undefined;
  readonly provider?: ProviderId | undefined;
  readonly modelId?: string | undefined;
  readonly cause?: unknown;
}

/** Statuses worth retrying later or against another candidate. */
function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * The single error type thrown across the AI layer.
 *
 * `PROVIDER_UNAVAILABLE` and `MODEL_UNAVAILABLE` are pre-flight failures — no
 * request reached a provider. `PROVIDER_REQUEST_FAILED` is a failed upstream
 * call. `NO_ELIGIBLE_MODEL` means every candidate was rejected before any
 * network call was attempted.
 */
export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly provider: ProviderId | undefined;
  readonly modelId: string | undefined;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly detail: string | undefined;

  constructor(code: AiErrorCode, message: string, options: AiProviderErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AiProviderError";
    this.code = code;
    this.provider = options.provider;
    this.modelId = options.modelId;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableStatus(options.status);
    this.detail = options.detail;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      provider: this.provider ?? null,
      modelId: this.modelId ?? null,
      status: this.status ?? null,
      retryable: this.retryable,
      detail: this.detail ?? null,
    };
  }
}

export function providerUnavailable(
  provider: ProviderId,
  detail?: string,
): AiProviderError {
  return new AiProviderError(
    "PROVIDER_UNAVAILABLE",
    `Provider "${provider}" is unavailable`,
    detail === undefined ? { provider } : { provider, detail },
  );
}

export function modelUnavailable(
  provider: ProviderId,
  modelId: string,
  detail?: string,
): AiProviderError {
  return new AiProviderError(
    "MODEL_UNAVAILABLE",
    `Model "${modelId}" is not available on provider "${provider}"`,
    detail === undefined ? { provider, modelId } : { provider, modelId, detail },
  );
}

export function noEligibleModel(detail: string): AiProviderError {
  return new AiProviderError("NO_ELIGIBLE_MODEL", "No eligible model is available", { detail });
}

export function providerRequestFailed(
  provider: ProviderId,
  options: Omit<AiProviderErrorOptions, "provider"> = {},
): AiProviderError {
  const suffix = options.detail === undefined ? "" : `: ${options.detail}`;
  return new AiProviderError(
    "PROVIDER_REQUEST_FAILED",
    `Request to provider "${provider}" failed${suffix}`,
    { ...options, provider },
  );
}

export function isAiProviderError(value: unknown): value is AiProviderError {
  return value instanceof AiProviderError;
}