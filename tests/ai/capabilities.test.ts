import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAudioOutputOnly,
  isEmbeddingOnly,
  isImageOutputOnly,
  isModality,
  isStreamable,
  normalizeCapabilities,
  normalizeModalities,
  supportsSystemMessages,
  supportsTextChat,
} from "@/lib/ai/capabilities";
import { UNVERIFIED_CAPABILITIES } from "@/lib/ai/types";

describe("normalizeModalities", () => {
  it("lower-cases, trims, drops unknown entries, and preserves canonical order", () => {
    const result = normalizeModalities([" TEXT ", "vision", "image", 42, null, "audio"]);
    assert.deepEqual(result, ["text", "image", "audio"]);
  });

  it("returns an empty list for anything that is not an array", () => {
    assert.deepEqual(normalizeModalities(undefined), []);
    assert.deepEqual(normalizeModalities("text"), []);
    assert.deepEqual(normalizeModalities({ inputModalities: ["text"] }), []);
  });

  it("removes duplicates", () => {
    assert.deepEqual(normalizeModalities(["text", "text", "TEXT"]), ["text"]);
  });
});

describe("isModality", () => {
  it("accepts known values case-insensitively and rejects others", () => {
    assert.equal(isModality("text"), true);
    assert.equal(isModality(" TTS "), true);
    assert.equal(isModality("vision"), false);
    assert.equal(isModality(7), false);
  });
});

describe("normalizeCapabilities", () => {
  it("returns the unverified baseline when the payload is not an object", () => {
    assert.deepEqual(normalizeCapabilities(null), UNVERIFIED_CAPABILITIES);
    assert.deepEqual(normalizeCapabilities("text"), UNVERIFIED_CAPABILITIES);
  });

  it("defaults every absent flag to false rather than true", () => {
    const capabilities = normalizeCapabilities({ inputModalities: ["text"] });
    assert.deepEqual(capabilities.inputModalities, ["text"]);
    assert.deepEqual(capabilities.outputModalities, []);
    assert.equal(capabilities.supportsStreaming, false);
    assert.equal(capabilities.supportsSystemPrompt, false);
  });
});

describe("supportsTextChat", () => {
  it("accepts a text-in / text-out model", () => {
    assert.equal(
      supportsTextChat(
        normalizeCapabilities({ inputModalities: ["text"], outputModalities: ["text"] }),
      ),
      true,
    );
  });

  it("keeps a vision model eligible because it still does the text round trip", () => {
    assert.equal(
      supportsTextChat(
        normalizeCapabilities({
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
        }),
      ),
      true,
    );
  });

  it("rejects a model that produces no text", () => {
    assert.equal(
      supportsTextChat(normalizeCapabilities({ inputModalities: ["text"], outputModalities: [] })),
      false,
    );
  });

  it("rejects a model that cannot accept text", () => {
    assert.equal(
      supportsTextChat(
        normalizeCapabilities({ inputModalities: ["audio"], outputModalities: ["text"] }),
      ),
      false,
    );
  });

  it("rejects a model with no declared capabilities at all", () => {
    assert.equal(supportsTextChat(UNVERIFIED_CAPABILITIES), false);
  });
});

describe("single-purpose model classification", () => {
  it("identifies embedding-only models", () => {
    assert.equal(
      isEmbeddingOnly(normalizeCapabilities({ outputModalities: ["embedding"] })),
      true,
    );
    assert.equal(
      isEmbeddingOnly(normalizeCapabilities({ outputModalities: ["embedding", "text"] })),
      false,
    );
  });

  it("identifies audio and TTS-only models", () => {
    assert.equal(isAudioOutputOnly(normalizeCapabilities({ outputModalities: ["audio"] })), true);
    assert.equal(isAudioOutputOnly(normalizeCapabilities({ outputModalities: ["tts"] })), true);
    assert.equal(
      isAudioOutputOnly(normalizeCapabilities({ outputModalities: ["audio", "text"] })),
      false,
    );
  });

  it("identifies image-only models", () => {
    assert.equal(
      isImageOutputOnly(normalizeCapabilities({ outputModalities: ["image"] })),
      true,
    );
    assert.equal(
      isImageOutputOnly(normalizeCapabilities({ outputModalities: ["image", "text"] })),
      false,
    );
  });
});

describe("streaming and system prompts", () => {
  it("requires text output in addition to streaming support", () => {
    assert.equal(
      isStreamable(
        normalizeCapabilities({
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsStreaming: true,
        }),
      ),
      true,
    );
    assert.equal(
      isStreamable(
        normalizeCapabilities({
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsStreaming: false,
        }),
      ),
      false,
    );
  });

  it("requires system-prompt support alongside text chat", () => {
    assert.equal(
      supportsSystemMessages(
        normalizeCapabilities({
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsSystemPrompt: true,
        }),
      ),
      true,
    );
    assert.equal(
      supportsSystemMessages(
        normalizeCapabilities({
          inputModalities: ["text"],
          outputModalities: ["text"],
        }),
      ),
      false,
    );
  });
});