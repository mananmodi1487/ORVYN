/**
 * A small, safe Markdown subset for assistant responses.
 *
 * The parser is hand-rolled and produces a plain tree of nodes:
 * there is no HTML in and no HTML out. Renderers emit React
 * text nodes only, so model output can never inject markup.
 * The subset covers what responses actually use — paragraphs,
 * headings, bold and italic, lists, links, blockquotes, inline
 * code, fenced code blocks and rules — and everything a model
 * emits outside that subset renders as literal text.
 */

export type MarkdownBlock =
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "heading"; level: number; children: MarkdownInline[] }
  | { type: "list"; ordered: boolean; start: number | null; items: MarkdownBlock[][] }
  | { type: "quote"; children: MarkdownBlock[] }
  | { type: "code"; language: string | null; content: string }
  | { type: "rule" };

export type MarkdownInline =
  | { type: "text"; content: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "emphasis"; children: MarkdownInline[] }
  | { type: "code"; content: string }
  | { type: "link"; href: string; children: MarkdownInline[] };

/** Parses a Markdown document into blocks. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  return parseBlocks(source.split("\n"));
}

/**
 * Links are allowlisted: only web, mail and same-document targets
 * render as links. Anything else — `javascript:`, `data:`,
 * protocol-relative URLs — stays literal text, so model output
 * cannot script a page or bounce a user to an unknown origin.
 */
export function safeLinkHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return null;
}

function parseBlocks(lines: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = matchFence(line);
    if (fence !== null) {
      // An unclosed fence runs to the end of the input: a block
      // still streaming in has no closing fence yet, and it must
      // render as code rather than as the prose that follows it.
      const content: string[] = [];
      let j = i + 1;
      while (j < lines.length && !isClosingFence(lines[j]!, fence.marker)) {
        content.push(lines[j]!);
        j += 1;
      }
      blocks.push({
        type: "code",
        language: fence.language,
        content: content.join("\n"),
      });
      i = j + 1;
      continue;
    }

    const heading = matchHeading(line);
    if (heading !== null) {
      blocks.push({
        type: "heading",
        level: heading.level,
        children: parseInline(heading.text),
      });
      i += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (isQuoteLine(line)) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length && isQuoteLine(lines[j]!)) {
        inner.push(lines[j]!.replace(/^>\s?/, ""));
        j += 1;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner) });
      i = j;
      continue;
    }

    const listStart = matchListStart(line);
    if (listStart !== null) {
      const parsed = parseList(lines, i, listStart.indent, listStart.marker);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    const paragraph: string[] = [line];
    let j = i + 1;
    while (j < lines.length && isParagraphLine(lines[j]!)) {
      paragraph.push(lines[j]!);
      j += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    i = j;
  }

  return blocks;
}

function isParagraphLine(line: string): boolean {
  if (line.trim() === "") return false;
  return (
    matchFence(line) === null &&
    matchHeading(line) === null &&
    !isRule(line) &&
    !isQuoteLine(line) &&
    matchListStart(line) === null
  );
}

type Fence = {
  readonly marker: string;
  readonly language: string | null;
};

function matchFence(line: string): Fence | null {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) return null;
  const info = match[2]!.trim();
  // The language is the first word of the info string; the rest
  // (titles, options) is ignored, as CommonMark does.
  const language = info === "" ? null : (info.split(/\s+/)[0] ?? null);
  return { marker: match[1]!, language };
}

