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
import type {
  AdapterPort,
  ConfigIO,
  McpConfig,
  ServerProvenance,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DASHBOARD_MCP_KEY, provisionDashboardEntry } from "../provisioning.js";
import { McpTokenRegistry } from "../tokens.js";

let dir: string;
let target: string;

/** Adapter port pointing the global layer at the temp target. */
function fakePort(globalPath: string): AdapterPort {
  return {
    loadMcpConfig: () => Promise.resolve({} as McpConfig),
    getServerProvenance: () => Promise.resolve(new Map<string, ServerProvenance>()),
    getConfigDiscoveryPaths: () => [],
    getPiGlobalConfigPath: () => globalPath,
    getProjectPiConfigPath: (cwd) => `${cwd}/.pi/mcp.json`,
  };
}

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
    const r = provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
    expect(r).toEqual({ ok: true, action: "created" });
    expect(fs.existsSync(target)).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, "utf8")).mcpServers[DASHBOARD_MCP_KEY].url).toBe(
      "http://127.0.0.1:8000/mcp",
    );
  });

  it("writes with owner-only permissions", () => {
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
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
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
    const after = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(after.mcpServers.iMCP).toEqual(siblings.mcpServers.iMCP);
    expect(after.mcpServers.unrelated).toEqual(siblings.mcpServers.unrelated);
  });

  it("preserves unrelated nested top-level structure", () => {
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
    expect(JSON.parse(fs.readFileSync(target, "utf8")).topLevel).toEqual(siblings.topLevel);
  });

  it("adds exactly one key and leaves the file parseable", () => {
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
    const after = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(Object.keys(after.mcpServers).sort()).toEqual(
      ["iMCP", "unrelated", DASHBOARD_MCP_KEY].sort(),
    );
  });

  it("is idempotent across repeated runs", () => {
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
    const first = fs.readFileSync(target, "utf8");
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
    expect(fs.readFileSync(target, "utf8")).toBe(first);
  });
});

describe("J4 — atomicity leaves no observable partial file", () => {
  it("leaves no temp-file residue after a successful write", () => {
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
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

    const r = provisionDashboardEntry(interrupted, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });

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
      const r = provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
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

describe("X4 — no plaintext credential at rest, ever", () => {
  it("scans the config dir before, during and after mint→write→revoke: zero mcp_ values", () => {
    // A session mints, the provisioning write runs, the session is revoked.
    const tokens = new McpTokenRegistry();
    const token = tokens.mintForSession("session-a");
    provisionDashboardEntry(realIO, { url: "http://127.0.0.1:8000/mcp", adapter: fakePort(target) });
    const midFlight = fs.readFileSync(target, "utf8");
    tokens.revokeSession("session-a");

    // Scan EVERYTHING the flow touched on disk — before/during/after are the
    // same single artifact, and it never carried a credential.
    const files = fs.readdirSync(dir, { recursive: true }).map(String);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) {
        expect(fs.readFileSync(p, "utf8")).not.toMatch(/mcp_[A-Za-z0-9_-]{10,}/);
      }
    }
    // Sanity: the minted token WOULD have matched that scan had it leaked.
    expect(token).toMatch(/mcp_[A-Za-z0-9_-]{10,}/);
    expect(midFlight).not.toContain(token);
  });
});
