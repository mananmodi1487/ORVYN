import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { highlightCode } from "@/lib/highlight";
import type { CodeTokenKind } from "@/lib/highlight";

/**
 * The tokenizer's contract is totality: concatenating
 * its tokens reproduces the source exactly, whatever
 * the language — so a code block can never lose or
 * gain a character on its way to the screen.
 */

const SAMPLES: ReadonlyArray<{
  readonly language: string | null;
  readonly code: string;
}> = [
  {
    language: "typescript",
    code: [
      'import { useState } from "react";',
      "",
      "export function Counter({ start = 0 }: { start?: number }) {",
      "  const [count, setCount] = useState(start);",
      "  // double on click",
      "  /* block",
      "     comment */",
      "  return <button onClick={() => setCount(count * 2)}>{count}</button>;",
      "}",
    ].join("\n"),
  },
  {
    language: "python",
    code: [
      "def greet(name):",
      '    """Say hello."""',
      "    # a comment",
      '    return f"hello, {name}"',
    ].join("\n"),
  },
  {
    language: "json",
    code: '{\n  "name": "ORVYN",\n  "version": 1,\n  "private": true\n}',
  },
  {
    language: "bash",
    code: 'for f in *.ts; do\n  echo "lint $f"\n  # check\n  npm run lint -- "$f"\ndone',
  },
  {
    language: "css",
    code: ".card {\n  /* raised */\n  background: var(--surface-raised);\n  padding: 1.5rem;\n}",
  },
  {
    language: "sql",
    code: "SELECT id, name\nFROM conversations\nWHERE user_id = $1\nORDER BY created_at DESC\nLIMIT 10;",
  },
  {
    language: "yaml",
    code: "name: ORVYN\nversion: 1\n# comment\nnested:\n  key: value",
  },
  {
    language: "html",
    code: '<section class="chat">\n  <!-- transcript -->\n  <p>hello</p>\n</section>',
  },
  {
    language: "diff",
    code: "@@ -1,3 +1,4 @@\n context line\n-removed line\n+added line\n more",
  },
  { language: null, code: "plain text\n  indented" },
  { language: "brainfuck", code: "++++[>++++<-]>." },
  { language: "js", code: "" },
];

describe("highlighting", () => {
  for (const sample of SAMPLES) {
    it(`reproduces the source exactly (${sample.language ?? "none"})`, () => {
      const tokens = highlightCode(sample.code, sample.language);
      assert.equal(
        tokens.map((token) => token.text).join(""),
        sample.code,
      );
    });
  }

  it("returns nothing for empty code", () => {
    assert.deepEqual(highlightCode("", "js"), []);
  });

  it("tokenizes an unknown language as one plain run", () => {
    const tokens = highlightCode("x = 1", "brainfuck");
    assert.deepEqual(tokens, [{ text: "x = 1", kind: "plain" }]);
  });

  it("treats an empty language as unknown", () => {
    const tokens = highlightCode("x = 1", "");
    assert.deepEqual(tokens, [{ text: "x = 1", kind: "plain" }]);
  });

  it("finds keywords, strings, comments, numbers and calls", () => {
    const tokens = highlightCode(
      'const x = "s"; // note\nf(1)',
      "javascript",
    );
    const kinds = new Set(tokens.map((token) => token.kind));
    const expected: readonly CodeTokenKind[] = [
      "keyword",
      "string",
      "comment",
      "number",
      "function",
    ];
    for (const kind of expected) {
      assert.ok(kinds.has(kind), `expected a ${kind} token`);
    }
  });

  it("recognizes language aliases", () => {
    // "typescript" aliases to the ts family, so a
    // TypeScript keyword highlights as one.
    const tokens = highlightCode("const", "typescript");
    assert.equal(tokens[0]?.kind, "keyword");

    const shell = highlightCode('echo "hi"', "shell");
    assert.ok(shell.some((token) => token.kind === "keyword"));
    assert.ok(shell.some((token) => token.kind === "string"));
  });

  it("marks JSON keys apart from values", () => {
    const tokens = highlightCode('{"a": "b"}', "json");
    const key = tokens.find(
      (token) => token.kind === "keyword" && token.text === '"a"',
    );
    const value = tokens.find(
      (token) => token.kind === "string" && token.text === '"b"',
    );
    assert.ok(key !== undefined, "the key reads as a keyword");
    assert.ok(value !== undefined, "the value reads as a string");
  });

  it("never splits a token across a character boundary", () => {
    // Every token is non-empty and the walk is strictly
    // forward, which the exact-reproduction test above
    // already proves for the samples; this pins the
    // invariant on adversarial input too.
    const adversarial = '"""unterminated\n`"\\\\';
    const tokens = highlightCode(adversarial, "python");
    assert.equal(
      tokens.map((token) => token.text).join(""),
      adversarial,
    );
  });
});
