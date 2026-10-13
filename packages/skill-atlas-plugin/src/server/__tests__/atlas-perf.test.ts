// @vitest-environment node
/**
 * Atlas performance budget (spec "Atlas performance budget").
 * P1: unchanged request at 100 skills — p95 < 100 ms over 200 requests.
 * P2: full rebuild at 300 skills × 256 KiB bodies — < 500 ms (median of 5).
 * Exemplar: packages/kb-plugin/src/server/__tests__/kb-search-perf.test.ts.
 * See change: add-skill-atlas-screen (test-plan #P1, #P2).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiResource, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { createAtlasService } from "../atlas-service.js";
import { GRAPH_ROUTE, mountAtlasRoutes } from "../routes.js";

const root = mkdtempSync(join(tmpdir(), "atlas-perf-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const TOKENS = ["ctx_execute", "kb_search", "memory_search", "web_search", "skill_manage", "fetch_content"];

function fixture(n: number, bodyBytes: number): PiResourcesResult {
  const skills: PiResource[] = [];
  for (let i = 0; i < n; i++) {
    const id = `perf-skill-${String(i).padStart(3, "0")}`;
    const dir = join(root, `${n}-${bodyBytes}`, id);
    mkdirSync(dir, { recursive: true });
    const mention = `see perf-skill-${String((i * 7 + 3) % n).padStart(3, "0")} and \`${TOKENS[i % TOKENS.length]}\`. `;
    const filler = "lorem ipsum dolor sit amet ".repeat(Math.ceil(bodyBytes / 27));
    const filePath = join(dir, "SKILL.md");
    writeFileSync(filePath, (mention + filler).slice(0, bodyBytes));
    skills.push({ name: id, description: `${id} desc`, filePath, type: "skill", enabled: true });
  }
  const empty = { extensions: [], skills: [], prompts: [], agents: [], themes: [] };
  return { local: { ...empty, skills }, global: empty, packages: [] };
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.ceil((p / 100) * xs.length) - 1];

describe("atlas perf", () => {
  it("P1: unchanged request at 100 skills, p95 < 100 ms", async () => {
    const res = fixture(100, 4096);
    const app = Fastify();
    await mountAtlasRoutes(app, createAtlasService({ getPiResources: async () => res, broadcast: () => {} }));
    const url = `${GRAPH_ROUTE}?scope=project&cwd=${encodeURIComponent(root)}`;
    expect((await app.inject({ url })).statusCode).toBe(200); // warm memo
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const r = await app.inject({ url });
      times.push(performance.now() - t0);
      expect(r.statusCode).toBe(200);
    }
    await app.close();
    expect(pct(times, 95)).toBeLessThan(100);
  });

  it("P2: rebuild at 300 skills × 256 KiB, median < 500 ms", async () => {
    const res = fixture(300, 256 * 1024);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const svc = createAtlasService({ getPiResources: async () => res, broadcast: () => {} });
      const t0 = performance.now();
      const g = await svc.getGraph("project", root);
      times.push(performance.now() - t0);
      expect(g.skills).toHaveLength(300);
    }
    expect(pct(times, 50)).toBeLessThan(500);
  }, 60_000);
});
