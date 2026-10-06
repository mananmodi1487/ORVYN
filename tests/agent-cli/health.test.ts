import http from "node:http";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAgentServer } from "../../packages/agent-cli/src/server/agent";

interface HealthResponse {
  status: string;
  timestamp: string;
}

describe("health endpoint", () => {
  it("returns 200 with JSON health status", async () => {
    const agent = await createAgentServer(0);
    const url = `http://localhost:${agent.port}/v1/health`;

    const response = await new Promise<{ status: number; json: () => Promise<HealthResponse> }>((resolve, reject) => {
      http.get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            json: async () => JSON.parse(body) as HealthResponse,
          });
        });
      }).on("error", reject);
    });

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "ok");
    assert.ok(typeof data.timestamp === "string");

    await agent.stop();
  });

  it("returns 404 for unknown routes", async () => {
    const agent = await createAgentServer(0);

    const status = await new Promise<number>((resolve, reject) => {
      http.get(`http://localhost:${agent.port}/v1/unknown`, (res) => {
        resolve(res.statusCode ?? 0);
      }).on("error", reject);
    });

    assert.equal(status, 404);

    await agent.stop();
  });
});
