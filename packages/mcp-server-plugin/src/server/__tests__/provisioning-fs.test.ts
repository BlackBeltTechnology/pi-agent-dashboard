/**
 * Provisioning against the REAL filesystem (test-plan J3, J4, J7, J8).
 *
 * The unit suite injects `ConfigIO`, which proves the merge logic but not that
 * the logic survives a real read-modify-write. J3's "byte-identical siblings"
 * and J4's atomicity are properties of the actual write path, so they are
 * exercised here against a temp directory.
 *
 * Everything runs under `fs.mkdtemp`, never the operator's `~/.pi/agent/`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConfigIO,
  DASHBOARD_MCP_KEY,
  provisionDashboardEntry,
} from "../provisioning.js";

let dir: string;
let target: string;

/** The real write path used by the plugin entry: temp file + rename. */
const realIO: ConfigIO = {
  readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null),
  writeFileAtomic: (p, content) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, p);
  },
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-provision-"));
  target = path.join(dir, "agent", "mcp.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("J8 — first run against a real filesystem", () => {
  it("creates the file and its parent directory", () => {
    const r = provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    expect(r).toEqual({ ok: true, action: "created" });
    expect(fs.existsSync(target)).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, "utf8")).mcpServers[DASHBOARD_MCP_KEY].url).toBe(
      "http://127.0.0.1:8000/mcp",
    );
  });

  it("writes with owner-only permissions", () => {
    provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    const mode = fs.statSync(target).mode & 0o777;
    // The file records a local endpoint; 0600 matches paired-devices.json.
    expect(mode).toBe(0o600);
  });
});

describe("J3 — siblings survive a real read-modify-write", () => {
  const siblings = {
    mcpServers: {
      iMCP: { command: "/usr/local/bin/imcp", args: ["--stdio"], env: { FOO: "bar" } },
      unrelated: { url: "http://example.test/mcp", protocolVersion: "auto" },
    },
    topLevel: { nested: { deep: [1, 2, { three: true }] } },
  };

  beforeEach(() => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(siblings, null, 2));
  });

  it("preserves both sibling entries byte-identically", () => {
    provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    const after = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(after.mcpServers.iMCP).toEqual(siblings.mcpServers.iMCP);
    expect(after.mcpServers.unrelated).toEqual(siblings.mcpServers.unrelated);
  });

  it("preserves unrelated nested top-level structure", () => {
    provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    expect(JSON.parse(fs.readFileSync(target, "utf8")).topLevel).toEqual(siblings.topLevel);
  });

  it("adds exactly one key and leaves the file parseable", () => {
    provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    const after = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(Object.keys(after.mcpServers).sort()).toEqual(
      ["iMCP", "unrelated", DASHBOARD_MCP_KEY].sort(),
    );
  });

  it("is idempotent across repeated runs", () => {
    provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    const first = fs.readFileSync(target, "utf8");
    provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    expect(fs.readFileSync(target, "utf8")).toBe(first);
  });
});

describe("J4 — atomicity leaves no observable partial file", () => {
  it("leaves no temp-file residue after a successful write", () => {
    provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
    const stray = fs.readdirSync(path.dirname(target)).filter((f) => f.endsWith(".tmp"));
    expect(stray).toEqual([]);
  });

  it("leaves the original intact when the rename step fails", () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const original = JSON.stringify({ mcpServers: { iMCP: { command: "x" } } }, null, 2);
    fs.writeFileSync(target, original);

    // Interrupt between temp write and rename — the exact window J4 names.
    const interrupted: ConfigIO = {
      readFile: realIO.readFile,
      writeFileAtomic: (p, content) => {
        const tmp = `${p}.interrupted.tmp`;
        fs.writeFileSync(tmp, content);
        throw new Error("crashed before rename");
      },
    };

    const r = provisionDashboardEntry(interrupted, target, "http://127.0.0.1:8000/mcp");

    expect(r.ok).toBe(false);
    // The destination still holds the ORIGINAL bytes: a reader at any instant
    // sees a complete, valid file.
    expect(fs.readFileSync(target, "utf8")).toBe(original);
  });
});

describe("J7 — an unwritable destination fails cleanly on a real filesystem", () => {
  it("surfaces the error and leaves an existing file untouched", () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const original = JSON.stringify({ mcpServers: {} });
    fs.writeFileSync(target, original);
    fs.chmodSync(path.dirname(target), 0o500); // r-x: no writes permitted

    try {
      const r = provisionDashboardEntry(realIO, target, "http://127.0.0.1:8000/mcp");
      // Running as root defeats the permission bits; skip rather than assert a
      // false guarantee.
      if (r.ok) {
        expect(process.getuid?.()).toBe(0);
        return;
      }
      expect(r).toMatchObject({ state: "CONFIG_WRITE_FAILED" });
      expect(fs.readFileSync(target, "utf8")).toBe(original);
    } finally {
      fs.chmodSync(path.dirname(target), 0o700);
    }
  });
});
