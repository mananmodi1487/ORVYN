/**
 * Syntax tokenizing for fenced code blocks.
 *
 * ORVYN's palette is achromatic by design, so "highlighting"
 * here means luminance and weight: keywords read bold, strings
 * and numbers sit at quieter ink steps, and comments recede into
 * italics. There is no hue to leak into the design system.
 *
 * The tokenizer is a hand-rolled scanner over sticky patterns,
 * tried in order at each position. It is total: concatenating
 * the tokens always reproduces the source exactly — whitespace,
 * indentation and every character the model sent.
 */

export type CodeTokenKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "function"
  | "plain";

export type CodeToken = {
  readonly text: string;
  readonly kind: CodeTokenKind;
};

type TokenSpec = {
  readonly kind: CodeTokenKind;
  /** Sticky (`y`) pattern: it must match at exactly the cursor. */
  readonly pattern: RegExp;
};

type LanguageFamily = readonly TokenSpec[];

function keywords(
  words: readonly string[],
  flags = "y",
): RegExp {
  return new RegExp(`\\b(?:${words.join("|")})\\b`, flags);
}

/** C-family languages share most of their vocabulary. */
const C_FAMILY: LanguageFamily = [
  {
    kind: "comment",
    pattern: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y,
  },
  {
    kind: "string",
    pattern:
      /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?|`(?:[^`\\]|\\[\s\S])*`?/y,
  },
  {
    kind: "keyword",
    pattern: keywords([
      "async", "await", "break", "case", "catch", "class", "const",
      "continue", "default", "delete", "do", "else", "enum", "export",
      "extends", "false", "finally", "for", "from", "function", "if",
      "import", "in", "instanceof", "interface", "let", "new", "null",
      "private", "protected", "public", "readonly", "return", "static",
      "super", "switch", "this", "throw", "true", "try", "typeof",
      "undefined", "var", "void", "while", "yield",
      // Go
      "func", "go", "defer", "chan", "map", "range", "struct",
      "select", "fallthrough",
      // Rust
      "fn", "mut", "impl", "trait", "where", "match", "use", "crate",
      "self", "Self", "move", "ref", "loop", "unsafe", "mod", "pub",
      // Java / C#
      "package", "namespace", "implements", "synchronized", "volatile",
      "transient", "abstract", "final", "goto", "native", "throws",
      // Lua / Ruby
      "end", "then", "elsif", "def", "rescue", "ensure", "module",
      "begin",
    ]),
  },
  {
    kind: "number",
    pattern:
      /(?<![\w$])(?:0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/y,
  },
  { kind: "function", pattern: /\b[\w$]+(?=\s*\()/y },
];

const PYTHON: LanguageFamily = [
  { kind: "comment", pattern: /#[^\n]*/y },
  {
    kind: "string",
    pattern: /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/y,
  },
  { kind: "keyword", pattern: /@[\w.]+/y },
  {
    kind: "keyword",
    pattern: keywords([
      "False", "None", "True", "and", "as", "assert", "async", "await",
      "break", "class", "continue", "def", "del", "elif", "else",
      "except", "finally", "for", "from", "global", "if", "import",
      "in", "is", "lambda", "nonlocal", "not", "or", "pass", "print",
      "raise", "return", "try", "while", "with", "yield", "self",
    ]),
  },
  {
    kind: "number",
    pattern:
      /(?<![\w])(?:0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?j?)/y,
  },
  { kind: "function", pattern: /\b\w+(?=\s*\()/y },
];

const BASH: LanguageFamily = [
  { kind: "comment", pattern: /#[^\n]*/y },
  {
    kind: "string",
    pattern: /"(?:[^"\\]|\\[\s\S])*"?|'(?:[^'\\]|\\[\s\S])*'?/y,
  },
  { kind: "string", pattern: /\$\{?[\w@#?*$-]+\}?/y },
  {
    kind: "keyword",
    pattern: keywords([
      "if", "then", "else", "elif", "fi", "for", "while", "until",
      "do", "done", "case", "esac", "in", "function", "echo",
      "return", "local", "export", "set", "unset", "shift", "exit",
      "trap", "source", "readonly", "declare", "cd", "eval", "exec",
      "select", "time", "let", "read", "mapfile",
    ]),
  },
  { kind: "number", pattern: /(?<![\w])\d+(?:\.\d+)?/y },
  { kind: "function", pattern: /\b[\w.-]+(?=\s*\()/y },
];

const JSON_LANG: LanguageFamily = [
  // A string followed by a colon is a key, and keys read like
  // keywords: they name the structure the values fill.
  { kind: "keyword", pattern: /"(?:[^"\\\n]|\\[\s\S])*"(?=\s*:)/y },
  { kind: "string", pattern: /"(?:[^"\\\n]|\\[\s\S])*"?/y },
  { kind: "keyword", pattern: keywords(["true", "false", "null"]) },
  { kind: "number", pattern: /(?<![\w])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
];

const CSS: LanguageFamily = [
  { kind: "comment", pattern: /\/\*[\s\S]*?(?:\*\/|$)/y },
  {
    kind: "string",
    pattern: /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/y,
  },
  { kind: "keyword", pattern: /@[\w-]+/y },
  { kind: "keyword", pattern: /#[0-9a-fA-F]{3,8}\b/y },
  { kind: "function", pattern: /[a-zA-Z-]+(?=\s*:\s)/y },
  { kind: "number", pattern: /(?<![\w])-?\d+(?:\.\d+)?(?:%|[a-z]+)?/y },
];

const HTML: LanguageFamily = [
  { kind: "comment", pattern: /<!--[\s\S]*?(?:-->|$)/y },
  {
    kind: "string",
    pattern: /"(?:[^"<\n]|\\[\s\S])*"?|'(?:[^'<\n]|\\[\s\S])*'?/y,
  },
  { kind: "keyword", pattern: /<\/?[\w-]+/y },
  { kind: "function", pattern: /[\w-]+(?=["'])/y },
];

const SQL: LanguageFamily = [
  { kind: "comment", pattern: /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
  { kind: "string", pattern: /'(?:[^'\\]|\\[\s\S])*'?/y },
  {
    kind: "keyword",
    pattern: keywords(
      [
        "select", "from", "where", "join", "left", "right", "inner",
        "outer", "full", "cross", "on", "group", "by", "order",
        "having", "limit", "offset", "insert", "into", "values",
        "update", "set", "delete", "create", "table", "index", "view",
        "drop", "alter", "add", "as", "and", "or", "not", "null", "is",
        "in", "like", "between", "exists", "distinct", "union", "all",
        "case", "when", "then", "else", "end", "asc", "desc",
        "primary", "key", "foreign", "references", "default",
        "constraint", "begin", "commit", "rollback", "transaction",
        "with", "recursive", "over", "partition",
      ],
      "yi",
    ),
  },
  { kind: "number", pattern: /(?<![\w])-?\d+(?:\.\d+)?/y },
  { kind: "function", pattern: /\b\w+(?=\s*\()/y },
];

const YAML: LanguageFamily = [
  { kind: "comment", pattern: /#[^\n]*/y },
  {
    kind: "string",
    pattern: /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/y,
  },
  { kind: "keyword", pattern: /^[ \t]*[\w.-]+(?=\s*:)/ym },
  { kind: "keyword", pattern: keywords(["true", "false", "null", "yes", "no"], "yi") },
  { kind: "number", pattern: /(?<![\w])-?\d+(?:\.\d+)?/y },
];

const DIFF: LanguageFamily = [
  { kind: "comment", pattern: /^@@[^\n]*$/ym },
  { kind: "keyword", pattern: /^\+[^\n]*$/ym },
  { kind: "string", pattern: /^-[^\n]*$/ym },
];

const FAMILIES: Readonly<Record<string, LanguageFamily>> = {
  js: C_FAMILY,
  ts: C_FAMILY,
  jsx: C_FAMILY,
  tsx: C_FAMILY,
  c: C_FAMILY,
  go: C_FAMILY,
  rust: C_FAMILY,
  ruby: C_FAMILY,
  java: C_FAMILY,
  kotlin: C_FAMILY,
  swift: C_FAMILY,
  scala: C_FAMILY,
  lua: C_FAMILY,
  php: C_FAMILY,
  perl: C_FAMILY,
  python: PYTHON,
  bash: BASH,
  json: JSON_LANG,
  css: CSS,
  html: HTML,
  sql: SQL,
  yaml: YAML,
  diff: DIFF,
};

const ALIASES: Readonly<Record<string, string>> = {
  javascript: "js",
  node: "js",
  mjs: "js",
  cjs: "js",
  typescript: "ts",
  py: "python",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  console: "bash",
  terminal: "bash",
  yml: "yaml",
  golang: "go",
  rs: "rust",
  rb: "ruby",
  cpp: "c",
  "c++": "c",
  csharp: "c",
  "c#": "c",
  h: "c",
  hpp: "c",
  kt: "kotlin",
  mysql: "sql",
  postgres: "sql",
  psql: "sql",
  scss: "css",
  less: "css",
  svg: "html",
  xml: "html",
  patch: "diff",
};

/**
 * Tokenizes `code` for display. An unknown or absent language
 * tokenizes as one plain run: the block still scrolls, copies and
 * preserves its formatting exactly — it just carries no emphasis.
 */
export function highlightCode(
  code: string,
  language: string | null,
): readonly CodeToken[] {
  const family = resolveFamily(language);
  if (family === null) {
    return code === "" ? [] : [{ text: code, kind: "plain" }];
  }
  return tokenize(code, family);
}

function resolveFamily(language: string | null): LanguageFamily | null {
  if (language === null) return null;
  const normalized = language.toLowerCase().trim();
  if (normalized === "") return null;
  const resolved = ALIASES[normalized] ?? normalized;
  return FAMILIES[resolved] ?? null;
}

function tokenize(code: string, specs: LanguageFamily): CodeToken[] {
  const tokens: CodeToken[] = [];
  let plain = "";
  let i = 0;

  while (i < code.length) {
    let matched: TokenSpec | null = null;
    let text = "";

    for (const spec of specs) {
      spec.pattern.lastIndex = i;
      const match = spec.pattern.exec(code);
      if (match !== null && match[0] !== "") {
        matched = spec;
        text = match[0];
        break;
      }
    }

    if (matched !== null) {
      if (plain !== "") {
        tokens.push({ text: plain, kind: "plain" });
        plain = "";
      }
      tokens.push({ text, kind: matched.kind });
      i += text.length;
      continue;
    }

    plain += code.charAt(i);
    i += 1;
  }

  if (plain !== "") {
    tokens.push({ text: plain, kind: "plain" });
  }

  return tokens;
}
