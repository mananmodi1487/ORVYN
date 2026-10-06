import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig, DEFAULT_PORT } from "../../packages/agent-cli/src/cli/config";

describe("loadConfig", () => {
  it("returns default config when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    assert.equal(config.port, DEFAULT_PORT);
    assert.ok(typeof config.projectRoot === "string");
  });

  it("reads port and projectRoot from .orvyn/agent.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orvyn-agent-test-"));
    const configDir = path.join(tmpDir, ".orvyn");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "agent.json"),
      JSON.stringify({ port: 9999, projectRoot: "/my/project" })
    );

    const config = loadConfig(tmpDir);
    assert.equal(config.port, 9999);
    assert.equal(config.projectRoot, "/my/project");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to defaults when config file is invalid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orvyn-agent-test-"));
    const configDir = path.join(tmpDir, ".orvyn");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "agent.json"), "not json");

    const config = loadConfig(tmpDir);
    assert.equal(config.port, DEFAULT_PORT);
    assert.equal(config.projectRoot, tmpDir);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to defaults when port is not a number", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orvyn-agent-test-"));
    const configDir = path.join(tmpDir, ".orvyn");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "agent.json"),
      JSON.stringify({ port: "abc" })
    );

    const config = loadConfig(tmpDir);
    assert.equal(config.port, DEFAULT_PORT);
    assert.equal(config.projectRoot, tmpDir);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to defaults when projectRoot is not a string", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orvyn-agent-test-"));
    const configDir = path.join(tmpDir, ".orvyn");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "agent.json"),
      JSON.stringify({ projectRoot: 12345 })
    );

    const config = loadConfig(tmpDir);
    assert.equal(config.port, DEFAULT_PORT);
    assert.equal(config.projectRoot, tmpDir);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
