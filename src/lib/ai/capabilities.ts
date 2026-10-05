import {
  MODALITIES,
  UNVERIFIED_CAPABILITIES,
  type Modality,
  type ModelCapabilities,
} from "./types";

const MODALITY_SET: ReadonlySet<string> = new Set<string>(MODALITIES);

/** Accepts `"text"`, `"TEXT"`, `" text "` and rejects anything unknown. */
export function isModality(value: unknown): value is Modality {
  return typeof value === "string" && MODALITY_SET.has(value.trim().toLowerCase());
}

/**
 * Providers describe modalities as free-form strings, so their payloads must
 * be normalized before anything in the routing path can rely on them.
 * Unrecognized entries are dropped rather than guessed at.
 */
export function normalizeModalities(value: unknown): readonly Modality[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<Modality>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const candidate = entry.trim().toLowerCase();
    if (isModality(candidate)) seen.add(candidate);
  }
  return MODALITIES.filter((modality) => seen.has(modality));
}

/**
 * Everything absent from the provider payload stays false/empty. A model whose
 * capabilities were never declared therefore cannot be mistaken for a
 * text-chat model.
 */
export function normalizeCapabilities(value: unknown): ModelCapabilities {
  if (typeof value !== "object" || value === null) return UNVERIFIED_CAPABILITIES;
  const raw = value as Record<string, unknown>;
  const flag = (key: string): boolean => raw[key] === true;
  return {
    inputModalities: normalizeModalities(raw["inputModalities"]),
    outputModalities: normalizeModalities(raw["outputModalities"]),
    supportsStreaming: flag("supportsStreaming"),
    supportsSystemPrompt: flag("supportsSystemPrompt"),
    supportsTools: flag("supportsTools"),
    supportsJsonOutput: flag("supportsJsonOutput"),
  };
}

export function acceptsModality(capabilities: ModelCapabilities, modality: Modality): boolean {
  return capabilities.inputModalities.includes(modality);
}

export function producesModality(
  capabilities: ModelCapabilities,
  modality: Modality,
): boolean {
  return capabilities.outputModalities.includes(modality);
}

/**
 * The minimum bar for a text-chat model: it must accept text and produce text.
 *
 * Vision models that also accept images stay eligible — a multimodal model
 * that takes images *and* text still answers text prompts. What is excluded is
 * anything that cannot do the text round trip at all: embedding-only,
 * image-only, and audio/TTS-only models.
 */
export function supportsTextChat(capabilities: ModelCapabilities): boolean {
  return acceptsModality(capabilities, "text") && producesModality(capabilities, "text");
}

export function isEmbeddingOnly(capabilities: ModelCapabilities): boolean {
  return (
    producesModality(capabilities, "embedding") && !producesModality(capabilities, "text")
  );
}

/** Produces audio (speech/TTS) without producing text. */
export function isAudioOutputOnly(capabilities: ModelCapabilities): boolean {
  const outputsAudio =
    producesModality(capabilities, "audio") ||
    producesModality(capabilities, "tts") ||
    producesModality(capabilities, "stt");
  return outputsAudio && !producesModality(capabilities, "text");
}

/** Produces images without producing text. */
export function isImageOutputOnly(capabilities: ModelCapabilities): boolean {
  return producesModality(capabilities, "image") && !producesModality(capabilities, "text");
}

/**
 * A request carrying a system message needs a model that honours one.
 * Tool calls and JSON output are never required by a plain chat request, so
 * they are not part of this check.
 */
export function supportsSystemMessages(capabilities: ModelCapabilities): boolean {
  return supportsTextChat(capabilities) && capabilities.supportsSystemPrompt;
}

/** A model is only streaming-capable if it can also produce text. */
export function isStreamable(capabilities: ModelCapabilities): boolean {
  return supportsTextChat(capabilities) && capabilities.supportsStreaming;
}