import { providerRequestFailed } from "../errors";
import type { AiProvider, AiProviderInfo } from "../provider";
import type {
  ChatRequest,
  FinishReason,
  GenerationChunk,
  GenerationResult,
  ModelDescriptor,
  ModelRef,
  ProviderHealth,
  StreamOptions,
  TokenUsage,
} from "../types";
import {
  describeModel,
  indexDeclarations,
  type ModelDeclaration,
} from "./model-declaration";
import {
  isRecord,
  OpenAiCompatibleClient,
  tryParseJson,
  type FetchLike,
} from "./openai-compatible";

const FINISH_REASONS: ReadonlySet<string> = new Set([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
]);

/**
 * A provider whose API is OpenAI-compatible: the same `/models`,
 * `/chat/completions` and SSE shape behind a different base URL and key.
 * OmniRoute and FreeLLMAPI are both this, which is why they share one
 * implementation rather than two near-copies.
 */
export interface OpenAiCompatibleProviderOptions {
  readonly info: AiProviderInfo;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
  /** Operator facts about models the list endpoint does not report. */
  readonly declarations?: readonly ModelDeclaration[] | undefined;
  /** Used only when the list endpoint returns nothing usable. */
  readonly fallbackModelIds?: readonly string[] | undefined;
  readonly now?: (() => Date) | undefined;
}

function readFinishReason(value: unknown): FinishReason {
  return typeof value === "string" && FINISH_REASONS.has(value)
    ? (value as FinishReason)
    : "stop";
}

function readUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value)) return null;
  const prompt = value["prompt_tokens"];
  const completion = value["completion_tokens"];
  return {
    inputTokens: typeof prompt === "number" ? prompt : null,
    outputTokens: typeof completion === "number" ? completion : null,
  };
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  // Some gateways return content as an array of typed parts.
  if (Array.isArray(value)) {
    return value
      .map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : ""))
      .join("");
  }
  return "";
}

function toChatBody(request: ChatRequest, model: ModelRef, stream: boolean): unknown {
  return {
    model: model.modelId,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    stream,
    // Without this, OpenAI-compatible providers send no usage on a streamed
    // response at all — the numbers only appear on the final SSE frame. Asking
    // is what makes real per-response accounting possible rather than an
    // estimate; a provider that ignores it simply reports nothing.
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  };
}

/**
 * Parses one SSE line. Returns `null` for blank lines, comment lines and the
 * terminal `[DONE]` sentinel — none of which carry content.
 */
export function parseSseDataLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (trimmed === "" || !trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "" || payload === "[DONE]") return null;
  return tryParseJson(payload);
}

interface StreamDelta {
  readonly text: string;
  readonly usage: TokenUsage | null;
  readonly finishReason: FinishReason | null;
}

function readDelta(payload: unknown): StreamDelta {
  if (!isRecord(payload)) return { text: "", usage: null, finishReason: null };
  const choices = payload["choices"];
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (!isRecord(first)) {
    return { text: "", usage: readUsage(payload["usage"]), finishReason: null };
  }
  const delta = first["delta"];
  const content = isRecord(delta) ? delta["content"] : undefined;
  const rawFinish = first["finish_reason"];
  return {
    text: content === undefined ? "" : readText(content),
    usage: readUsage(payload["usage"]),
    finishReason: typeof rawFinish === "string" ? readFinishReason(rawFinish) : null,
  };
}

/**
 * Splits an SSE byte stream into lines. Kept here so every OpenAI-compatible
 * provider streams identically and the logic is testable with a plain
 * `ReadableStream` of text.
 */
