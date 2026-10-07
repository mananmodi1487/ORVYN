import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseInline,
  parseMarkdown,
  safeLinkHref,
} from "@/lib/markdown";
import type { MarkdownInline } from "@/lib/markdown";

/**
 * The parser is the contract the renderer relies on: a
 * plain tree, no HTML anywhere in it, and no way for
 * model output to become markup.
 */

function inlineText(nodes: readonly MarkdownInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.content;
        case "strong":
        case "emphasis":
        case "link":
          return inlineText(node.children);
      }
    })
    .join("");
}

describe("paragraphs", () => {
  it("splits on blank lines", () => {
    const blocks = parseMarkdown("first\n\nsecond");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "paragraph");
    assert.equal(blocks[1]?.type, "paragraph");
  });

  it("joins wrapped lines with a space", () => {
    const blocks = parseMarkdown("one\ntwo");
    assert.equal(blocks.length, 1);
    assert.equal(inlineText(blocks[0]!.type === "paragraph" ? blocks[0]!.children : []), "one two");
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(parseMarkdown(""), []);
    assert.deepEqual(parseMarkdown("\n\n"), []);
  });
});

describe("headings", () => {
  it("reads levels one through six", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const blocks = parseMarkdown(`${"#".repeat(level)} Title`);
      const heading = blocks[0];
      assert.equal(heading?.type, "heading");
      assert.equal(heading?.type === "heading" ? heading.level : 0, level);
    }
  });

  it("parses inline markup in the heading text", () => {
    const blocks = parseMarkdown("## A **bold** title");
    const heading = blocks[0];
    assert.equal(heading?.type, "heading");
    assert.equal(
      heading?.type === "heading" ? inlineText(heading.children) : "",
      "A bold title",
    );
    assert.equal(
      heading?.type === "heading" ? heading.children[1]?.type : "",
      "strong",
    );
  });
});

describe("emphasis", () => {
  it("bolds double-delimited text", () => {
    const nodes = parseInline("a **bold** b");
    assert.equal(inlineText(nodes), "a bold b");
    assert.equal(nodes[1]?.type, "strong");
  });

  it("italicizes single-delimited text", () => {
    const nodes = parseInline("an *italic* word");
    assert.equal(nodes[1]?.type, "emphasis");
  });

  it("leaves snake_case identifiers literal", () => {
    const nodes = parseInline("the snake_case_value stays");
    assert.equal(inlineText(nodes), "the snake_case_value stays");
    assert.ok(nodes.every((node) => node.type === "text"));
  });

  it("leaves unmatched delimiters literal", () => {
    assert.equal(inlineText(parseInline("a stray * star")), "a stray * star");
    assert.equal(inlineText(parseInline("2 * 3")), "2 * 3");
  });

  it("unescapes backslash-escaped punctuation", () => {
    assert.equal(inlineText(parseInline("\\*not bold\\*")), "*not bold*");
  });
});

describe("inline code", () => {
  it("captures backtick content verbatim", () => {
    const nodes = parseInline("run `npm run check` now");
    const code = nodes[1];
    assert.equal(code?.type, "code");
    assert.equal(code?.type === "code" ? code.content : "", "npm run check");
  });
});

describe("links", () => {
  it("links allowlisted URLs", () => {
    const nodes = parseInline("see [the docs](https://example.com/a?b=1)");
    const link = nodes[1];
    assert.equal(link?.type, "link");
    assert.equal(
      link?.type === "link" ? link.href : "",
      "https://example.com/a?b=1",
    );
  });

  it("links mail and same-document targets", () => {
    assert.equal(safeLinkHref("mailto:a@b.com"), "mailto:a@b.com");
    assert.equal(safeLinkHref("#section"), "#section");
    assert.equal(safeLinkHref("/docs"), "/docs");
  });

  it("refuses scripting, data and protocol-relative URLs", () => {
    assert.equal(safeLinkHref("javascript:alert(1)"), null);
    assert.equal(safeLinkHref("JaVaScRiPt:alert(1)"), null);
    assert.equal(safeLinkHref("data:text/html,<b>x</b>"), null);
    assert.equal(safeLinkHref("//evil.example"), null);
    assert.equal(safeLinkHref("vbscript:msgbox(1)"), null);
  });

  it("renders refused links as literal text", () => {
    const nodes = parseInline("[click](javascript:alert(1))");
    assert.ok(nodes.every((node) => node.type !== "link"));
    assert.equal(inlineText(nodes), "[click](javascript:alert(1))");
  });
});

