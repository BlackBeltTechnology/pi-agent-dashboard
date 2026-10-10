/**
 * test-plan #E19 — the embedded fixture app's code is reachable only through a
 * dynamic import. The generated plugin registry imports the client entry
 * STATICALLY (named imports of every claimed component), so the entry must
 * export the route component as `React.lazy` and must not statically import
 * the route module or the app definition. See change: add-plugin-app-host (D8).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.resolve(SRC, "..", "package.json"), "utf8")) as {
  "pi-dashboard-plugin": { client: string; claims: Array<{ slot: string; component?: string; presentation?: string }> };
};

/** Static `import … from "x"` / `export … from "x"` specifiers (not `import("x")`). */
function staticImports(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
}

describe("demo embedded app is lazy (test-plan #E19)", () => {
  const manifest = pkg["pi-dashboard-plugin"];
  const claim = manifest.claims.find((c) => c.slot === "shell-overlay-route" && c.presentation === "content");

  it("declares a content claim whose component the client entry exports", () => {
    expect(claim?.component).toBe("DemoAppRoute");
    expect(manifest.client).toBe("./src/client.tsx");
  });

  it("client entry exports the route component as React.lazy", async () => {
    const mod = (await import("../client.js")) as Record<string, unknown>;
    const route = mod.DemoAppRoute as { $$typeof?: symbol } | undefined;
    expect(route?.$$typeof).toBe(Symbol.for("react.lazy"));
  });

  it("client entry reaches the route module only via import()", () => {
    const entry = read("client.tsx");
    expect(entry).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/demo-app\/DemoAppRoute\.js["']\s*\)\s*\)/);
    const statics = staticImports(entry);
    expect(statics.some((s) => s.includes("demo-app/"))).toBe(false);
    expect(statics.some((s) => s.includes("embedded-app") || s.includes("app-kit"))).toBe(false);
  });

  it("only the lazily-loaded route module imports the fixture app", () => {
    expect(staticImports(read("demo-app/DemoAppRoute.tsx"))).toContain("./fixture-app.js");
    for (const rel of ["client.tsx", "server/index.ts", "bridge/index.ts"]) {
      expect(read(rel)).not.toContain("fixture-app");
    }
  });
});
