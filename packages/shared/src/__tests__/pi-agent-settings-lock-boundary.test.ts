/**
 * `pi-agent-settings-lock` is NODE-ONLY (`proper-lockfile`, `node:fs`). The
 * shared package `exports` is a `./*` wildcard, so nothing in the package
 * metadata stops a client bundle from importing it. This scan does: no client
 * source (dashboard client or any plugin's `src/client/`) may import it, and
 * no shared barrel may re-export it.
 *
 * See change: stop-flows-edit-mode-project-writes (D3, test-plan #E13).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = path.resolve(__dirname, "../../..");
const SHARED_SRC = path.resolve(__dirname, "..");
const MODULE = "pi-agent-settings-lock";

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function clientRoots(): string[] {
  const roots = [path.join(PACKAGES, "client", "src")];
  for (const e of fs.readdirSync(PACKAGES, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.endsWith("-plugin")) roots.push(path.join(PACKAGES, e.name, "src", "client"));
  }
  return roots;
}

const importsModule = (src: string): boolean =>
  new RegExp(`(?:from|import)\\s*\\(?\\s*["'][^"']*${MODULE}(?:\\.js|\\.ts)?["']`).test(src);

describe("pi-agent-settings-lock boundary", () => {
  it("is imported by no client source", () => {
    const offenders = clientRoots()
      .flatMap((r) => walk(r))
      .filter((f) => importsModule(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(PACKAGES, f));
    expect(offenders).toEqual([]);
  });

  it("is re-exported by no shared barrel", () => {
    const barrels = walk(SHARED_SRC).filter((f) => /[/\\]index\.tsx?$/.test(f) && !f.includes("__tests__"));
    expect(barrels.length).toBeGreaterThan(0);
    const offenders = barrels.filter((f) => importsModule(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the matcher detects an import (self-check)", () => {
    expect(importsModule(`import { withPiSettingsLock } from "@blackbelt-technology/pi-dashboard-shared/${MODULE}.js";`)).toBe(true);
    expect(importsModule(`export * from "./${MODULE}.js";`)).toBe(true);
    expect(importsModule(`const m = await import("../${MODULE}");`)).toBe(true);
    expect(importsModule(`import { x } from "./pi-agent-settings.js";`)).toBe(false);
  });
});
