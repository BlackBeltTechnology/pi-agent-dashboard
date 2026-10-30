/**
 * E8 (slim-windows-install-file-count): the built-bundle layout gate. The workspace
 * source ships ONCE, under `node_modules/@blackbelt-technology/<pkg>`; `packages/`
 * holds only `dist` (the served client) and `package.json` has no `workspaces`.
 *
 * Fixture-driven here; CI runs the same script over the real bundle on every leg.
 *
 * See change: slim-windows-install-file-count (design D2).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { checkBundleLayout } from "../../scripts/assert-bundle-layout.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/assert-bundle-layout.mjs");
const check = checkBundleLayout as (dir: string) => { ok: boolean; errors: string[] };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

interface Opts {
  packages?: string[];
  cli?: boolean;
  pkgJson?: Record<string, unknown>;
}
function bundle(o: Opts = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-layout-"));
  dirs.push(dir);
  for (const p of o.packages ?? ["dist"]) fs.mkdirSync(path.join(dir, "packages", p), { recursive: true });
  if (o.cli !== false) {
    const cli = path.join(dir, "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "");
  }
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(o.pkgJson ?? { name: "pi-dashboard-bundled-server" }));
  return dir;
}

describe("checkBundleLayout", () => {
  it("accepts the canonical layout (packages/ == [dist], node_modules cli, no workspaces)", () => {
    expect(check(bundle())).toEqual({ ok: true, errors: [] });
  });

  it("rejects a leftover packages/<dir> copy, naming it", () => {
    const r = check(bundle({ packages: ["dist", "server", "extension"] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/packages\/.*extension.*server|extension, server/s);
  });

  it("rejects a missing node_modules server cli.ts", () => {
    const r = check(bundle({ cli: false }));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("cli.ts");
  });

  it("rejects a package.json that still carries `workspaces`", () => {
    const r = check(bundle({ pkgJson: { name: "x", workspaces: ["packages/server"] } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("workspaces");
  });

  it("rejects a missing packages/dist (the served client)", () => {
    const r = check(bundle({ packages: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("dist");
  });

  it("CLI exits 0 on a canonical bundle and 1 on a broken one", () => {
    const good = spawnSync(process.execPath, [SCRIPT, bundle()], { encoding: "utf8" });
    expect(good.status).toBe(0);
    const bad = spawnSync(process.execPath, [SCRIPT, bundle({ packages: ["dist", "server"] })], { encoding: "utf8" });
    expect(bad.status).toBe(1);
  });
});
