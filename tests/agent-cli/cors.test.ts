import http from "node:http";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAgentServer } from "../../packages/agent-cli/src/server/agent";

const ALLOWED_ORIGINS = ["http://localhost:3000", "http://orvyn.vercel.app"];

async function request(
  port: number,
  options: {
    method?: string;
    path?: string;
    origin?: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const { method = "GET", path = "/", origin, headers = {} } = options;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "localhost",
      port,
      path,
      method,
      headers: {
        ...headers,
        ...(origin ? { Origin: origin } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("CORS", () => {
  it("allows a configured ORVYN origin", async () => {
    const agent = await createAgentServer(0, { allowedOrigins: ALLOWED_ORIGINS });

    const res = await request(agent.port, {
      method: "GET",
      path: "/v1/health",
      origin: "http://localhost:3000",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:3000");
    assert.ok(res.headers["vary"]?.includes("Origin"));
    assert.equal(res.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
    assert.equal(res.headers["access-control-allow-headers"], "Content-Type, Accept");

    await agent.stop();
  });

  it("allows a production ORVYN origin", async () => {
    const agent = await createAgentServer(0, { allowedOrigins: ALLOWED_ORIGINS });

    const res = await request(agent.port, {
      method: "GET",
      path: "/v1/health",
      origin: "http://orvyn.vercel.app",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "http://orvyn.vercel.app");

    await agent.stop();
  });

  it("rejects a disallowed origin", async () => {
    const agent = await createAgentServer(0, { allowedOrigins: ALLOWED_ORIGINS });

    const res = await request(agent.port, {
      method: "GET",
      path: "/v1/health",
      origin: "http://evil.example",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], undefined);

    await agent.stop();
  });

  it("handles OPTIONS preflight for allowed origin", async () => {
    const agent = await createAgentServer(0, { allowedOrigins: ALLOWED_ORIGINS });

    const res = await request(agent.port, {
      method: "OPTIONS",
      path: "/v1/mission/start",
      origin: "http://localhost:3000",
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Accept",
      },
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:3000");
    assert.equal(res.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
    assert.equal(res.headers["access-control-allow-headers"], "Content-Type, Accept");
    assert.equal(res.headers["access-control-max-age"], "86400");

    await agent.stop();
  });

  it("rejects OPTIONS preflight for disallowed origin", async () => {
    const agent = await createAgentServer(0, { allowedOrigins: ALLOWED_ORIGINS });

    const res = await request(agent.port, {
      method: "OPTIONS",
      path: "/v1/mission/start",
      origin: "http://evil.example",
      headers: {
        "Access-Control-Request-Method": "POST",
      },
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], undefined);

    await agent.stop();
  });

  it("still returns health without CORS when no origin header is sent", async () => {
    const agent = await createAgentServer(0, { allowedOrigins: ALLOWED_ORIGINS });

    const res = await request(agent.port, {
      method: "GET",
      path: "/v1/health",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
    assert.equal(JSON.parse(res.body).status, "ok");

    await agent.stop();
  });
});
