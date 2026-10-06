import http from "node:http";
import { loadConfig } from "./config";

export async function statusCommand(): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const envPort = process.env.ORVYN_AGENT_PORT;
  const port = envPort ? Number(envPort) : config.port;

  try {
    const data = await new Promise<{ status: string }>((resolve, reject) => {
      http.get(`http://localhost:${port}/v1/health`, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid health response"));
          }
        });
      }).on("error", reject);
    });

    console.log(`Agent is running: ${data.status}`);
  } catch {
    console.log("Agent is not running.");
    process.exit(1);
  }
}
