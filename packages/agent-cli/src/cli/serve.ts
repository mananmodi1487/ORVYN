import { createAgentServer } from "../server/agent";
import { loadConfig } from "./config";

export async function serveCommand(): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  console.log(`Starting ORVYN agent on port ${config.port}...`);

  let agent: Awaited<ReturnType<typeof createAgentServer>>;
  try {
    agent = await createAgentServer(config.port, {
    projectRoot: config.projectRoot,
  });
  } catch (error) {
    console.error(
      `Failed to start agent: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  console.log(`ORVYN agent running at http://localhost:${agent.port}`);
  console.log(`Project root: ${config.projectRoot}`);
  console.log("Press Ctrl+C to stop");

  process.on("SIGINT", async () => {
    await agent.stop();
    console.log("\nAgent stopped.");
    process.exit(0);
  });

  await new Promise<void>(() => {});
}
