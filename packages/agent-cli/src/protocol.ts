/**
 * Shared protocol types between the ORVYN agent CLI server and the browser
 * bridge. This file lives inside the agent CLI package so the standalone
 * server does not depend on the ORVYN web application.
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

export interface AgentEvent {
  readonly t: string;
  readonly state?: string;
  readonly id?: string;
  readonly name?: string;
  readonly args?: Record<string, unknown>;
  readonly output?: string;
  readonly file?: string;
  readonly patch?: string;
  readonly cmd?: string;
  readonly code?: string;
  readonly message?: string;
  readonly summary?: {
    readonly filesChanged: number;
    readonly testsRun: number;
  };
}
