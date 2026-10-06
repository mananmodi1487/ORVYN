import http from "node:http";
import { loadConfig } from "./config";

export async function stopCommand(): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const envPort = process.env.ORVYN_AGENT_PORT;
  const port = envPort ? Number(envPort) : config.port;

  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: "localhost",
        port,
        path: "/v1/shutdown",
        method: "POST",
      }, () => {
        resolve();
      });
      req.on("error", reject);
      req.end();
    });
    console.log("Agent stopped.");
  } catch {
    console.log("Agent is not running or could not be reached.");
    process.exit(1);
  }
}
