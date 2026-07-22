/**
 * Path-resolution tests (spec: "Resolve the hermes config file path").
 * See change: add-hermes-memory-settings-plugin.
 */
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { HERMES_CONFIG_FILENAME, resolveHermesConfigPath } from "../config-path.js";

describe("resolveHermesConfigPath", () => {
  it("defaults to <home>/.pi/agent/<filename> when PI_CODING_AGENT_DIR is unset", () => {
    const resolved = resolveHermesConfigPath({});
    expect(resolved).toBe(path.join(os.homedir(), ".pi", "agent", HERMES_CONFIG_FILENAME));
  });

  it("uses PI_CODING_AGENT_DIR when set", () => {
    const resolved = resolveHermesConfigPath({ PI_CODING_AGENT_DIR: "/tmp/agent" });
    expect(resolved).toBe(path.join("/tmp/agent", HERMES_CONFIG_FILENAME));
  });

  it("expands a leading ~ in PI_CODING_AGENT_DIR", () => {
    const resolved = resolveHermesConfigPath({ PI_CODING_AGENT_DIR: "~/custom-agent" });
    expect(resolved).toBe(path.join(os.homedir(), "custom-agent", HERMES_CONFIG_FILENAME));
  });

  it("trims whitespace around PI_CODING_AGENT_DIR", () => {
    const resolved = resolveHermesConfigPath({ PI_CODING_AGENT_DIR: "  /tmp/agent  " });
    expect(resolved).toBe(path.join("/tmp/agent", HERMES_CONFIG_FILENAME));
  });
});
