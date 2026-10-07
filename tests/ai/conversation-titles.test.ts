import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  generateTitle,
  titleRequest,
  toTitle,
} from "@/lib/ai/conversation-titles";
import { isAiProviderError } from "@/lib/ai/errors";
import { AiGateway } from "@/lib/ai/gateway";
import { createProviderRegistry } from "@/lib/ai/registry";
import {
  createFakeProvider,
  makeModel,
  textChatCapabilities,
} from "./fixtures/fake-provider";

/**
 * Titles are generated through the same gateway and free-only
 * routing as every other generation. These tests pin the parts
 * that decide what a title is and who may serve it, plus the
 * wiring that schedules the work off the response path — the
 * same source-level assertions the conversation routes already
 * use for their HTTP contracts.
 */

function gatewayWith(
  provider: ReturnType<typeof createFakeProvider>,
): AiGateway {
  return new AiGateway({ registry: createProviderRegistry([provider]) });
}

describe("title request", () => {
  it("asks for a title from the first message only", () => {
    const request = titleRequest("Fix the login redirect loop");

    assert.deepEqual(
      request.messages.map((message) => message.role),
      ["system", "user"],
    );
    assert.equal(request.messages[1]?.content, "Fix the login redirect loop");
  });

  it("uses the non-streaming generation path", () => {
    // A title does not need to stream, so the cheaper
    // `generate` call serves it — and eligibility agrees,
    // because `requireStreaming` stays unset.
    const request = titleRequest("hello");
    assert.equal(request.requireStreaming, undefined);
    assert.equal(request.pinnedModel, undefined);
    assert.ok((request.maxOutputTokens ?? 0) > 0, "a title is a few tokens");
  });
});

describe("toTitle", () => {
  it("keeps a plain title as it is", () => {
    assert.equal(toTitle("Login redirect loop"), "Login redirect loop");
  });

  it("strips wrapping quotes and collapses whitespace", () => {
    assert.equal(toTitle('"Login   redirect\nloop"'), "Login redirect loop");
    assert.equal(toTitle("“Quotes  around”"), "Quotes around");
  });

  it("returns null when the reply holds no title", () => {
    assert.equal(toTitle("   \n  "), null);
    assert.equal(toTitle('""'), null);
  });

  it("caps a runaway title", () => {
    const title = toTitle("word ".repeat(40).trim());
    assert.ok(title !== null && title.length <= 60);
    assert.ok(!title.endsWith(" "), "a truncated title keeps no trailing space");
  });
});

describe("generateTitle", () => {
  it("titles through the gateway's free-routed generation", async () => {
    const provider = createFakeProvider({
      id: "freellmapi",
      models: [
        makeModel({ provider: "freellmapi", modelId: "free-small" }),
      ],
      content: "Login redirect loop",
    });

    const title = await generateTitle(
      "I keep getting redirected back to login after I sign in",
      gatewayWith(provider),
    );

    assert.equal(title, "Login redirect loop");
    assert.deepEqual(
      provider.calls.generate.map((ref) => ref.modelId),
      ["free-small"],
    );
    assert.equal(
      provider.calls.stream.length,
      0,
      "a title is one generation, never a stream",
    );
  });

  it("never routes a title to a paid model", async () => {
    const provider = createFakeProvider({
      id: "omniroute",
      models: [
        makeModel({
          provider: "omniroute",
          modelId: "paid-large",
          pricing: {
            currency: "USD",
            tier: "paid",
            inputPerMillionTokens: 1,
            outputPerMillionTokens: 2,
          },
        }),
      ],
      content: "should never be produced",
    });

    await assert.rejects(
      () => generateTitle("hello", gatewayWith(provider)),
      (cause: unknown) =>
        isAiProviderError(cause) && cause.code === "NO_ELIGIBLE_MODEL",
    );
    assert.equal(
      provider.calls.generate.length,
      0,
      "a paid model is never asked for a title",
    );
  });

  it("rejects when no free model is eligible, rather than inventing a title", async () => {
    const provider = createFakeProvider({
      id: "freellmapi",
      models: [
        makeModel({
          provider: "freellmapi",
          modelId: "free-small",
          availability: "unavailable",
        }),
      ],
    });

    await assert.rejects(
      () => generateTitle("hello", gatewayWith(provider)),
      (cause: unknown) =>
        isAiProviderError(cause) && cause.code === "NO_ELIGIBLE_MODEL",
    );
    assert.equal(
      provider.calls.generate.length,
      0,
      "an unavailable model is never asked for a title",
    );
  });

  it("excludes a model that ignores the system prompt", async () => {
    // The title request carries a system message, so
    // `policyForRequest` raises `requireSystemPrompt` and
    // a model without system-prompt support is not a
    // candidate.
    const provider = createFakeProvider({
      id: "freellmapi",
      models: [
        makeModel({
          provider: "freellmapi",
          modelId: "free-small",
          capabilities: textChatCapabilities({
            supportsSystemPrompt: false,
          }),
        }),
      ],
      content: "should never be produced",
    });

    await assert.rejects(
      () => generateTitle("hello", gatewayWith(provider)),
      (cause: unknown) =>
        isAiProviderError(cause) && cause.code === "NO_ELIGIBLE_MODEL",
    );
    assert.equal(provider.calls.generate.length, 0);
  });
});

describe("title wiring", () => {
  const route = readFileSync(
    new URL(
      "../../src/app/api/conversations/[id]/messages/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const titles = readFileSync(
    new URL("../../src/lib/ai/conversation-titles.ts", import.meta.url),
    "utf8",
  );
  const shell = readFileSync(
    new URL("../../src/components/workspace/workspace-shell.tsx", import.meta.url),
    "utf8",
  );

  it("schedules the title after the persistence response", () => {
    // `after` runs the callback once the response is sent, so
    // persisting a message never waits on a generation.
    assert.match(route, /import \{ after, NextResponse \} from "next\/server"/);
    assert.match(route, /role === "user"/);
    assert.match(route, /after\(async \(\) => \{/);
    assert.match(route, /titleConversation\(\{ conversationId: id, userId \}\)/);
  });

  it("titles only the caller's own untitled conversation", () => {
    assert.match(route, /\.eq\("user_id", userId\)/);
    assert.match(route, /conversation\.title === ""/);
  });

  it("never overwrites an existing title", () => {
    // The write is guarded on the title still being empty, so a
    // late or retried generation cannot rename a conversation.
    assert.match(titles, /\.eq\("id", conversationId\)/);
    assert.match(titles, /\.eq\("user_id", userId\)/);
    assert.match(titles, /\.eq\("title", ""\)/);
  });

  it("reduces every failure to a diagnostic code", () => {
    assert.match(titles, /logTitleFailure\(/);
    assert.match(titles, /catch \(cause\)/);
  });

  it("reloads the sidebar list when a stream ends on an untitled conversation", () => {
    assert.match(shell, /onStreamComplete: handleStreamComplete/);
    assert.match(shell, /active\.title === ""/);
    assert.match(shell, /setConversations\(items\)/);
  });

  it("notifies the view when a stream finishes, from the stream's own completion", () => {
    // The notification leaves a promise callback, not an
    // effect body, and fires whatever the stream's outcome:
    // the user's message is persisted by then, so a title
    // may have been generated for it either way.
    const hook = readFileSync(
      new URL("../../src/lib/hooks/use-conversation.ts", import.meta.url),
      "utf8",
    );
    assert.match(hook, /onStreamComplete\?: \(conversationId: string\) => void/);
    assert.match(hook, /onStreamComplete\?\.\(currentConversationId\)/);
  });
});
