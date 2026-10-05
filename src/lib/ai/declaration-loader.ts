import { readFileSync } from "node:fs";
import {
  formatDeclarationIssues,
  validateDeclarationDocument,
  type DeclarationIssue,
} from "./declaration-schema";
import { DeclarationSet } from "./declarations";
import { assertServerOnly } from "./server-only";

/**
 * Server-side loading of operator model declarations.
 *
 * Declarations arrive as untrusted JSON — from a file on disk or an environment
 * variable — so every load runs the full validator before anything is exposed to
 * the routing path. Nothing here is ever imported from a Client Component:
 * `assertServerOnly()` runs first, and the module imports `node:fs`, which
 * cannot be bundled for the browser in the first place.
 *
 * Secrets stay out of this module's surface. Issue messages name fields and
 * enums, never values, so an operator can log an issue string without leaking a
 * base URL or key that happened to be nearby in the same file.
 */

/** Environment variables that point at a declarations source. */
export const DECLARATIONS_PATH_VAR = "ORVYN_AI_DECLARATIONS_PATH";
export const DECLARATIONS_JSON_VAR = "ORVYN_AI_DECLARATIONS_JSON";

export type DeclarationLoadResult =
  | { readonly ok: true; readonly set: DeclarationSet; readonly source: DeclarationSource }
  | {
      readonly ok: false;
      readonly issues: readonly DeclarationIssue[];
      readonly source: DeclarationSource;
      /** Single-line summary safe to log. Contains no configuration values. */
      readonly summary: string;
    };

export type DeclarationSource =
  | { readonly kind: "empty" }
  | { readonly kind: "json"; readonly origin: "env" }
  | { readonly kind: "file"; readonly path: string };

/** How many bytes of declaration JSON to read before giving up. */
const MAX_DECLARATION_BYTES = 512 * 1024;

function failure(
  source: DeclarationSource,
  issues: readonly DeclarationIssue[],
): DeclarationLoadResult {
  return { ok: false, issues, source, summary: formatDeclarationIssues(issues) };
}

function parseAndValidate(
  text: string,
  source: DeclarationSource,
): DeclarationLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unparseable JSON";
    return failure(source, [
      {
        code: "invalid_type",
        path: "$",
        message: `declarations are not valid JSON: ${detail}`,
      },
    ]);
  }

  const result = validateDeclarationDocument(parsed);
  if (!result.ok) return failure(source, result.issues);
  return { ok: true, set: new DeclarationSet(result.declarations), source };
}

/**
 * Loads declarations from an inline JSON string.
 *
 * An empty string is treated as "no declarations configured" rather than an
 * error, so an unset variable and an empty one behave identically.
 */
export function loadDeclarationsFromJson(text: string, origin: "env" = "env"): DeclarationLoadResult {
  assertServerOnly("loadDeclarationsFromJson");
  if (text.trim() === "") return { ok: true, set: new DeclarationSet(), source: { kind: "empty" } };
  return parseAndValidate(text, { kind: "json", origin });
}

/**
 * Loads declarations from a JSON file on the server filesystem.
 *
 * A missing file is reported as an issue rather than thrown, because an operator
 * pointing at a path that does not exist needs the same actionable message they
 * would get for malformed content. The path itself is safe to report; file
 * contents are never echoed.
 */
export function loadDeclarationsFromFile(filePath: string): DeclarationLoadResult {
  assertServerOnly("loadDeclarationsFromFile");
  const trimmed = filePath.trim();
  if (trimmed === "") {
    return failure({ kind: "file", path: trimmed }, [
      { code: "empty_string", path: trimmed, message: "declarations file path must not be empty" },
    ]);
  }
  const source: DeclarationSource = { kind: "file", path: trimmed };

  let text: string;
  try {
    text = readFileSync(trimmed, "utf8");
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "file could not be read";
    return failure(source, [
      { code: "invalid_type", path: trimmed, message: `declarations file could not be read: ${detail}` },
    ]);
  }

  if (text.length > MAX_DECLARATION_BYTES) {
    return failure(source, [
      {
        code: "invalid_type",
        path: trimmed,
        message: `declarations file exceeds ${MAX_DECLARATION_BYTES} bytes`,
      },
    ]);
  }
  return parseAndValidate(text, source);
}

/**
 * Resolves declarations from the environment.
 *
 * Precedence is deliberate: an explicit `..._PATH` wins over inline
 * `..._JSON`, so an operator can keep a large declaration set in version
 * control while a deployment override supplies a small inline one only when it
 * sets the path variable to nothing.
 *
 * Neither variable may carry a `NEXT_PUBLIC_` prefix. Declarations influence
 * routing, and a client-visible declaration set is a configuration leak even
 * when it contains no credentials.
 */
export function loadDeclarationsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DeclarationLoadResult {
  assertServerOnly("loadDeclarationsFromEnv");

  const pathValue = env[DECLARATIONS_PATH_VAR]?.trim();
  if (pathValue !== undefined && pathValue !== "") {
    return loadDeclarationsFromFile(pathValue);
  }
  const jsonValue = env[DECLARATIONS_JSON_VAR];
  if (jsonValue !== undefined && jsonValue.trim() !== "") {
    return loadDeclarationsFromJson(jsonValue);
  }
  return { ok: true, set: new DeclarationSet(), source: { kind: "empty" } };
}

/** Convenience for composition code: the set, or an empty one on any problem. */
export function loadDeclarationSetOrEmpty(env: NodeJS.ProcessEnv = process.env): DeclarationSet {
  const result = loadDeclarationsFromEnv(env);
  return result.ok ? result.set : new DeclarationSet();
}