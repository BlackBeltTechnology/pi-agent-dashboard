/**
 * mcp.json provisioning and the adapter version probe.
 *
 * Covers J1 (HTTP url shape), J2 (protocolVersion never omitted), J3
 * (siblings preserved), J5 (unparseable refused), J6 (reserved key collision),
 * J7 (unwritable), J8 (first run) and X1-X3 (adapter floor diagnostics).
 */
import { describe, expect, it, vi } from "vitest";
import {
  ADAPTER_VERSION_FLOOR,
  type ConfigIO,
  DASHBOARD_MCP_KEY,
  PROVISIONED_PROTOCOL_VERSION,
  probeAdapterVersion,
  provisionDashboardEntry,
} from "../provisioning.js";

const PATH = "/home/u/.pi/agent/mcp.json";
const URL = "http://127.0.0.1:8000/mcp";

function io(initial: string | null): ConfigIO & { written: string | null } {
  const state = { current: initial, written: null as string | null };
  return {
    readFile: () => state.current,
    writeFileAtomic: (_p, content) => {
      state.written = content;
      state.current = content;
    },
    get written() {
      return state.written;
    },
  } as ConfigIO & { written: string | null };
}

const parse = (fs: { written: string | null }) => JSON.parse(fs.written ?? "{}");

describe("J8 — first run", () => {
  it("creates the file when none exists", () => {
    const fs = io(null);
    expect(provisionDashboardEntry(fs, PATH, URL)).toEqual({ ok: true, action: "created" });
    expect(parse(fs).mcpServers[DASHBOARD_MCP_KEY]).toBeDefined();
  });

  it("writes valid JSON with a trailing newline", () => {
    const fs = io(null);
    provisionDashboardEntry(fs, PATH, URL);
    expect(() => JSON.parse(fs.written as string)).not.toThrow();
    expect(fs.written?.endsWith("\n")).toBe(true);
  });

  it("treats an empty file as first run, not as corruption", () => {
    const fs = io("   \n");
    expect(provisionDashboardEntry(fs, PATH, URL).ok).toBe(true);
  });
});

describe("J1/J2 — entry shape", () => {
  it("J1 — declares the endpoint by url, not the stdio command shape", () => {
    const fs = io(null);
    provisionDashboardEntry(fs, PATH, URL);
    const entry = parse(fs).mcpServers[DASHBOARD_MCP_KEY];
    expect(entry.url).toBe(URL);
    expect(entry).not.toHaveProperty("command");
    expect(entry).not.toHaveProperty("args");
  });

  it("J2 — protocolVersion is never omitted (the legacy-default trap)", () => {
    const fs = io(null);
    provisionDashboardEntry(fs, PATH, URL);
    const entry = parse(fs).mcpServers[DASHBOARD_MCP_KEY];
    expect(entry.protocolVersion).toBe(PROVISIONED_PROTOCOL_VERSION);
    expect(entry.protocolVersion).toBeTruthy();
  });

  it("uses the reserved pi-dashboard key", () => {
    const fs = io(null);
    provisionDashboardEntry(fs, PATH, URL);
    expect(Object.keys(parse(fs).mcpServers)).toEqual([DASHBOARD_MCP_KEY]);
  });
});

describe("J3 — siblings are preserved", () => {
  const existing = JSON.stringify({
    mcpServers: {
      iMCP: { command: "/usr/local/bin/imcp", args: ["--stdio"] },
      unrelated: { url: "http://example.test/mcp", protocolVersion: "auto" },
    },
    someOtherTopLevelKey: { keep: "me" },
  });

  it("keeps every sibling entry byte-identical", () => {
    const fs = io(existing);
    provisionDashboardEntry(fs, PATH, URL);
    const after = parse(fs);
    expect(after.mcpServers.iMCP).toEqual({ command: "/usr/local/bin/imcp", args: ["--stdio"] });
    expect(after.mcpServers.unrelated).toEqual({
      url: "http://example.test/mcp",
      protocolVersion: "auto",
    });
  });

  it("keeps unrelated top-level keys", () => {
    const fs = io(existing);
    provisionDashboardEntry(fs, PATH, URL);
    expect(parse(fs).someOtherTopLevelKey).toEqual({ keep: "me" });
  });

  it("adds exactly one key", () => {
    const fs = io(existing);
    provisionDashboardEntry(fs, PATH, URL);
    expect(Object.keys(parse(fs).mcpServers).sort()).toEqual(
      ["iMCP", DASHBOARD_MCP_KEY, "unrelated"].sort(),
    );
  });
});