function isClosingFence(line: string, marker: string): boolean {
  const match = /^(`{3,}|~{3,})\s*$/.exec(line);
  return (
    match !== null &&
    match[1]!.length >= marker.length &&
    match[1]!.charAt(0) === marker.charAt(0)
  );
}

function matchHeading(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
  if (match === null) return null;
  return { level: match[1]!.length, text: match[2]! };
}

function isRule(line: string): boolean {
  return /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isQuoteLine(line: string): boolean {
  return /^>\s?/.test(line);
}

type ListMarker = {
  readonly ordered: boolean;
  readonly start: number | null;
  /** Characters the marker occupies, including its trailing space. */
  readonly width: number;
};

function matchListMarker(line: string): ListMarker | null {
  const unordered = /^([-+*])(\s+)/.exec(line);
  if (unordered !== null) {
    return { ordered: false, start: null, width: 1 + unordered[2]!.length };
  }
  const ordered = /^(\d{1,9})([.)])(\s+)/.exec(line);
  if (ordered !== null) {
    return {
      ordered: true,
      start: Number(ordered[1]),
      width: ordered[1]!.length + 1 + ordered[3]!.length,
    };
  }
  return null;
}

function matchListStart(line: string): { marker: ListMarker; indent: number } | null {
  const indent = indentOf(line);
  const marker = matchListMarker(line.slice(indent));
  return marker === null ? null : { marker, indent };
}

/**
 * Parses one list. Items are the lines indented past their marker,
 * dedented and parsed as blocks — which is how a nested list
 * becomes an item's child block. Blank lines belong to the item
 * they precede when the next non-blank line is still indented
 * past the marker, and to the list only when it resumes at the
 * same indent with the same marker style.
 */
function parseList(
  lines: readonly string[],
  start: number,
  indent: number,
  firstMarker: ListMarker,
): { block: MarkdownBlock; next: number } {
  const items: MarkdownBlock[][] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === "") j += 1;
      const resume = j < lines.length ? matchListStart(lines[j]!) : null;
      if (
        resume !== null &&
        resume.indent === indent &&
        resume.marker.ordered === firstMarker.ordered
      ) {
        i = j;
        continue;
      }
      break;
    }

    const current = matchListStart(line);
    if (
      current === null ||
      current.indent !== indent ||
      current.marker.ordered !== firstMarker.ordered
    ) {
      break;
    }

    const contentIndent = indent + current.marker.width;
    const itemLines: string[] = [line.slice(contentIndent)];
    i += 1;

    while (i < lines.length) {
      const continuation = lines[i]!;
      if (continuation.trim() === "") {
        let j = i + 1;
        while (j < lines.length && lines[j]!.trim() === "") j += 1;
        if (j < lines.length && indentOf(lines[j]!) >= contentIndent) {
          i += 1;
          continue;
        }
        break;
      }
      if (indentOf(continuation) < contentIndent) break;
      itemLines.push(continuation.slice(contentIndent));
      i += 1;
    }

    items.push(parseBlocks(itemLines));
  }

  return {
    block: {
      type: "list",
      ordered: firstMarker.ordered,
      start: firstMarker.start,
      items,
    },
    next: i,
  };
}

function indentOf(line: string): number {
  return /^ */.exec(line)![0]!.length;
}

const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "#", "~"]);

/**
 * Parses inline markup by scanning left to right. Unmatched
 * delimiters are literal text, so a stray asterisk in prose
 * reads as a stray asterisk.
 */
export function parseInline(text: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer !== "") {
      nodes.push({ type: "text", content: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    const ch = text.charAt(i);

    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.has(text.charAt(i + 1))) {
      buffer += text.charAt(i + 1);
      i += 2;
      continue;
    }

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: "code", content: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    const emphasis = matchEmphasis(text, i);
    if (emphasis !== null) {
      flush();
      nodes.push(emphasis.node);
      i = emphasis.next;
      continue;
    }

    if (ch === "[") {
      const link = matchLink(text, i);
      if (link !== null) {
        flush();
        nodes.push(link.node);
        i = link.next;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return nodes;
}

function matchEmphasis(
  text: string,
  start: number,
): { node: MarkdownInline; next: number } | null {
  const pair = text.charAt(start) + text.charAt(start + 1);
  if (pair === "**" || pair === "__") {
    const end = text.indexOf(pair, start + 2);
    if (end > start + 2) {
      return {
        node: {
          type: "strong",
          children: parseInline(text.slice(start + 2, end)),
        },
        next: end + 2,
      };
    }
    return null;
  }

  const single = text.charAt(start);
  if (single !== "*" && single !== "_") return null;
  // An underscore only emphasizes when it is not glued to a word
  // on either side, so snake_case identifiers stay literal.
  if (
    single === "_" &&
    (isWordChar(text.charAt(start - 1)) || isWordChar(text.charAt(start + 1)))
  ) {
    return null;
  }
  const end = text.indexOf(single, start + 1);
  if (end <= start + 1) return null;
  if (single === "_" && isWordChar(text.charAt(end + 1))) return null;
  return {
    node: {
      type: "emphasis",
      children: parseInline(text.slice(start + 1, end)),
    },
    next: end + 1,
  };
}

function matchLink(
  text: string,
  start: number,
): { node: MarkdownInline; next: number } | null {
  const close = text.indexOf("]", start + 1);
  if (close === -1) return null;
  if (text.charAt(close + 1) !== "(") return null;
  const end = text.indexOf(")", close + 2);
  if (end === -1) return null;
  const href = safeLinkHref(text.slice(close + 2, end));
  if (href === null) return null;
  return {
    node: {
      type: "link",
      href,
      children: parseInline(text.slice(start + 1, close)),
    },
    next: end + 1,
  };
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}
