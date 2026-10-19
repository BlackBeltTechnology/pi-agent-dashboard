import * as fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgDir = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../..");

describe("package shape (E20)", () => {
  it("has no pi.extensions manifest entry and no root index", () => {
    const pkg = JSON.parse(fs.readFileSync(nodePath.join(pkgDir, "package.json"), "utf8"));
    expect(pkg.pi?.extensions).toBeUndefined();
    expect(pkg.pi).toBeUndefined();
    const root = fs.readdirSync(pkgDir);
    expect(root).not.toContain("index.ts");
    expect(root).not.toContain("index.js");
    expect(pkg.exports).toEqual({ ".": "./src/scope.ts", "./extension": "./src/extension.ts" });
  });

  /** @structural-pin scope.ts must stay importable by a plugin without loading pi, the server or the plugin runtime; only its import graph can prove it. */
  it("scope.ts's import graph never reaches pi, the server or the plugin runtime", () => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, "utf8");
      const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      for (const spec of specs) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/@earendil-works|dashboard-plugin-runtime|pi-dashboard-server|\/extension\.js$/);
        if (spec.startsWith(".")) walk(nodePath.resolve(nodePath.dirname(file), spec.replace(/\.js$/, ".ts")));
      }
    };
    walk(nodePath.join(pkgDir, "src", "scope.ts"));
    expect(seen.size).toBeGreaterThan(0);
  });
});