export async function* readSseLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        yield line;
        newlineIndex = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer !== "") yield buffer;
  } finally {
    reader.releaseLock();
  }
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleProviderOptions,
): AiProvider {
  const { info } = options;
  const client = new OpenAiCompatibleClient({
    providerId: info.id,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  /**
   * Only declarations addressed to this provider are indexed here. Passing the
   * full set is safe: a declaration for another provider can never match, since
   * lookups are provider-qualified.
   */
  const declarations = indexDeclarations(options.declarations);
  const fallbackModelIds = options.fallbackModelIds ?? [];
  const now = options.now ?? (() => new Date());

  /**
   * Descriptors come from declarations, never from guessing at a model id, so
   * an undeclared model is reported with unknown capabilities and stays
   * ineligible for routing instead of being silently assumed usable.
   */
  const describe = (modelId: string): ModelDescriptor =>
    describeModel(info.id, modelId, declarations);

  async function listModels(): Promise<readonly ModelDescriptor[]> {
    if (!info.configured) {
      throw providerRequestFailed(info.id, {
        detail: info.configurationDetail ?? "provider is not configured",
      });
    }
    const payload = await client.requestJson("/models", { method: "GET" });
    const reported = parseReportedModelIds(payload);
    // A provider that reports nothing usable still exposes the ids declared for
    // it locally, so configuration alone can describe the catalog.
    const ids = reported.length === 0 ? fallbackModelIds : reported;
    return [...new Set(ids)].map(describe);
  }

  async function healthCheck(): Promise<ProviderHealth> {
    const checkedAt = now().toISOString();
    if (!info.configured) {
      return {
        provider: info.id,
        status: "down",
        reachable: false,
        checkedAt,
        latencyMs: null,
        detail: info.configurationDetail,
      };
    }
    const startedAt = now();
    try {
      await client.requestJson("/models", { method: "GET" });
      return {
        provider: info.id,
        status: "up",
        reachable: true,
        checkedAt: now().toISOString(),
        latencyMs: Math.max(0, now().getTime() - startedAt.getTime()),
        detail: null,
      };
    } catch (cause) {
      return {
        provider: info.id,
        status: "down",
        reachable: false,
        checkedAt: now().toISOString(),
        latencyMs: null,
        detail: cause instanceof Error ? cause.message : "health check failed",
      };
    }
  }

  async function generate(request: ChatRequest, model: ModelRef): Promise<GenerationResult> {
    if (!info.configured) {
      throw providerRequestFailed(info.id, {
        detail: info.configurationDetail ?? "provider is not configured",
      });
    }
    const payload = await client.requestJson("/chat/completions", {
      method: "POST",
      body: toChatBody(request, model, false),
    });

    if (!isRecord(payload)) {
      throw providerRequestFailed(info.id, { detail: "malformed chat completion payload" });
    }
    const choices = Array.isArray(payload["choices"]) ? payload["choices"] : [];
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(first) ? first["message"] : undefined;
    const content = isRecord(message) ? message["content"] : undefined;

    return {
      model: describe(model.modelId),
      content: readText(content),
      finishReason: readFinishReason(isRecord(first) ? first["finish_reason"] : undefined),
      usage: readUsage(payload["usage"]),
      providerRequestId: typeof payload["id"] === "string" ? payload["id"] : null,
    };
  }

  async function* stream(
    request: ChatRequest,
    model: ModelRef,
    options?: StreamOptions,
  ): AsyncIterable<GenerationChunk> {
    const controller = new AbortController();
    const externalSignal = options?.signal;
    if (externalSignal?.aborted === true) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await client.requestStream(
        "/chat/completions",
        toChatBody(request, model, true),
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      // requestStream already normalized transport failures; anything reaching
      // here is unexpected.
      throw providerRequestFailed(info.id, {
        detail: cause instanceof Error ? cause.message : "stream request failed",
        cause,
      });
    }

    if (!response.ok) {
      throw providerRequestFailed(info.id, {
        status: response.status,
        detail: `HTTP ${response.status}`,
      });
    }
    if (response.body === null) {
      throw providerRequestFailed(info.id, { detail: "provider returned an empty stream" });
    }

    let finishReason: FinishReason = "stop";

    try {
      for await (const line of readSseLines(response.body)) {
        const payload = parseSseDataLine(line);
        if (payload === null) continue;
        const delta = readDelta(payload);
        if (delta.text !== "") yield { type: "text", delta: delta.text };
        if (delta.usage !== null) yield { type: "usage", usage: delta.usage };
        if (delta.finishReason !== null) finishReason = delta.finishReason;
      }
    } catch (cause) {
      // A caller-side cancel ends the stream; it is not a provider failure.
      if (controller.signal.aborted) return;
      throw providerRequestFailed(info.id, {
        detail: cause instanceof Error ? cause.message : "stream interrupted",
        cause,
      });
    }

    yield { type: "done", finishReason };
  }

  return { info, listModels, healthCheck, generate, stream };
}

function parseReportedModelIds(payload: unknown): readonly string[] {
  if (!isRecord(payload)) return [];
  const list = payload["data"];
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = entry["id"];
    if (typeof id === "string" && id.trim() !== "") ids.push(id);
  }
  return ids;
}