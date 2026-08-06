/**
 * `CommandInfo.path` is declared in the protocol but the bridge forwards pi's
 * raw command objects, where the path lives at `sourceInfo.path`. These tests
 * pin the mapping at `filterHiddenCommands()` — the one chokepoint every
 * `commands_list` sender passes through.
 *
 * See change: fix-skill-discovery-parity (test-plan X6, X8).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { filterHiddenCommands } from "../bridge-context.js";

describe("filterHiddenCommands maps sourceInfo.path onto path", () => {
  it("populates path for a skill command from pi's sourceInfo (3.1)", () => {
    const skillPath = "/Users/x/.pi/skills/ship-change/SKILL.md";
    const [cmd] = filterHiddenCommands([
      { name: "ship-change", source: "skill", sourceInfo: { path: skillPath } },
    ]);
    expect(cmd.path).toBe(skillPath);
    expect(cmd.source).toBe("skill");
  });

  it("emits path absent and does not throw when sourceInfo is missing (3.2, X8)", () => {
    expect(() => filterHiddenCommands([{ name: "plain", source: "builtin" }])).not.toThrow();
    const [cmd] = filterHiddenCommands([{ name: "plain", source: "builtin" }]);
    expect(cmd.path).toBeUndefined();
  });

  it("tolerates a sourceInfo with no path", () => {
    const [cmd] = filterHiddenCommands([{ name: "x", source: "skill", sourceInfo: {} }]);
    expect(cmd.path).toBeUndefined();
  });

  it("leaves an already-populated path untouched", () => {
    const [cmd] = filterHiddenCommands([
      { name: "x", source: "skill", path: "/explicit.md", sourceInfo: { path: "/other.md" } },
    ]);
    expect(cmd.path).toBe("/explicit.md");
  });

  it("still filters hidden and dashboard-native commands", () => {
    const out = filterHiddenCommands([
      { name: "__dashboard_reload", source: "extension" },
      { name: "roles", source: "extension" },
      { name: "keep", source: "skill", sourceInfo: { path: "/k.md" } },
    ]);
    expect(out.map((c) => c.name)).toEqual(["keep"]);
  });
});

describe("every commands_list sender routes through the chokepoint (3.4, X6)", () => {
  // Mapping at a single sender would let a reload, a flow rediscovery, or a
  // client command refresh replace a good retained list with a path-less one.
  const SENDERS = [
    "session-sync.ts", // register + spawn
    "flow-event-wiring.ts", // flow rediscover / complete
    "bridge.ts", // session_start (reload path)
    "command-handler.ts", // request_commands RPC
  ];

  it.each(SENDERS)("%s builds its commands_list via filterHiddenCommands", (file) => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
    const sendsCommands = /commands_list/.test(src);
    expect(sendsCommands, `${file} should send commands_list`).toBe(true);
    // Every `pi.getCommands()` read in a sender must be wrapped.
    const unwrapped = src
      .split(/\r?\n/)
      .filter((l) => /\.getCommands\(\)/.test(l) && !/filterHiddenCommands\(/.test(l));
    expect(unwrapped, `unwrapped getCommands() in ${file}`).toEqual([]);
  });

  it("session-sync.ts wraps both of its senders", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "session-sync.ts"), "utf8");
    expect(src.match(/filterHiddenCommands\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
