"use client";

import type { ReactNode } from "react";
import type { MarkdownBlock, MarkdownInline } from "@/lib/markdown";
import { parseMarkdown } from "@/lib/markdown";
import { CodeBlock } from "./code-block";

export type MessageMarkdownProps = {
  readonly text: string;
  /**
   * Renders the streaming cursor inside the last
   * paragraph or heading, so the caret stays on the line
   * the assistant is writing instead of jumping to its
   * own line as blocks arrive.
   */
  readonly streaming?: boolean | undefined;
};

/**
 * Renders an assistant response as Markdown.
 *
 * Blocks are keyed by position, so a delta that changes
 * the text updates the existing elements in place instead
 * of remounting them — a streaming answer never flickers
 * or loses its place. Everything renders as React text
 * nodes; model output is never trusted as markup.
 */
export function MessageMarkdown({ text, streaming }: MessageMarkdownProps) {
  const blocks = parseMarkdown(text);
  const cursor = streaming ? <Cursor /> : null;

  const rendered = blocks.map((block, index) => (
    <MarkdownBlockView
      key={index}
      block={block}
      trailing={
        streaming && index === blocks.length - 1 && canHostCursor(block)
          ? cursor
          : null
      }
    />
  ));

  // A response that ends mid-block — a fence still
  // streaming, a list, a quote — keeps its cursor on
  // its own trailing line.
  if (
    cursor !== null &&
    (blocks.length === 0 || !canHostCursor(blocks[blocks.length - 1]!))
  ) {
    rendered.push(cursor);
  }

  return <>{rendered}</>;
}

function canHostCursor(block: MarkdownBlock): boolean {
  return block.type === "paragraph" || block.type === "heading";
}

function MarkdownBlockView({
  block,
  trailing,
  compact = false,
}: {
  readonly block: MarkdownBlock;
  readonly trailing: ReactNode;
  /** Blocks nested in a list item or quote drop their outer margins. */
  readonly compact?: boolean | undefined;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className={compact ? undefined : "mb-3 last:mb-0"}>
          {renderInline(block.children)}
          {trailing}
        </p>
      );

    case "heading": {
      // Chat answers rarely need an h1; the visual scale
      // starts at h2 and clamps there.
      const level = Math.min(Math.max(block.level, 2), 6);
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className={headingClass(level, compact)}>
          {renderInline(block.children)}
          {trailing}
        </Tag>
      );
    }

    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          {item.map((child, childIndex) => (
            <MarkdownBlockView
              key={childIndex}
              block={child}
              trailing={null}
              compact
            />
          ))}
        </li>
      ));
      const listClass = compact
        ? "space-y-1.5 pl-6 marker:text-ink-subtle"
        : "mb-3 space-y-1.5 pl-6 last:mb-0 marker:text-ink-subtle";
      return block.ordered ? (
        <ol
          start={block.start ?? undefined}
          className={`list-decimal ${listClass}`}
        >
          {items}
        </ol>
      ) : (
        <ul className={`list-disc ${listClass}`}>{items}</ul>
      );
    }

    case "quote":
      return (
        <blockquote
          className={
            compact ? "border-l-2 border-line-strong pl-4" : "mb-3 border-l-2 border-line-strong pl-4 last:mb-0"
          }
        >
          {block.children.map((child, index) => (
            <MarkdownBlockView
              key={index}
              block={child}
              trailing={null}
              compact
            />
          ))}
        </blockquote>
      );

    case "code":
      return <CodeBlock language={block.language} content={block.content} />;

    case "rule":
      return <hr className="my-4 border-line" />;
  }
}

function renderInline(nodes: readonly MarkdownInline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <span key={index}>{node.content}</span>;

      case "strong":
        return (
          <strong key={index} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        );

      case "emphasis":
        return <em key={index}>{renderInline(node.children)}</em>;

      case "code":
        return (
          <code
            key={index}
            className="rounded-md border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-[0.85em] text-ink"
          >
            {node.content}
          </code>
        );

      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm text-ink underline decoration-line-strong underline-offset-2 hover:bg-hover"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function headingClass(level: number, compact: boolean): string {
  const scale =
    level === 2
      ? "text-[19px]"
      : level === 3
        ? "text-[17px]"
        : "text-[15px]";
  const spacing = compact ? "mb-1.5" : "mb-2 mt-4 first:mt-0";
  return `${spacing} font-semibold ${scale}`;
}

function Cursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-ink-subtle"
    />
  );
}
