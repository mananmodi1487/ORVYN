import http from "node:http";
import type { AgentHealth, AgentEvent } from "../protocol";

export interface AgentServerHandle {
  port: number;
  stop(): Promise<void>;
}

type MissionState = {
  cancelled: boolean;
  interval: ReturnType<typeof setInterval> | null;
};

export function createAgentServer(port: number): Promise<AgentServerHandle> {
  const missions = new Map<string, MissionState>();

  const server = http.createServer((req, res) => {
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
        const missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        missions.set(missionId, { cancelled: false, interval: null });
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

      const events: AgentEvent[] = [
        { t: "status", state: "working" },
        { t: "tool", id: "1", name: "read_file", args: { path: "src/..." } },
        { t: "result", id: "1", output: "file contents..." },
        { t: "diff", file: "src/...", patch: "@@ ..." },
        { t: "status", state: "idle" },
        { t: "done", summary: { filesChanged: 1, testsRun: 0 } },
      ];

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
        }
        server.close();
      }, 100);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: actualPort,
        async stop(): Promise<void> {
          for (const [, m] of missions) {
            if (m.interval) clearInterval(m.interval);
          }
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
    server.on("error", reject);
  });
}
