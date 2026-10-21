/**
 * @structural-pin static scan of module source text is the only way to prove nothing writes pi shellPath
 *
 * The dashboard never writes pi's `shellPath` setting (it is user-global,
 * code-executing, and would pin a path that breaks when the install dir moves).
 * Bundled bash reaches pi only through PATH order. Static scan of the modules
 * this change touched.
 *
 * See change: fix-windows-bundled-bash-exe (test-plan #E28).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const FILES = [
  "packages/shared/src/platform/ensure-bundled-git.ts",
  "packages/shared/src/platform/git-source.ts",
  "packages/shared/src/platform/resolve-pi-shell.ts",
  "packages/server/src/terminal/terminal-manager.ts",
  "packages/server/src/config-api.ts",
  "packages/server/src/server.ts",
];

describe("no shellPath write into pi settings (E28)", () => {
  it("none of the touched modules assigns or serialises a `shellPath` key into pi settings", () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const offenders: string[] = [];
    for (const rel of FILES) {
      const lines = fs.readFileSync(path.join(repoRoot, rel), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return;
        if (!/shellPath/.test(line)) return;
        // The readout's own `shellPath` field (git-source.ts) is a diagnostic, not a
        // pi setting; every OTHER mention must not touch settings/writes at all.
        const isReadoutField = rel.endsWith("platform/git-source.ts") && !/settings|writeFile|setSetting/i.test(line);
        if (!isReadoutField) offenders.push(`${rel}:${i + 1}  ${t}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
