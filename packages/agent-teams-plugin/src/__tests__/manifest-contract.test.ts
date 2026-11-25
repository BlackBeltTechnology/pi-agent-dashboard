/**
 * Manifest contract (task 1.14): every event type the plugin emits into a
 * session MUST be listed in the manifest `emits` (the host enforces `emits`
 * server-side, so an unlisted type is dropped at runtime), and the manifest id
 * matches the shared constant. Later changes add entries to `emits` AND to the
 * source; this test fails when only one side moves.
 *
 * Scan convention: every event type is a literal `agent-teams:<name>` or one of
 * the `AGENT_TEAMS_EVENT_*` constants in `src/shared/plugin-id.ts`.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as ids from "../shared/plugin-id.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  id: string;
  emits?: string[];
  claims?: unknown[];
  bridge?: string;
  server?: string;
  client?: string;
  configSchema?: string;
}

const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
  "pi-dashboard-plugin": Manifest;
};
const manifest = pkg["pi-dashboard-plugin"];
const emits = new Set(manifest.emits ?? []);

/** Non-test sources whose emits count (server emits; bridge/shared must not drift). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const SRC = sourceFiles(path.join(PKG_ROOT, "src"));
const read = (f: string): string => fs.readFileSync(f, "utf8");

describe("agent-teams manifest emits contract", () => {
  it("manifest id equals the shared plugin id constant and entry files exist", () => {
    expect(manifest.id).toBe(ids.AGENT_TEAMS_PLUGIN_ID);
    for (const rel of [manifest.server, manifest.bridge, manifest.client, manifest.configSchema]) {
      expect(rel, "manifest entry path").toBeTruthy();
      expect(fs.existsSync(path.join(PKG_ROOT, rel as string)), `${rel} exists`).toBe(true);
    }
    expect(Array.isArray(manifest.claims), "claims are asserted in manifest.test.ts (add-agent-teams-ui)").toBe(true);
  });

  it("emits entries are unique, namespaced `agent-teams:` exact names", () => {
    const list = manifest.emits ?? [];
    expect(new Set(list).size).toBe(list.length);
    for (const t of list) expect(t).toMatch(/^agent-teams:[a-z][a-z0-9_]*$/);
  });

  it("every `agent-teams:<name>` literal in the sources is listed in emits", () => {
    const unlisted: string[] = [];
    for (const f of SRC) {
      for (const m of read(f).matchAll(/["'`](agent-teams:[A-Za-z0-9_.:-]+)["'`]/g)) {
        if (!emits.has(m[1])) unlisted.push(`${path.relative(PKG_ROOT, f)}: ${m[1]}`);
      }
    }
    expect(unlisted).toEqual([]);
  });

  it("every AGENT_TEAMS_EVENT_* constant is listed in emits, and every emits entry has a constant", () => {
    const values = Object.entries(ids)
      .filter(([k]) => k.startsWith("AGENT_TEAMS_EVENT_"))
      .map(([, v]) => v as string);
    for (const v of values) expect(emits.has(v), `${v} in emits`).toBe(true);
    expect([...emits].sort()).toEqual([...values].sort());
  });

  it("every emitEventToSession call passes a listed literal or an AGENT_TEAMS_EVENT_* constant", () => {
    const bad: string[] = [];
    const constValues = new Map(
      Object.entries(ids)
        .filter(([k]) => k.startsWith("AGENT_TEAMS_EVENT_"))
        .map(([k, v]) => [k, v as string]),
    );
    for (const f of SRC) {
      for (const m of read(f).matchAll(/emitEventToSession\(\s*[^,()]+,\s*([^,)\s]+)/g)) {
        const arg = m[1];
        const literal = /^["'`](.+)["'`]$/.exec(arg)?.[1];
        const ok = literal !== undefined ? emits.has(literal) : constValues.has(arg);
        if (!ok) bad.push(`${path.relative(PKG_ROOT, f)}: ${arg}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
