/**
 * One-time removal of the legacy provisioned `pi-dashboard` entry, against the
 * REAL filesystem (migrate-mcp-to-pi-builtin D2; test-plan E6, X4).
 * Everything runs under `fs.mkdtemp`, never the operator's `~/.pi/agent/`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ConfigIO, createRealConfigIO } from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_MCP_KEY,
  isProvisionedDashboardEntry,
  logMigration,
  migrateProvisionedEntry,
} from "../legacy-entry-migration.js";

let dir: string;
let target: string;
const paths = () => ({ globalPath: () => target, projectPath: (cwd: string) => `${cwd}/.pi/mcp.json` });

const provisioned = (args0 = "/opt/pi-dashboard/packages/mcp-server-plugin/src/server/header-command.mjs") => ({
  url: "http://127.0.0.1:8000/mcp",
  protocolVersion: "2026-07-28",
  requestHeadersCommand: { command: "node", args: [args0], env: { PI_DASHBOARD_MCP_TOKEN: "${PI_DASHBOARD_MCP_TOKEN}" } },
});
const docs = { url: "https://docs.example/mcp" };

function write(content: unknown): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const raw = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
  fs.writeFileSync(target, raw);
  return raw;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-migrate-"));
  target = path.join(dir, "agent", "mcp.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("E6 — migration decision table", () => {
  it("(a) provisioned pi-dashboard + docs → only docs remains", () => {
    write({ mcpServers: { [DASHBOARD_MCP_KEY]: provisioned(), docs }, keep: 1 });
    const r = migrateProvisionedEntry(createRealConfigIO(), { paths: paths() });
    expect(r).toEqual({ action: "removed", path: target });
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ mcpServers: { docs }, keep: 1 });
  });

  it("(b) operator-shaped pi-dashboard is kept and reported as shadowing", () => {
    const raw = write({ mcpServers: { [DASHBOARD_MCP_KEY]: { url: "http://127.0.0.1:8000/mcp", headers: { Authorization: "Bearer x" } } } });
    const r = migrateProvisionedEntry(createRealConfigIO(), { paths: paths() });
    expect(r).toEqual({ action: "kept-operator-entry", path: target });
    expect(fs.readFileSync(target, "utf8")).toBe(raw);
    const warns: string[] = [];
    logMigration(r, { info: () => {}, warn: (m) => warns.push(m) });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/registration/);
  });

  it("(c) an unparseable file is byte-identical", () => {
    const raw = write("{ not json");
    const r = migrateProvisionedEntry(createRealConfigIO(), { paths: paths() });
    expect(r.action).toBe("skipped-unparseable");
    expect(fs.readFileSync(target, "utf8")).toBe(raw);
  });

  it("(d) a file with a // comment is byte-identical and reported not strict JSON", () => {
    const raw = write(`{\n  // provisioned by the dashboard\n  "mcpServers": { "${DASHBOARD_MCP_KEY}": ${JSON.stringify(provisioned())} }\n}\n`);
    const r = migrateProvisionedEntry(createRealConfigIO(), { paths: paths() });
    expect(r.action).toBe("skipped-unparseable");
    expect(fs.readFileSync(target, "utf8")).toBe(raw);
    const warns: string[] = [];
    logMigration(r, { info: () => {}, warn: (m) => warns.push(m) });
    expect(warns[0]).toMatch(/not strict JSON/);
    expect(warns[0]).toContain(target);
  });

  it("absent file / absent entry → nothing written, nothing logged", () => {
    const r = migrateProvisionedEntry(createRealConfigIO(), { paths: paths() });
    expect(r.action).toBe("absent");
    expect(fs.existsSync(target)).toBe(false);
    const lines: string[] = [];
    logMigration(r, { info: (m) => lines.push(m), warn: (m) => lines.push(m) });
    expect(lines).toEqual([]);
  });

  it("is idempotent", () => {
    write({ mcpServers: { [DASHBOARD_MCP_KEY]: provisioned(), docs } });
    migrateProvisionedEntry(createRealConfigIO(), { paths: paths() });
    const after = fs.readFileSync(target, "utf8");
    expect(migrateProvisionedEntry(createRealConfigIO(), { paths: paths() }).action).toBe("absent");
    expect(fs.readFileSync(target, "utf8")).toBe(after);
  });
});

describe("the provisioned signature", () => {
  it.each([
    [provisioned(), true],
    [provisioned("C:\\pi\\server\\header-command.mjs"), true],
    [provisioned("/x/not-header-command.mjs.bak"), false],
    [provisioned("/x/myheader-command.mjs"), false],
    [{ ...provisioned(), requestHeadersCommand: { command: "bash", args: ["/x/header-command.mjs"] } }, false],
    [{ url: "http://127.0.0.1:8000/mcp" }, false],
    [null, false],
  ])("%j → %s", (entry, expected) => {
    expect(isProvisionedDashboardEntry(entry)).toBe(expected);
  });
});

describe("X4 — a failed removal keeps the entry and the server start continues", () => {
  it("rename fails EACCES → entry kept, file byte-identical, one warn with the code", () => {
    const raw = write({ mcpServers: { [DASHBOARD_MCP_KEY]: provisioned(), docs } });
    const io: ConfigIO = {
      readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null),
      writeFileAtomic: () => {
        throw Object.assign(new Error("EACCES: permission denied, rename"), { code: "EACCES" });
      },
    };
    const r = migrateProvisionedEntry(io, { paths: paths() });
    expect(r).toMatchObject({ action: "failed", ioCode: "EACCES" });
    expect(fs.readFileSync(target, "utf8")).toBe(raw);
    const warns: string[] = [];
    expect(() => logMigration(r, { info: () => {}, warn: (m) => warns.push(m) })).not.toThrow();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("EACCES");
  });
});
