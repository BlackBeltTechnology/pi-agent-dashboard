/**
 * Cold-chunk budget (design D9; task 9.5/9.7, test-plan S79 plugin half): the
 * eager part of the plugin — the static `catalog` export and the badge — lands
 * in the dashboard's cold index chunk, which has no headroom to spare.
 *
 * - the eager catalog adds ≤ 400 B gz over core's one-key catalog (measured here
 *   standalone, a conservative bound: in the real chunk the strings share the
 *   deflate window with ~2 MB of neighbours; the measured in-chunk delta is
 *   recorded in the change's tasks);
 * - no `@mdi` import anywhere in the eager closure (entry + badge + routes + refs);
 * - the lazy modules are not imported from the eager closure.
 * `packages/client/src/__tests__/mdi-chunk-size.test.ts` keeps guarding the real
 * built chunk WITHOUT a raised cap (build-conditional, runs in CI).
 * See change: add-agent-teams-ui.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { catalog } from "../i18n.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Core's catalog before this change (one `title` key per locale). */
const CORE_CATALOG = { en: { title: "Agent Teams" }, "zh-CN": { title: "智能体团队" }, hu: { title: "Ügynökcsapatok" } };
const BUDGET_GZ_BYTES = 400;

const gz = (v: unknown): number => gzipSync(JSON.stringify(v), { level: 9 }).length;

/** Every module reachable from `src/client/index.tsx` through relative imports/re-exports. */
function eagerClosure(): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [path.join(SRC, "client", "index.tsx")];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    seen.set(file, src);
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = path.resolve(path.dirname(file), (m[1] as string).replace(/\.js$/, ""));
      const resolved = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((e) => base + e).find((f) => fs.existsSync(f));
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

describe("eager catalog budget (S79)", () => {
  it("the catalog delta over core's one-key catalog is ≤ 400 B gz", () => {
    const delta = gz(catalog) - gz(CORE_CATALOG);
    expect(delta, `eager catalog delta ${delta} B gz`).toBeLessThanOrEqual(BUDGET_GZ_BYTES);
  });

  it("the whole eager catalog stays small in absolute terms (≤ 600 B gz) so a regrowth is noticed", () => {
    expect(gz(catalog)).toBeLessThanOrEqual(600);
  });
});

describe("eager closure (S79)", () => {
  const closure = eagerClosure();
  const rel = [...closure.keys()].map((f) => path.relative(SRC, f)).sort();

  it("is exactly the entry, the badge, the predicate, the route table and the catalog", () => {
    expect(rel).toEqual(["client/TeamBadge.tsx", "client/index.tsx", "client/routes.ts", "client/team-refs.ts", "i18n.ts"]);
  });

  it("imports no @mdi package (no icon in the cold chunk)", () => {
    for (const [file, src] of closure) expect(src, path.relative(SRC, file)).not.toMatch(/@mdi\//);
  });

  it("imports none of the lazy modules, the store, the parsers or the status table", () => {
    const forbidden = ["TeamView", "MailEntryCard", "TeamToolRenderers", "teams-store", "teams-feeder", "teams-hooks", "mail-parse", "status-map", "announcements", "tool-families"];
    for (const [file, src] of closure) for (const name of forbidden) expect(src, `${path.relative(SRC, file)} → ${name}`).not.toContain(name);
  });
});
