/**
 * Local tool execution for the ORVYN agent.
 *
 * Only `read_file` is implemented in this revision. Every tool runs on
 * the user's machine, inside the mission's project root. Nothing here
 * contacts a remote service: the only I/O is the local filesystem.
 *
 * The sandbox is the project root. A path is safe only when it resolves
 * to a location inside that root; absolute paths, `..` segments, and
 * symlinks that would escape are rejected before any read is made.
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "../protocol";

/** The tools the agent can call. */
export type ToolName = "read_file";

/** Arguments for a planned tool call. */
export type ToolArgs = {
  readonly path?: string;
};

/** A single planned tool call. */
export type ToolPlan = {
  readonly name: ToolName;
  readonly args: ToolArgs;
};

/** Execution context for one tool call. */
export interface ToolContext {
  /** Tool id, echoed back in result events. */
  readonly id: string;
  /** The sandbox root. Every path is resolved against it. */
  readonly root: string;
  /** Aborted when the mission is cancelled. */
  readonly signal: AbortSignal;
}

/**
 * Resolves a user-supplied path against the project root and returns
 * the absolute real location, or `null` when the path is unsafe.
 *
 * A path is unsafe when it is absolute, empty, contains `..` segments,
 * resolves to the root itself, or — after symlink resolution — lands
 * outside the real root.
 */
export function resolveSafePath(root: string, inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (trimmed === "") return null;
  if (path.isAbsolute(trimmed)) return null;
  if (/^[a-zA-Z]:/.test(trimmed)) return null;

  const normalised = path.normalize(trimmed);
  const segments = normalised.split(path.sep);
  if (segments.some((segment) => segment === "..")) return null;
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "")) {
    return null;
  }

  const resolved = path.resolve(root, normalised);
  const rootResolved = path.resolve(root);
  if (resolved === rootResolved) return null;
  if (!resolved.startsWith(rootResolved + path.sep)) return null;

  // Resolve symlinks: the real location must also stay inside the real
  // root. Walk up to the deepest existing ancestor first, since the
  // target may not exist yet.
  let existing = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      fs.lstatSync(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      tail.unshift(path.basename(existing));
      existing = parent;
    }
  }

  let realExisting: string;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    return null;
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootResolved);
  } catch {
    realRoot = rootResolved;
  }

  const candidate =
    tail.length === 0 ? realExisting : path.join(realExisting, ...tail);
  if (candidate === realRoot) return null;
  if (!candidate.startsWith(realRoot + path.sep)) return null;
  return candidate;
}

/** Reads a file inside the project root. */
export function executeReadFile(
  ctx: ToolContext,
  inputPath: string,
): AgentEvent[] {
  const resolved = resolveSafePath(ctx.root, inputPath);
  if (resolved === null) {
    return [
      {
        t: "error",
        code: "path_outside_root",
        message: `refused path outside the project root: ${inputPath}`,
      },
    ];
  }

  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    return [
      {
        t: "error",
        code: "read_failed",
        message: err instanceof Error ? err.message : "read_failed",
      },
    ];
  }

  return [{ t: "result", id: ctx.id, output: content }];
}

/**
 * Resolves a mission root from the configured root and an optional
 * request hint. Only a relative path inside the configured root may
 * narrow it; absolute paths, traversal, and URLs fall back to the
 * configured root so a client can never choose a sandbox outside it.
 */
export function resolveMissionRoot(
  configuredRoot: string,
  requestedRoot: string | undefined,
): string {
  if (requestedRoot === undefined || requestedRoot.trim() === "") {
    return path.resolve(configuredRoot);
  }

  const trimmed = requestedRoot.trim();
  if (path.isAbsolute(trimmed)) return path.resolve(configuredRoot);
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.includes("://")) {
    return path.resolve(configuredRoot);
  }

  const normalised = path.normalize(trimmed);
  if (normalised.split(path.sep).some((segment) => segment === "..")) {
    return path.resolve(configuredRoot);
  }

  const resolved = path.resolve(configuredRoot, normalised);
  const rootResolved = path.resolve(configuredRoot);
  if (resolved === rootResolved) return rootResolved;
  if (!resolved.startsWith(rootResolved + path.sep)) return rootResolved;
  return resolved;
}

/** Dispatches a planned tool call to its implementation. */
export function executeTool(plan: ToolPlan, ctx: ToolContext): AgentEvent[] {
  return executeReadFile(ctx, plan.args.path ?? "");
}