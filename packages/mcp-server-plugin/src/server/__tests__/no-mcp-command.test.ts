/**
 * The dashboard SHALL NOT take over pi's `/mcp` command — an extension that
 * registers `mcp` disables pi's built-in MCP, and with it the per-session
 * `pi-dashboard` registration (migrate-mcp-to-pi-builtin; test-plan E7).
 *
 * Loading every shipped extension against a recording fake `pi` would pull
 * in the whole bridge (WebSocket, timers), so every `pi.registerCommand(...)`
 * call site in shipped `packages/*\/src` is resolved statically instead:
 * the first argument must be a string literal or an exported string constant,
 * and none may be `mcp`. A dynamic name fails the test, so the scan cannot be
 * silently bypassed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = resolve(import.meta.dirname, "../../../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function collectCommandNames(): { names: string[]; unresolved: string[] } {
  const files = readdirSync(PACKAGES)
    .map((p) => join(PACKAGES, p, "src"))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap((d) => sourceFiles(d));
  const constants = new Map<string, string>();
  const sources = files.map((f) => ({ f, text: readFileSync(f, "utf8") }));
  for (const { text } of sources) {
    for (const m of text.matchAll(/export const ([A-Z_][A-Z0-9_]*)\s*=\s*["']([^"']+)["']/g)) constants.set(m[1], m[2]);
  }
  const names: string[] = [];
  const unresolved: string[] = [];
  for (const { f, text } of sources) {
    for (const m of text.matchAll(/\bpi\.registerCommand\(\s*([^,\s]+)/g)) {
      const arg = m[1];
      const lit = /^["'`]([^"'`]+)["'`]$/.exec(arg);
      if (lit) names.push(lit[1]);
      else if (constants.has(arg)) names.push(constants.get(arg) as string);
      else unresolved.push(`${f}: ${arg}`);
    }
  }
  return { names, unresolved };
}

describe("E7 — no dashboard package registers a pi `/mcp` command", () => {
  it("collects every registerCommand name and none is `mcp`", () => {
    const { names, unresolved } = collectCommandNames();
    expect(unresolved).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain("mcp");
  });
});
