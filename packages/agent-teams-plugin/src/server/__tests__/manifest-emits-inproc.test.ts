/**
 * The in-process command channel is declared in the manifest `emits` (test-plan S31). The host refuses an undeclared
 * `emitEventToSession` type, so removing `agent-teams:inproc` from `emits` must fail the build: this test runs the
 * same scan as `src/__tests__/manifest-contract.test.ts` (the inventory) and also proves the NEGATIVE — with the entry
 * removed the scan reports the driver wiring as undeclared.
 * See change: add-agent-teams-in-process.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as ids from "../../shared/plugin-id.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const manifest = (JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as { "pi-dashboard-plugin": { emits?: string[] } })["pi-dashboard-plugin"];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") out.push(...sources(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

const constValues = new Map(Object.entries(ids).filter(([k]) => k.startsWith("AGENT_TEAMS_EVENT_")).map(([k, v]) => [k, v as string]));

/** Every `emitEventToSession(<session>, <type>` call whose type is not a declared literal / a constant listed in `emits`. */
function undeclaredEmits(emits: ReadonlySet<string>): string[] {
  const bad: string[] = [];
  for (const f of sources(path.join(PKG_ROOT, "src"))) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/emitEventToSession\(\s*[^,()]+,\s*([^,)\s]+)/g)) {
      const arg = m[1] as string;
      const literal = /^["'`](.+)["'`]$/.exec(arg)?.[1];
      const value = literal ?? constValues.get(arg);
      if (value === undefined || !emits.has(value)) bad.push(`${path.relative(PKG_ROOT, f)}: ${arg}`);
    }
  }
  return bad;
}

describe("agent-teams:inproc is declared in the manifest emits (S31)", () => {
  it("is present in emits, and the shared constant is the same value", () => {
    expect(manifest.emits).toContain("agent-teams:inproc");
    expect(ids.AGENT_TEAMS_EVENT_INPROC).toBe("agent-teams:inproc");
  });

  it("every emitEventToSession call in the server code passes a declared type", () => {
    expect(undeclaredEmits(new Set(manifest.emits ?? []))).toEqual([]);
  });

  it("negative: with agent-teams:inproc removed from emits the scan flags the in-process runtime wiring", () => {
    const without = new Set((manifest.emits ?? []).filter((e) => e !== "agent-teams:inproc"));
    const bad = undeclaredEmits(without);
    expect(bad.some((b) => b.includes("server/runtime.ts") && b.includes("AGENT_TEAMS_EVENT_INPROC"))).toBe(true);
  });
});
