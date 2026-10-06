import http from "node:http";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAgentServer } from "../../packages/agent-cli/src/server/agent";

interface ShutdownResponse {
  status: string;
}

describe("start/stop lifecycle", () => {
  it("starts server and stops cleanly", async () => {
    const agent = await createAgentServer(0);

    const health1 = await new Promise<number>((resolve, reject) => {
      http.get(`http://localhost:${agent.port}/v1/health`, (res) => {
        resolve(res.statusCode ?? 0);
      }).on("error", reject);
    });
    assert.equal(health1, 200);

    await agent.stop();

    try {
      await new Promise<void>((resolve, reject) => {
        http.get(`http://localhost:${agent.port}/v1/health`, () => {
          resolve();
        }).on("error", () => {
          reject(new Error("connection_refused"));
        });
      });
      assert.fail("should have thrown after stop");
    } catch {
      // expected
    }
  });

  it("responds to shutdown endpoint", async () => {
    const agent = await createAgentServer(0);

    const response = await new Promise<{ status: number; json: () => Promise<ShutdownResponse> }>((resolve, reject) => {
      const req = http.request({
        hostname: "localhost",
        port: agent.port,
        path: "/v1/shutdown",
        method: "POST",
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            json: async () => JSON.parse(body) as ShutdownResponse,
          });
        });
      });
      req.on("error", reject);
      req.end();
    });

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "shutting_down");

    await new Promise((resolve) => setTimeout(resolve, 300));
    await agent.stop();
  });
});
