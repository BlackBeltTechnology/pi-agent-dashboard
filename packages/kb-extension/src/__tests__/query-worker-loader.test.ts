// Tests for change: bound-kb-proximity-search — loading the real query worker
// (design D7): process exit with no shutdown, silent stderr, published-package
// (node_modules) layout, no inherited loader flags. Folded from
// openspec/changes/bound-kb-proximity-search/test-plan.md (#W20, #W22, #W23, #W25).
// Exemplar: helpers/populate-child.mts + index-integrity-reindex.test.ts (child spawn).
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { indexSource, SqliteFtsStore } from "@blackbelt-technology/pi-dashboard-kb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createQueryWorkerHost } from "../query-worker-host.js";

const CHILD = fileURLToPath(new URL("./helpers/query-worker-child.mts", import.meta.url));
const NATIVE_TS = fileURLToPath(new URL("../../../shared/src/platform/native-ts-register.mjs", import.meta.url));
const SRC = fileURLToPath(new URL("..", import.meta.url));
const KB_PKG = fileURLToPath(new URL("../../../kb", import.meta.url));

let tmp: string;
let dbPath: string;
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "kb-qw-loader-"));
  const docs = join(tmp, "docs");
  mkdirSync(docs);
  for (let i = 0; i < 5; i++) writeFileSync(join(docs, `g${i}.md`), `# Guide ${i}\ntoken rotation guide ${i} — a body long enough to stay its own chunk after the merge pass.\n`);
  dbPath = join(tmp, "index.db");
  const store = new SqliteFtsStore(dbPath);
  store.init();
  await indexSource(store, { root: "docs", dir: docs });
  store.close();
}, 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type ChildOut = { code: number | null; ms: number; stdout: string; stderr: string; out?: { kind: string; hits: number; execArgv: unknown[] } };
function runChild(importFlag: string[]): Promise<ChildOut> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...importFlag, CHILD, dbPath], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" } });
    let stdout = "";
    let stderr = "";
    let printedAt = 0;
    child.stdout.on("data", (d) => { stdout += d; if (!printedAt && stdout.includes("\n")) printedAt = Date.now(); });
    child.stderr.on("data", (d) => (stderr += d));
    const cap = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", reject);
    child.on("close", (code) => { // after stdio drained, unlike "exit"
      clearTimeout(cap);
      const line = stdout.split("\n").find((l) => l.startsWith("{"));
      resolve({ code, ms: printedAt ? Date.now() - printedAt : Number.POSITIVE_INFINITY, stdout, stderr, out: line ? JSON.parse(line) : undefined });
    });
  });
}

describe("real query worker loading", () => {
  it("W20/W22/W25: one off-thread search; the process exits on its own ≤ 2 s; silent stderr; Worker execArgv []", async () => {
    const r = await runChild(["--import", "tsx"]);
    expect(r.code).toBe(0);
    expect(r.out?.kind).toBe("ok");
    expect(r.out?.hits).toBeGreaterThan(0);
    expect(r.ms).toBeLessThanOrEqual(2000);
    expect(r.stderr).toBe("");
    expect(r.out?.execArgv).toEqual([[]]);
  }, 40_000);

  it("W25: under the dashboard's native TS loader the worker loads without hook stacking", async () => {
    const r = await runChild(["--import", pathToFileURL(NATIVE_TS).href]);
    expect(r.stderr).not.toMatch(/Error|ERR_/);
    expect(r.code).toBe(0);
    expect(r.out?.kind).toBe("ok");
    expect(r.out?.hits).toBeGreaterThan(0);
    expect(r.out?.execArgv).toEqual([[]]);
  }, 40_000);

  it("W23: from a published layout (kb under node_modules) the worker strips TS and serves a search", async () => {
    const root = join(tmp, "published");
    const ext = join(root, "node_modules", "@blackbelt-technology", "pi-dashboard-kb-extension", "src");
    const kb = join(root, "node_modules", "@blackbelt-technology", "pi-dashboard-kb");
    mkdirSync(ext, { recursive: true });
    cpSync(join(SRC, "query-worker.mjs"), join(ext, "query-worker.mjs"));
    cpSync(join(SRC, "query-worker-entry.ts"), join(ext, "query-worker-entry.ts"));
    cpSync(join(KB_PKG, "package.json"), join(kb, "package.json"));
    cpSync(join(KB_PKG, "src"), join(kb, "src"), { recursive: true, filter: (p) => !p.includes("__tests__") });
    const host = createQueryWorkerHost({ useWorker: true, workerUrl: pathToFileURL(join(ext, "query-worker.mjs")) });
    try {
      const r = await host.run({ op: "search", dbPath, query: "token rotation", opts: { limit: 5 } }, {
        inProcess: () => { throw new Error("in-process fallback taken (worker failed to load)"); },
      });
      expect(r.kind).toBe("ok");
      expect((r as { value: unknown[] }).value.length).toBeGreaterThan(0);
    } finally {
      host.shutdown();
    }
  }, 40_000);
});
