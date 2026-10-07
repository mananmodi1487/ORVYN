/**
 * The agent's reasoning layer.
 *
 * This is deliberately deterministic: it recognises explicit `read`
 * instructions in the prompt and plans the matching tool calls. It
 * never guesses a file path from a model id, and it never contacts a
 * remote service. When the prompt contains no recognised instruction it
 * reports `no_tool_match` instead of silently doing nothing.
 */

import type { ToolPlan } from "./tools";

export interface MissionPlan {
  readonly tools: ToolPlan[];
  /** True when the prompt contained at least one recognised instruction. */
  readonly matched: boolean;
}

/**
 * Turns a mission prompt into a sequence of tool calls.
 *
 * Only explicit `read <path>` instructions become tool calls. Nothing
 * is invented: a prompt with no recognised instruction plans no tools
 * at all, and the caller reports `no_tool_match`.
 */
export function planMission(prompt: string): MissionPlan {
  const tools: ToolPlan[] = [];
  let matched = false;

  for (const rawLine of prompt.split("\n")) {
    const instruction = parseReadInstruction(rawLine.trim());
    if (instruction === null) continue;
    tools.push(instruction);
    matched = true;
  }

  return { tools, matched };
}

function parseReadInstruction(line: string): ToolPlan | null {
  if (line === "") return null;
  const match = /^read\s+(\S+)$/i.exec(line);
  if (match === null) return null;
  return { name: "read_file", args: { path: match[1] ?? "" } };
}