describe("lists", () => {
  it("parses unordered items", () => {
    const blocks = parseMarkdown("- one\n- two\n- three");
    const list = blocks[0];
    assert.equal(list?.type, "list");
    if (list?.type !== "list") return;
    assert.equal(list.ordered, false);
    assert.equal(list.items.length, 3);
    assert.equal(list.items[0]![0]?.type, "paragraph");
  });

  it("parses ordered items and their start", () => {
    const blocks = parseMarkdown("3. third\n4. fourth");
    const list = blocks[0];
    assert.equal(list?.type, "list");
    if (list?.type !== "list") return;
    assert.equal(list.ordered, true);
    assert.equal(list.start, 3);
    assert.equal(list.items.length, 2);
  });

  it("nests indented lists inside their item", () => {
    const blocks = parseMarkdown("- top\n  - nested\n- bottom");
    const list = blocks[0];
    if (list?.type !== "list") {
      assert.fail("expected a list");
    }
    assert.equal(list.items.length, 2);
    const first = list.items[0]!;
    const nested = first[1];
    assert.equal(nested?.type, "list");
    if (nested?.type === "list") {
      assert.equal(nested.items.length, 1);
    }
  });

  it("ends a list when an unindented paragraph follows", () => {
    const blocks = parseMarkdown("- one\n- two\n\ndone");
    assert.equal(blocks.length, 2);
    assert.equal(blocks[1]?.type, "paragraph");
  });
});

describe("blockquotes", () => {
  it("captures quoted paragraphs", () => {
    const blocks = parseMarkdown("> quoted text");
    const quote = blocks[0];
    assert.equal(quote?.type, "quote");
    if (quote?.type !== "quote") return;
    assert.equal(quote.children[0]?.type, "paragraph");
    assert.equal(
      quote.children[0]?.type === "paragraph"
        ? inlineText(quote.children[0].children)
        : "",
      "quoted text",
    );
  });
});

describe("fenced code", () => {
  it("reads the language from the fence", () => {
    const blocks = parseMarkdown("```typescript\nconst x = 1;\n```");
    const code = blocks[0];
    assert.equal(code?.type, "code");
    if (code?.type !== "code") return;
    assert.equal(code.language, "typescript");
    assert.equal(code.content, "const x = 1;");
  });

  it("preserves whitespace and indentation exactly", () => {
    const blocks = parseMarkdown("```\n  indented\n\tand tabbed\n```");
    const code = blocks[0];
    if (code?.type !== "code") {
      assert.fail("expected a code block");
    }
    assert.equal(code.content, "  indented\n\tand tabbed");
  });

  it("runs an unclosed fence to the end of the input", () => {
    const blocks = parseMarkdown("```js\nconst a = 1;\nconst b = 2;");
    assert.equal(blocks.length, 1);
    const code = blocks[0];
    if (code?.type !== "code") {
      assert.fail("expected a code block");
    }
    assert.equal(code.language, "js");
    assert.equal(code.content, "const a = 1;\nconst b = 2;");
  });

  it("keeps an empty fence empty", () => {
    const blocks = parseMarkdown("```\n```");
    const code = blocks[0];
    if (code?.type !== "code") {
      assert.fail("expected a code block");
    }
    assert.equal(code.content, "");
  });
});

describe("rules", () => {
  it("reads a rule line", () => {
    const blocks = parseMarkdown("above\n\n---\n\nbelow");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[1]?.type, "rule");
  });
});

describe("rendering wiring", () => {
  const transcript = readFileSync(
    new URL("../../src/components/workspace/conversation-transcript.tsx", import.meta.url),
    "utf8",
  );
  const markdown = readFileSync(
    new URL("../../src/components/workspace/message-markdown.tsx", import.meta.url),
    "utf8",
  );
  const codeBlock = readFileSync(
    new URL("../../src/components/workspace/code-block.tsx", import.meta.url),
    "utf8",
  );

  it("renders assistant turns through the markdown renderer", () => {
    assert.match(transcript, /<MessageMarkdown text=\{turn\.text\} streaming=\{streaming\} \/>/);
  });

  it("copies the response source, and nothing but it", () => {
    // The clipboard text is `turn.text` alone: no usage
    // figures, no provider names, no UI labels.
    assert.match(transcript, /<CopyButton\n\s+text=\{turn\.text\}/);
  });

  it("gives every code block a copy action for its own contents", () => {
    assert.match(codeBlock, /<CopyButton\n\s+text=\{content\}/);
    assert.match(codeBlock, /overflow-x-auto/);
  });

  it("never renders model output as HTML", () => {
    const components = readdirSync(
      new URL("../../src/components", import.meta.url),
      { encoding: "utf8", recursive: true },
    )
      .filter((entry): entry is string => entry.endsWith(".tsx"))
      .map((entry) => entry.replace(/\\/g, "/"));
    for (const entry of components) {
      const source = readFileSync(
        new URL(`../../src/components/${entry}`, import.meta.url),
        "utf8",
      );
      assert.equal(
        source.includes("dangerouslySetInnerHTML"),
        false,
        `${entry} must not render raw HTML`,
      );
    }
  });

  it("keys blocks by position so streaming updates in place", () => {
    assert.match(markdown, /key=\{index\}/);
    // The streaming flag is a prop, and it drives the
    // cursor — not a re-mount of the whole response.
    assert.match(markdown, /readonly streaming\?: boolean \| undefined;/);
    assert.match(markdown, /streaming \? <Cursor \/> : null/);
  });
});
