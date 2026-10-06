// @vitest-environment node
/**
 * P1 — design D8 budget: search p95 < 100 ms over 5,000 chunks / 500 files.
 * See change: improve-kb-settings-sources-and-search.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { KbJobRegistry } from "../job-registry.js";
import { mountKbRoutes, reindexAll } from "../kb-routes.js";

const root = mkdtempSync(join(tmpdir(), "kb-perf-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const WORDS = ["bridge", "session", "reindex", "dashboard", "plugin", "socket", "render", "cache", "queue", "router", "schema", "token"];

describe("kb search perf (P1)", () => {
  it("p95 over 50 varied 2-4 term queries < 100 ms", async () => {
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(root, ".pi", "dashboard"), { recursive: true });
    writeFileSync(join(root, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }] }));
    for (let f = 0; f < 500; f++) {
      let body = "";
      for (let h = 0; h < 10; h++) {
        const w = (n: number) => WORDS[(f * 7 + h * 3 + n) % WORDS.length];
        body += `## Section ${f}-${h} ${w(0)}\n\n${w(1)} ${w(2)} handles ${w(3)} for unit ${f} part ${h}; ${w(4)} then ${w(5)} ${f * 131 + h}. ${"filler ".repeat(30)}\n\n`;
      }
      writeFileSync(join(root, "docs", `f${f}.md`), `# File ${f}\n\n${body}`);
    }
    await reindexAll(root);

    const app = Fastify();
    mountKbRoutes(app, { knownCwds: () => [root], registry: new KbJobRegistry() });
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const terms = [WORDS[i % 12], WORDS[(i * 5 + 1) % 12], ...(i % 3 === 0 ? [WORDS[(i + 7) % 12]] : []), ...(i % 4 === 0 ? ["unit"] : [])];
      const t0 = performance.now();
      const res = await app.inject({ method: "GET", url: `/api/kb/search?cwd=${encodeURIComponent(root)}&q=${encodeURIComponent(terms.join(" "))}` });
      times.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95) - 1];
    console.log(`[kb-search-perf] p95=${p95.toFixed(1)}ms p50=${times[25].toFixed(1)}ms`);
    expect(p95).toBeLessThan(100);
    await app.close();
  }, 120_000);
});
