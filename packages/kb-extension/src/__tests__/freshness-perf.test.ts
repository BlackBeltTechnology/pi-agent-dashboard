// Bounded freshness on a pathological tree (change: bound-kb-search-freshness,
// test-plan #P2; K1 max event-loop delay <= 250 ms, K3 scaled-down ~5k dirs).
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import kbExtension from "../extension.js";

type Tool = { execute: (id: string, p: Record<string, unknown>, s: undefined, u: undefined, ctx: { cwd: string }) => Promise<{ content: { text: string }[] }> };

describe("freshness on a deep tree (P2)", () => {
  let dir = "";
  afterEach(() => {
    delete process.env.KB_FRESHNESS_BUDGET_MS;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("P2: ~5k dirs (~1k gitignored), cold index, budget 1500 → kb_search returns within budget + 250 ms with bounded event-loop lag", async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-perf-"));
    mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(join(dir, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db" }));
    const docs = join(dir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, ".gitignore"), "skip-*/\n");
    let dirs = 0;
    for (let g = 0; g < 100; g++) {
      const gd = join(docs, g % 5 === 0 ? `skip-${g}` : `g${g}`);
      mkdirSync(gd);
      for (let i = 0; i < 50; i++) { mkdirSync(join(gd, `d${i}`)); dirs++; }
      writeFileSync(join(gd, "n.md"), `# Note ${g}\n\nA token note body long enough to be indexed as its own chunk number ${g} here.\n`);
    }
    expect(dirs).toBeGreaterThanOrEqual(5000);
    const tools = new Map<string, Tool>();
    kbExtension({ registerTool: (t: Tool & { name: string }) => tools.set(t.name, t), on: () => {} } as unknown as Parameters<typeof kbExtension>[0]);
    process.env.KB_FRESHNESS_BUDGET_MS = "1500";
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const t0 = performance.now();
    const r = await tools.get("kb_search")!.execute("i", { query: "token" }, undefined, undefined, { cwd: dir });
    const elapsed = performance.now() - t0;
    h.disable();
    expect(r.content[0].text.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThanOrEqual(1500 + 250);
    expect(h.max / 1e6).toBeLessThanOrEqual(250);
  }, 30_000);

  it("X10: slow fs (~5 ms per directory over ~200 dirs), budget 50 → returns ≤ 50 + 250 ms with the building line; lag bounded", async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-slowfs-"));
    mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
    writeFileSync(join(dir, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }], dbPath: ".pi/dashboard/kb/index.db" }));
    const docs = join(dir, "docs");
    mkdirSync(docs);
    for (let i = 0; i < 200; i++) {
      mkdirSync(join(docs, `d${i}`));
      writeFileSync(join(docs, `d${i}`, "n.md"), `# Note ${i}\n\nA token note body long enough to be indexed as its own chunk number ${i} here.\n`);
    }
    const tools = new Map<string, Tool>();
    kbExtension({ registerTool: (t: Tool & { name: string }) => tools.set(t.name, t), on: () => {} } as unknown as Parameters<typeof kbExtension>[0]);
    const realReaddir = fs.readdirSync;
    // Synchronous per-directory latency, like a slow network mount.
    (fs as { readdirSync: unknown }).readdirSync = ((...a: unknown[]) => {
      const t = performance.now();
      while (performance.now() - t < 5) { /* busy wait */ }
      return (realReaddir as (...x: unknown[]) => unknown)(...a);
    }) as typeof fs.readdirSync;
    syncBuiltinESMExports();
    process.env.KB_FRESHNESS_BUDGET_MS = "50";
    const h = monitorEventLoopDelay({ resolution: 10 });
    try {
      h.enable();
      const t0 = performance.now();
      const r = await tools.get("kb_search")!.execute("i", { query: "token" }, undefined, undefined, { cwd: dir });
      const elapsed = performance.now() - t0;
      h.disable();
      expect(r.content[0].text).toContain("(index is still being built");
      expect(elapsed).toBeLessThanOrEqual(50 + 250);
      expect(h.max / 1e6).toBeLessThanOrEqual(250);
      await new Promise((res) => setTimeout(res, 2500)); // let the abandoned background pass finish before restoring fs
    } finally {
      h.disable();
      (fs as { readdirSync: unknown }).readdirSync = realReaddir;
      syncBuiltinESMExports();
    }
  }, 30_000);
});
