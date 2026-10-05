/**
 * Static guard: every config.json writer goes through writeConfigFileSecure (0600).
 * See change: harden-trust-and-credential-boundaries (D4; T-E30).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PKGS = path.resolve(__dirname, "../../..");
// Reviewed unrelated writers (do not touch config.json).
const ALLOW = new Set([
  "server/src/auth/locked-json-file.ts",
  "shared/src/doctor-core.ts", // log rotation
  "shared/src/platform/openspec.ts", // ~/.config/openspec/config.json
  "shared/src/tool-registry/overrides.ts", // separate overrides file
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe("config.json writers", () => {
  it("no raw writeFileSync/renameSync in modules that reference the config file", () => {
    const offenders: string[] = [];
    for (const pkg of ["server", "shared", "extension", "electron"]) {
      const root = path.join(PKGS, pkg, "src");
      if (!fs.existsSync(root)) continue;
      for (const f of walk(root)) {
        const rel = path.relative(PKGS, f).split(path.sep).join("/");
        if (ALLOW.has(rel)) continue;
        const src = fs.readFileSync(f, "utf-8");
        if (!/CONFIG_FILE|getConfigFile|["'`]config\.json["'`]/.test(src)) continue;
        if (/\b(writeFileSync|renameSync)\(/.test(src.replace(/function writeConfigFileSecure[\s\S]*?\n}\n/, ""))) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
