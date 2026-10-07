"use client";

import { responseCopy } from "@/config/workspace";
import { highlightCode } from "@/lib/highlight";
import type { CodeTokenKind } from "@/lib/highlight";
import { CopyButton } from "./copy-button";

export type CodeBlockProps = {
  /** The declared fence language, or `null` when the fence carried none. */
  readonly language: string | null;
  /** The block's contents, verbatim. */
  readonly content: string;
};

/**
 * Token kind → design-system treatment. The palette is
 * achromatic, so syntax is told apart by weight and
 * luminance — never by hue.
 */
const TOKEN_CLASS: Readonly<Record<CodeTokenKind, string>> = {
  keyword: "font-semibold text-ink",
  string: "text-ink-muted",
  number: "text-ink-subtle",
  comment: "text-ink-subtle italic",
  function: "text-ink",
  plain: "text-ink",
};

/**
 * A fenced code block: a labelled container with the code
 * itself, a copy action for exactly this block's contents,
 * and a horizontal scroll for long lines. `pre` preserves
 * whitespace and indentation exactly, and nothing wraps the
 * code back onto itself.
 */
export function CodeBlock({ language, content }: CodeBlockProps) {
  const tokens = highlightCode(content, language);
  const label =
    language !== null && language !== ""
      ? language
      : responseCopy.codeFallbackLabel;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-inset">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-ink-subtle uppercase">
          {label}
        </span>
        <CopyButton
          text={content}
          label={responseCopy.copyCode}
          copiedLabel={responseCopy.copiedCode}
        />
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[13px] leading-6 text-ink">
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={TOKEN_CLASS[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
