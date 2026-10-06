/**
 * Browser-side bridge to the ORVYN local agent.
 *
 * The bridge talks only to `http://localhost:<port>` over HTTP and SSE. It
 * never sends ORVYN secrets, cookies, or upstream provider credentials. The
 * only outbound payload is the user's mission prompt and an optional
 * project-root hint.
 */

import type {
  AgentEvent,
  AgentHealth,
  MissionHandle,
  MissionRequest,
} from "./protocol";
import {
  AGENT_HEALTH_PATH,
  AGENT_MISSION_START_PATH,
  AGENT_MISSION_STREAM_PATH,
} from "./protocol";

const DEFAULT_PORT = 3456;

type StreamController = {
  cancelled: boolean;
  missionId: string;
  abortController: AbortController;
};

export class AgentBridge {
  private readonly port: number;
  private readonly baseUrl: string;
  private _connected = false;
  private activeMission: StreamController | null = null;

  constructor(port?: number) {
    this.port = port ?? DEFAULT_PORT;
    this.baseUrl = `http://localhost:${this.port}`;
  }

  get connected(): boolean {
    return this._connected;
  }

  async checkHealth(): Promise<AgentHealth> {
    try {
      const response = await fetch(`${this.baseUrl}${AGENT_HEALTH_PATH}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return { status: "error", timestamp: new Date().toISOString() };
      }
      return (await response.json()) as AgentHealth;
    } catch {
      return { status: "error", timestamp: new Date().toISOString() };
    }
  }

  async connect(): Promise<void> {
    const health = await this.checkHealth();
    if (health.status !== "ok") {
      throw new Error("agent_unavailable");
    }
    this._connected = true;
  }

  disconnect(): void {
    this.cancelActiveMission();
    this._connected = false;
  }

  async startMission(request: MissionRequest): Promise<MissionHandle> {
    if (!this._connected) {
      throw new Error("agent_not_connected");
    }

    const response = await fetch(`${this.baseUrl}${AGENT_MISSION_START_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`mission_start_failed: ${response.status}`);
    }

    const result = (await response.json()) as { missionId: string };
    const missionId = result.missionId;

    this.activeMission = {
      cancelled: false,
      missionId,
      abortController: new AbortController(),
    };

    const handle: MissionHandle = {
      id: missionId,
      start(prompt: string): Promise<void> {
        void prompt;
        return Promise.resolve();
      },
      cancel: (): void => {
        this.cancelActiveMission();
      },
    };

    return handle;
  }

  async *streamMission(
    missionId: string,
  ): AsyncGenerator<AgentEvent> {
    if (!this.activeMission || this.activeMission.missionId !== missionId) {
      throw new Error("no_active_mission");
    }

    const controller = this.activeMission;
    const url = `${this.baseUrl}${AGENT_MISSION_STREAM_PATH}/${missionId}/stream`;

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.abortController.signal,
        });
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          (err as Record<string, unknown>).name === "AbortError"
        ) {
          return;
        }
        throw err;
      }

      if (!response.ok || !response.body) {
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!controller.cancelled) {
        const raw = await reader.read();
        if (raw.done) break;

        buffer += decoder.decode(raw.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const json = trimmed.slice(6);
          if (json === "[DONE]") return;
          try {
            const event = JSON.parse(json) as AgentEvent;
            yield event;
            if (event.t === "done") return;
          } catch {
            // skip malformed event
          }
        }
      }
    } finally {
      controller.abortController.abort();
      this.activeMission = null;
    }
  }

  private cancelActiveMission(): void {
    if (!this.activeMission) return;

    this.activeMission.cancelled = true;
    this.activeMission.abortController.abort();
  }
}
