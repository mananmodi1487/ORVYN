#!/usr/bin/env node
import { program } from "commander";
import { serveCommand } from "../src/cli/serve";
import { statusCommand } from "../src/cli/status";
import { stopCommand } from "../src/cli/stop";

program
  .name("orvyn-agent")
  .description("ORVYN local coding agent — development skeleton")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the local agent")
  .action(serveCommand);

program
  .command("status")
  .description("Show agent status")
  .action(statusCommand);

program
  .command("stop")
  .description("Stop the local agent")
  .action(stopCommand);

program.parse();