describe("J6 — the reserved key collision", () => {
  it("overwrites our own entry when the url changes (port moved)", () => {
    const fs = io(
      JSON.stringify({
        mcpServers: { [DASHBOARD_MCP_KEY]: { url: "http://127.0.0.1:9999/mcp", protocolVersion: "auto" } },
      }),
    );
    const r = provisionDashboardEntry(fs, PATH, URL);
    expect(r).toEqual({ ok: true, action: "updated" });
    expect(parse(fs).mcpServers[DASHBOARD_MCP_KEY].url).toBe(URL);
  });

  it("reports unchanged without rewriting when the entry already matches", () => {
    const fs = io(
      JSON.stringify({
        mcpServers: {
          [DASHBOARD_MCP_KEY]: { url: URL, protocolVersion: PROVISIONED_PROTOCOL_VERSION },
        },
      }),
    );
    const before = fs.written;
    expect(provisionDashboardEntry(fs, PATH, URL)).toEqual({ ok: true, action: "unchanged" });
    expect(fs.written).toBe(before);
  });

  it.each([
    ["a stdio command entry", { command: "/opt/other/thing", args: [] }],
    ["a string", "http://someone-elses-thing"],
    ["null", null],
    ["an array", []],
    ["a number", 42],
  ])("REFUSES the whole write when the key holds %s", (_label, foreign) => {
    const original = JSON.stringify({
      mcpServers: { [DASHBOARD_MCP_KEY]: foreign, iMCP: { command: "x" } },
    });
    const fs = io(original);
    const r = provisionDashboardEntry(fs, PATH, URL);

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ state: "FOREIGN_ENTRY" });
    // The file must be untouched — a partial write is the silent clobber J6
    // exists to forbid.
    expect(fs.written).toBeNull();
  });
});

describe("J5 — unparseable configs are refused, not repaired", () => {
  it.each([
    ["invalid JSON", "{ not json at all"],
    ["a JSON array root", "[1,2,3]"],
    ["a JSON string root", '"hello"'],
    ["a JSON number root", "42"],
    ["JSON null root", "null"],
  ])("refuses %s and leaves the file unmodified", (_label, raw) => {
    const fs = io(raw);
    const r = provisionDashboardEntry(fs, PATH, URL);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ state: "CONFIG_UNPARSEABLE" });
    expect(fs.written).toBeNull();
  });

  it("refuses when mcpServers is present but not an object", () => {
    const fs = io(JSON.stringify({ mcpServers: ["nope"] }));
    const r = provisionDashboardEntry(fs, PATH, URL);
    expect(r.ok).toBe(false);
    expect(fs.written).toBeNull();
  });

  it("surfaces the underlying parse message so the operator can find the defect", () => {
    const fs = io("{ not json at all");
    const r = provisionDashboardEntry(fs, PATH, URL);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.message).toContain(PATH);
  });
});

describe("J7 — an unwritable destination fails cleanly", () => {
  it("returns a write-failed result rather than throwing", () => {
    const fs: ConfigIO = {
      readFile: () => null,
      writeFileAtomic: () => {
        const err = new Error("EACCES: permission denied") as Error & { code: string };
        err.code = "EACCES";
        throw err;
      },
    };
    const r = provisionDashboardEntry(fs, PATH, URL);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ state: "CONFIG_WRITE_FAILED" });
    if (r.ok) throw new Error("unreachable");
    expect(r.message).toContain("EACCES");
  });

  it("does not throw, so the server keeps running", () => {
    const fs: ConfigIO = {
      readFile: () => null,
      writeFileAtomic: () => {
        throw new Error("ENOSPC");
      },
    };
    expect(() => provisionDashboardEntry(fs, PATH, URL)).not.toThrow();
  });
});

describe("J4 — atomicity is delegated, and the contract is asserted", () => {
  it("writes through writeFileAtomic exactly once, never a plain write", () => {
    const writeFileAtomic = vi.fn();
    provisionDashboardEntry({ readFile: () => null, writeFileAtomic }, PATH, URL);
    expect(writeFileAtomic).toHaveBeenCalledOnce();
    expect(writeFileAtomic).toHaveBeenCalledWith(PATH, expect.stringContaining(DASHBOARD_MCP_KEY));
  });

  it("performs no write at all on a refusal path", () => {
    const writeFileAtomic = vi.fn();
    provisionDashboardEntry({ readFile: () => "{bad", writeFileAtomic }, PATH, URL);
    expect(writeFileAtomic).not.toHaveBeenCalled();
  });
});

describe("X1-X3 — adapter version probe", () => {
  it("X3 — an absent adapter yields an actionable diagnostic, not a crash", () => {
    const r = probeAdapterVersion(null);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "absent" });
    if (r.ok) throw new Error("unreachable");
    expect(r.message).toContain(ADAPTER_VERSION_FLOOR);
  });

  it("X1 — 2.19.0 names both the floor and the installed version", () => {
    const r = probeAdapterVersion("2.19.0");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.message).toContain("2.19.0");
    expect(r.message).toContain(ADAPTER_VERSION_FLOOR);
    // The diagnostic must explain the FAILURE MODE, else a legacy-handshake
    // hang is near-undebuggable from the client side.
    expect(r.message).toMatch(/legacy handshake/i);
  });

  it.each([
    ["2.19.9", false],
    ["2.20.0", true],
    ["2.20.1", true],
    ["2.21.0", true],
    ["3.0.0", true],
    ["1.99.99", false],
    ["2.0.0", false],
  ])("X2 — boundary: %s is accepted=%s", (version, accepted) => {
    expect(probeAdapterVersion(version).ok).toBe(accepted);
  });

  it("an unparseable version is diagnosed rather than assumed good", () => {
    const r = probeAdapterVersion("next");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "unparseable" });
  });

  it("tolerates a prerelease suffix on an otherwise valid version", () => {
    expect(probeAdapterVersion("2.20.0-beta.1").ok).toBe(true);
  });
});
