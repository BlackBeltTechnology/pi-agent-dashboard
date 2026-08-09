/**
 * L1 — config file location (test-plan E15, and the E23 "installed-ness is NOT
 * inferred from the filesystem" guard).
 *
 * See change: add-blackhole-plugin.
 */
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLACKHOLE_CONFIG_DIR,
  BLACKHOLE_CONFIG_FILENAME,
  resolveAgentRoot,
  resolveBlackholeConfigPath,
} from "../config-path.js";

describe("agent-directory resolution mirrors the extension (E15)", () => {
  it("falls back to ~/.pi/agent when PI_CODING_AGENT_DIR is unset", () => {
    expect(resolveBlackholeConfigPath({})).toBe(
      path.join(os.homedir(), ".pi", "agent", "pi-blackhole", "pi-blackhole-config.json"),
    );
  });

  it("honours PI_CODING_AGENT_DIR", () => {
    expect(resolveBlackholeConfigPath({ PI_CODING_AGENT_DIR: "/tmp/alt" })).toBe(
      path.join("/tmp/alt", "pi-blackhole", "pi-blackhole-config.json"),
    );
  });

  it("expands a leading ~ and trims whitespace", () => {
    expect(resolveAgentRoot({ PI_CODING_AGENT_DIR: "  ~/alt-agent  " })).toBe(
      path.join(os.homedir(), "alt-agent"),
    );
  });

  it("ignores an empty PI_CODING_AGENT_DIR", () => {
    expect(resolveAgentRoot({ PI_CODING_AGENT_DIR: "   " })).toBe(
      path.join(os.homedir(), ".pi", "agent"),
    );
  });
});

describe("the path carries no request-derived segment", () => {
  it("keeps the directory and filename as fixed constants", () => {
    expect(BLACKHOLE_CONFIG_DIR).toBe("pi-blackhole");
    expect(BLACKHOLE_CONFIG_FILENAME).toBe("pi-blackhole-config.json");
  });

  it("resolves to agentRoot + the two constants and nothing else (E23)", () => {
    // The config path is derived only from the environment. Nothing in this
    // module can report whether the EXTENSION is installed — that answer comes
    // from pi's package registry, never from the presence of this directory.
    const root = resolveAgentRoot({ PI_CODING_AGENT_DIR: "/tmp/alt" });
    expect(resolveBlackholeConfigPath({ PI_CODING_AGENT_DIR: "/tmp/alt" })).toBe(
      path.join(root, BLACKHOLE_CONFIG_DIR, BLACKHOLE_CONFIG_FILENAME),
    );
  });
});
