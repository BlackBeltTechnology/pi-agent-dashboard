/**
 * #E12 (task 2.6): chat-gateway reads the verb→tier table from the shared
 * generated file and imports no mcp-server plugin path (plugin→plugin edge removed).
 */
import fs from "node:fs";
import path from "node:path";
import { GENERATED_VERB_TIERS } from "@blackbelt-technology/pi-dashboard-shared/mcp/verb-tiers.generated.js";
import { describe, expect, it } from "vitest";
import { tierOfVerb, VERB_TIERS } from "../tier.js";

const pkgRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("chat-gateway verb tiers come from shared data (E12)", () => {
  it("VERB_TIERS mirrors the shared generated table", () => {
    expect([...VERB_TIERS.entries()]).toEqual(GENERATED_VERB_TIERS.map((t) => [t.name, t.tier]));
    expect(tierOfVerb("list_sessions")).toBe(GENERATED_VERB_TIERS.find((t) => t.name === "list_sessions")?.tier);
  });

  it("imports no mcp-server-plugin path and declares no mcp-server-plugin dependency", () => {
    for (const f of walk(path.join(pkgRoot, "src")).filter((p) => !p.endsWith("tier-source.test.ts"))) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/from\s+["'][^"']*mcp-server-plugin/);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      expect(pkg[field]?.["@blackbelt-technology/pi-dashboard-mcp-server-plugin"], field).toBeUndefined();
    }
  });
});
