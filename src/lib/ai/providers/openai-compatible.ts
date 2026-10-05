import { providerRequestFailed } from "../errors";

/**
 * The shape of an OpenAI-compatible HTTP error body. Providers differ in
 * detail, so everything except the nested `error` object is optional and
 * nothing in the body is trusted.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export interface OpenAiCompatibleOptions {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Injected in tests and by callers that need a custom agent or timeout. */
  readonly fetchImpl?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  readonly defaultHeaders?: Readonly<Record<string, string>> | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Pulls a human-readable message out of an error body without trusting its shape. */
export function readErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const error = body["error"];
  if (!isRecord(error)) return undefined;
  const message = error["message"];
  if (typeof message === "string" && message.trim() !== "") return message;
  const code = error["code"];
  if (typeof code === "string" && code.trim() !== "") return code;
  return undefined;
}

/**
 * Shared request executor for every OpenAI-compatible provider.
 *
 * Owns the parts that must behave identically across providers: auth headers,
 * timeouts, JSON parsing, and — most importantly — translating transport and
 * HTTP failures into `AiProviderError` so nothing else in the app has to know
 * what shape a given gateway returns on failure.
 */
export class OpenAiCompatibleClient {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #defaultHeaders: Readonly<Record<string, string>>;

  constructor(options: OpenAiCompatibleOptions) {
    this.providerId = options.providerId;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    const resolved = options.fetchImpl ?? globalThis.fetch;
    if (typeof resolved !== "function") {
      throw new Error("No fetch implementation available for the AI provider client");
    }
    // Bind the global so it keeps working when called as a stored reference.
    this.#fetch = resolved.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#defaultHeaders = options.defaultHeaders ?? {};
  }

  /** Absolute URL for a path such as `/models` or `/chat/completions`. */
  url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /**
   * The auth header is applied last so a caller cannot accidentally drop or
   * override it via `defaultHeaders`.
   */
  headers(extra?: Readonly<Record<string, string>>): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json",
      ...this.#defaultHeaders,
      ...extra,
      authorization: `Bearer ${this.#apiKey}`,
    };
  }

  async requestJson(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
    const response = await this.sendRequest(path, init, this.#timeoutMs, "application/json");
    const text = await safeReadText(response);
    const parsed = text === "" ? null : tryParseJson(text);

    if (!response.ok) {
      throw providerRequestFailed(this.providerId, {
        status: response.status,
        detail: readErrorMessage(parsed) ?? `HTTP ${response.status}`,
      });
    }
    if (parsed === null) {
      throw providerRequestFailed(this.providerId, {
        status: response.status,
        detail: "provider returned a non-JSON body",
      });
    }
    return parsed;
  }

  /**
   * Issues a streaming request and returns the raw response so the caller can
   * consume the body. The abort signal is *not* cleared here: the caller owns
   * it for the lifetime of the stream.
   */
  async requestStream(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    return this.sendRequest(path, { method: "POST", body }, this.#timeoutMs, "text/event-stream", signal);
  }

  async sendRequest(
    path: string,
    init: { method: string; body?: unknown },
    timeoutMs: number,
    accept: string,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    // Forward caller cancellation into our own timeout controller.
    const forwardAbort = (): void => controller.abort();
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    if (externalSignal?.aborted === true) controller.abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.#fetch(this.url(path), {
        method: init.method,
        headers: this.headers({ accept }),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (externalSignal?.aborted === true) {
        throw providerRequestFailed(this.providerId, {
          detail: "request cancelled",
          cause,
        });
      }
      if (controller.signal.aborted) {
        throw providerRequestFailed(this.providerId, {
          detail: `request timed out after ${timeoutMs}ms`,
          cause,
        });
      }
      throw providerRequestFailed(this.providerId, {
        detail: cause instanceof Error ? cause.message : "transport failure",
        cause,
      });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", forwardAbort);
    }
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}