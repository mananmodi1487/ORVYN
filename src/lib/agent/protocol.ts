/**
 * Typed contract between the ORVYN browser client and the local agent bridge.
 *
 * Nothing in this file references Kilo, Ollama, provider names, model IDs, or
 * routing details. Those are implementation concerns of the local agent, not
 * the browser contract.
 */

export const AGENT_PORT = 3456 as const;
export const AGENT_HEALTH_PATH = "/v1/health" as const;
export const AGENT_MISSION_START_PATH = "/v1/mission/start" as const;
export const AGENT_MISSION_STREAM_PATH = "/v1/mission" as const;
export const AGENT_MISSION_CANCEL_PATH = "/v1/mission/cancel" as const;

export interface AgentHealth {
  readonly status: "ok" | "error";
  readonly timestamp: string;
}

export type AgentEventType =
  | "status"
  | "tool"
  | "result"
  | "diff"
  | "terminal"
  | "error"
  | "done";

export interface AgentEventBase {
  readonly t: AgentEventType;
}

export interface AgentStatusEvent extends AgentEventBase {
  readonly t: "status";
  readonly state: "idle" | "working" | "error";
}

export interface AgentToolEvent extends AgentEventBase {
  readonly t: "tool";
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface AgentResultEvent extends AgentEventBase {
  readonly t: "result";
  readonly id: string;
  readonly output: string;
}

export interface AgentDiffEvent extends AgentEventBase {
  readonly t: "diff";
  readonly file: string;
  readonly patch: string;
}

export interface AgentTerminalEvent extends AgentEventBase {
  readonly t: "terminal";
  readonly cmd: string;
  readonly output: string;
}

export interface AgentErrorEvent extends AgentEventBase {
  readonly t: "error";
  readonly code: string;
  readonly message: string;
}

export interface AgentDoneEvent extends AgentEventBase {
  readonly t: "done";
  readonly summary: {
    readonly filesChanged: number;
    readonly testsRun: number;
  };
}

export type AgentEvent =
  | AgentStatusEvent
  | AgentToolEvent
  | AgentResultEvent
  | AgentDiffEvent
  | AgentTerminalEvent
  | AgentErrorEvent
  | AgentDoneEvent;

export interface MissionRequest {
  readonly prompt: string;
  readonly projectRoot?: string;
}

export type MissionStatus =
  | "idle"
  | "starting"
  | "running"
  | "cancelling"
  | "done"
  | "error";

export interface MissionHandle {
  readonly id: string;
  start(prompt: string): Promise<void>;
  cancel(): void;
}
