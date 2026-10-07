import http from "node:http";
import type { AgentHealth, AgentEvent } from "../protocol";
import { planMission } from "./planner";
import { executeTool, resolveMissionRoot } from "./tools";

export interface AgentServerHandle {
  port: number;
  stop(): Promise<void>;
}

export interface AgentServerOptions {
  /** Origins allowed to call the agent over CORS. */
  readonly allowedOrigins?: string[];
  /**
   * Configured project root. A mission may narrow it with a
   * relative `projectRoot` hint, but can never escape it.
   */
  readonly projectRoot?: string;
}

/** Body accepted by POST /v1/mission/start. */
interface MissionStartRequest {
  readonly prompt: string;
  readonly projectRoot: string | undefined;
}

type MissionState = {
  cancelled: boolean;
  interval: ReturnType<typeof setInterval> | null;
  prompt: string;
  /** Resolved sandbox root for every tool call in this mission. */
  projectRoot: string;
  abortController: AbortController;
};

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
];

function parseAllowedOrigins(): string[] {
  const raw = process.env.ORVYN_AGENT_ALLOWED_ORIGINS ?? "";
  if (!raw.trim()) return DEFAULT_ALLOWED_ORIGINS;
  return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin as string);
}

function setCorsHeaders(
  res: http.ServerResponse,
  origin: string | undefined,
  allowedOrigins: string[],
): void {
  if (isOriginAllowed(origin, allowedOrigins) && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

function parseMissionStartRequest(body: unknown): MissionStartRequest {
  if (typeof body !== "object" || body === null) {
    throw new Error("invalid_request");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.prompt !== "string") {
    throw new Error("invalid_request");
  }
  if (
    record.projectRoot !== undefined &&
    typeof record.projectRoot !== "string"
  ) {
    throw new Error("invalid_request");
  }
  return { prompt: record.prompt, projectRoot: record.projectRoot };
}

/**
 * Runs a mission's planned tool calls and collects the events to
 * stream back. Tool execution is local and synchronous; the
 * streaming loop still paces the events so clients observe them
 * arriving one at a time.
 */
function runMission(mission: MissionState): AgentEvent[] {
  const events: AgentEvent[] = [{ t: "status", state: "working" }];
  const plan = planMission(mission.prompt);

  plan.tools.forEach((tool, index) => {
    const id = String(index + 1);
    events.push({ t: "tool", id, name: tool.name, args: tool.args });
    const outcome = executeTool(tool, {
      id,
      root: mission.projectRoot,
      signal: mission.abortController.signal,
    });
    for (const event of outcome) {
      events.push(event);
    }
  });

  if (!plan.matched) {
    events.push({
      t: "error",
      code: "no_tool_match",
      message: "no recognised tool instruction in the mission prompt",
    });
  }

  events.push({ t: "status", state: "idle" });
  events.push({ t: "done", summary: { filesChanged: 0, testsRun: 0 } });
  return events;
}

export function createAgentServer(
  port: number,
  options?: AgentServerOptions,
): Promise<AgentServerHandle> {
  const allowedOrigins = options?.allowedOrigins ?? parseAllowedOrigins();
  const configuredRoot = options?.projectRoot ?? process.cwd();
  const missions = new Map<string, MissionState>();

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;

    if (req.method === "OPTIONS") {
      setCorsHeaders(res, origin, allowedOrigins);
      res.writeHead(204);
      res.end();
      return;
    }

    setCorsHeaders(res, origin, allowedOrigins);
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/v1/health") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
        } satisfies AgentHealth),
      );
      return;
    }

    if (req.method === "POST" && req.url === "/v1/mission/start") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        let request: MissionStartRequest;
        try {
          request = parseMissionStartRequest(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }

        const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        missions.set(missionId, {
          cancelled: false,
          interval: null,
          prompt: request.prompt,
          projectRoot: resolveMissionRoot(
            configuredRoot,
            request.projectRoot,
          ),
          abortController: new AbortController(),
        });
        res.writeHead(200);
        res.end(JSON.stringify({ missionId }));
      });
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/v1/mission/") && req.url.endsWith("/stream")) {
      const missionId = req.url.split("/")[3];
      if (!missionId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "missing_mission_id" }));
        return;
      }
      const mission = missions.get(missionId);
      if (!mission) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "mission_not_found" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let events: AgentEvent[];
      try {
        events = runMission(mission);
      } catch (err) {
        events = [
          { t: "status", state: "working" },
          {
            t: "error",
            code: "mission_failed",
            message: err instanceof Error ? err.message : "mission_failed",
          },
          { t: "status", state: "idle" },
          { t: "done", summary: { filesChanged: 0, testsRun: 0 } },
        ];
      }

      let index = 0;
      const interval = setInterval(() => {
        if (mission.cancelled) {
          clearInterval(interval);
          res.end();
          return;
        }
        if (index < events.length) {
          res.write(`data: ${JSON.stringify(events[index])}\n\n`);
          index++;
        } else {
          clearInterval(interval);
          res.end();
          missions.delete(missionId);
        }
      }, 200);

      mission.interval = interval;
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/v1/mission/") && req.url.endsWith("/cancel")) {
      const missionId = req.url.split("/")[3];
      if (missionId) {
        const mission = missions.get(missionId);
        if (mission) {
          mission.cancelled = true;
          mission.abortController.abort();
        }
      }
      res.writeHead(200);
      res.end(JSON.stringify({ status: "cancelled" }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/shutdown") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "shutting_down" }));
      setTimeout(() => {
        for (const [, m] of missions) {
          if (m.interval) clearInterval(m.interval);
          m.abortController.abort();
        }
        server.close();
      }, 100);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "localhost", () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: actualPort,
        async stop(): Promise<void> {
          for (const [, m] of missions) {
            if (m.interval) clearInterval(m.interval);
            m.abortController.abort();
          }
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
    server.on("error", reject);
  });
}
