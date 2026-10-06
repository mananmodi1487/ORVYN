import fs from "node:fs";
import path from "node:path";

export interface AgentConfig {
  port: number;
  projectRoot: string;
}

export const DEFAULT_PORT = 3456;
const CONFIG_FILE = ".orvyn/agent.json";

export function loadConfig(cwd: string): AgentConfig {
  const configPath = path.join(cwd, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const port = typeof parsed.port === "number" ? parsed.port : DEFAULT_PORT;
      const projectRoot = typeof parsed.projectRoot === "string" ? parsed.projectRoot : cwd;
      return { port, projectRoot };
    } catch {
      // fall through to defaults
    }
  }
  return { port: DEFAULT_PORT, projectRoot: cwd };
}
