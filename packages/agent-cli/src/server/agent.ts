import http from "node:http";

export interface AgentServerHandle {
  port: number;
  stop(): Promise<void>;
}

export function createAgentServer(port: number): Promise<AgentServerHandle> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/shutdown") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "shutting_down" }));
      setTimeout(() => server.close(), 100);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
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
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
    server.on("error", reject);
  });
}
