/**
 * Latency of core cwd admission on the hot path. Opt-in (`PI_BENCH=1`) so the default suite stays
 * deterministic; prints the numbers recorded in `evidence/latency.md`.
 *
 *  P1  direct match: p50 <= +2 ms and p99 <= +15 ms for a known set of max(30, listAll) vs 1.
 *  P2  derivation path: 0 indeterminate over 200 sequential requests on a sessionless worktree.
 *  P3  recorded: 8 concurrent derivation-path requests; one EACCES known entry + an unknown cwd.
 *
 * `PI_BENCH_LIST_ALL=<n>` sets the live `sessionManager.listAll()` size to size the known set.
 * See change: core-cwd-admission (test-plan P1–P3, design D5).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdmitCwdOptions } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { gateFilePath, registerFileRoutes } from "../routes/file-routes.js";
import { registerGitRoutes } from "../routes/git-routes.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";
import { addLinkedWorktree, cleanupAdmissionDirs, makeGitRepo, realpathFailingFor, tmpDir } from "./helpers/admission-test-kit.js";

const WARMUP = 20;
const N = 200;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const KNOWN_SIZE = Math.max(30, Number(process.env.PI_BENCH_LIST_ALL ?? 0) || 0);
const q = encodeURIComponent;

async function appWith(known: string[], admitOptions?: AdmitCwdOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerGitRoutes(app, { networkGuard: async () => {}, knownCwds: () => known, ...(admitOptions ? { admitOptions } : {}) });
  registerOpenSpecRoutes(app, {
    sessionManager: { listAll: () => known.map((cwd, i) => ({ id: `s${i}`, cwd })) } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    directoryService: { refreshOpenSpec: vi.fn(), getOpenSpecData: vi.fn() } as never,
    networkGuard: async () => {},
    ...(admitOptions ? { admitOptions } : {}),
  });
  await app.ready();
  return app;
}

async function sample(app: FastifyInstance, url: string, n = N, warmup = WARMUP): Promise<{ ms: number[]; codes: Map<number, number> }> {
  for (let i = 0; i < warmup; i++) await app.inject({ method: "GET", url });
  const ms: number[] = [];
  const codes = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res = await app.inject({ method: "GET", url });
    ms.push(performance.now() - t0);
    codes.set(res.statusCode, (codes.get(res.statusCode) ?? 0) + 1);
  }
  return { ms, codes };
}
const row = (label: string, ms: number[], extra = "") =>
  `[bench] ${label}: p50=${pct(ms, 0.5).toFixed(2)}ms p99=${pct(ms, 0.99).toFixed(2)}ms${extra}`;

describe.skipIf(process.env.PI_BENCH !== "1")("core cwd admission latency", () => {
  afterAll(() => cleanupAdmissionDirs());

  it(`P1: direct-match admission adds <= 2 ms p50 / <= 15 ms p99 at ${KNOWN_SIZE} known folders vs 1`, async () => {
    const session = makeGitRepo({ openspec: true });
    const others = Array.from({ length: KNOWN_SIZE - 1 }, () => tmpDir("bench-known-"));
    const small = await appWith([session]);
    const large = await appWith([session, ...others]);
    for (const [label, url] of [
      ["git status", `/api/git/status?cwd=${q(session)}`],
      ["openspec tasks", `/api/openspec/tasks?cwd=${q(session)}&change=x`],
    ] as const) {
      const a = await sample(small, url);
      const b = await sample(large, url);
      console.log(row(`P1 ${label} known=1`, a.ms));
      console.log(row(`P1 ${label} known=${KNOWN_SIZE}`, b.ms));
      expect(pct(b.ms, 0.5) - pct(a.ms, 0.5)).toBeLessThanOrEqual(2);
      expect(pct(b.ms, 0.99) - pct(a.ms, 0.99)).toBeLessThanOrEqual(15);
    }
  }, 120_000);

  it("P2: a sessionless worktree of a pinned repo is never indeterminate in a healthy environment", async () => {
    const repo = makeGitRepo();
    const wt = addLinkedWorktree(repo, "bench-p2");
    const app = await appWith([repo]);
    const { ms, codes } = await sample(app, `/api/git/status?cwd=${q(wt)}`);
    console.log(row("P2 derivation path (worktree of pinned repo)", ms, ` statuses=${JSON.stringify([...codes])}`));
    expect(codes.get(503) ?? 0).toBe(0);
    expect(codes.get(200)).toBe(N);
  }, 120_000);

  it("P3: recorded — 8 concurrent derivation-path requests, and one EACCES known entry", async () => {
    const repo = makeGitRepo();
    const wt = addLinkedWorktree(repo, "bench-p3");
    const app = await appWith([repo]);
    const wave = async (url: string, rounds = 25): Promise<{ ms: number[]; s503: number }> => {
      const ms: number[] = [];
      let s503 = 0;
      for (let r = 0; r < rounds; r++) {
        await Promise.all(
          Array.from({ length: 8 }, async () => {
            const t0 = performance.now();
            const res = await app.inject({ method: "GET", url });
            ms.push(performance.now() - t0);
            if (res.statusCode === 503) s503++;
          }),
        );
      }
      return { ms, s503 };
    };
    const conc = await wave(`/api/git/status?cwd=${q(wt)}`);
    console.log(row("P3 8 concurrent derivation path", conc.ms, ` 503s=${conc.s503}/${conc.ms.length}`));

    // One unreadable known entry (EACCES), injected through the admission realpath seam so the case does
    // not depend on the process privileges (root bypasses mode 000).
    const entry = join(tmpDir("bench-locked-"), "child");
    const eacces = await appWith([repo, entry], { realpath: realpathFailingFor(entry) });
    const unknown = tmpDir("bench-unknown-");
    const u = await sample(eacces, `/api/git/status?cwd=${q(unknown)}`, 50, 5);
    const k = await sample(eacces, `/api/git/status?cwd=${q(repo)}`, 50, 5);
    console.log(row("P3 EACCES entry, unknown cwd", u.ms, ` statuses=${JSON.stringify([...u.codes])}`));
    console.log(row("P3 EACCES entry, session cwd", k.ms, ` statuses=${JSON.stringify([...k.codes])}`));
    expect(u.codes.get(503)).toBe(50);
    expect(k.codes.get(200)).toBe(50);
  }, 120_000);
});

// ── File-family routes + live preview (change: core-file-cwd-admission, test-plan P1–P5, design D6) ──

/** stderr, not `console.log`: the suite stubs console output. */
const emit = (line: string): void => void process.stderr.write(`${line}\n`);

async function fileAppWith(known: string[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [] } as never,
    preferencesStore: { getPinnedDirectories: () => [], getWorkspaces: () => [] } as never,
    networkGuard: async () => {},
    routeAdmission: { knownCwds: () => known },
  });
  registerGitRoutes(app, { networkGuard: async () => {}, knownCwds: () => known });
  await app.ready();
  return app;
}

describe.skipIf(process.env.PI_BENCH !== "1")("file-route cwd admission latency (core-file-cwd-admission D6)", () => {
  afterAll(() => cleanupAdmissionDirs());
  const FILE_KNOWN = Math.max(100, KNOWN_SIZE);

  it(`P1: GET /api/file direct match adds <= 2 ms p50 / <= 15 ms p99 at ${FILE_KNOWN} known folders vs 1`, async () => {
    const dir = tmpDir("bench-file-");
    writeFileSync(join(dir, "a.txt"), "x");
    const others = Array.from({ length: FILE_KNOWN - 1 }, () => tmpDir("bench-known-"));
    const small = await fileAppWith([dir]);
    const large = await fileAppWith([dir, ...others]);
    const url = `/api/file?cwd=${q(dir)}&path=a.txt`;
    const a = await sample(small, url);
    const b = await sample(large, url);
    emit(row("P1 GET /api/file known=1", a.ms));
    emit(row(`P1 GET /api/file known=${FILE_KNOWN}`, b.ms));
    expect(pct(b.ms, 0.5) - pct(a.ms, 0.5)).toBeLessThanOrEqual(2);
    expect(pct(b.ms, 0.99) - pct(a.ms, 0.99)).toBeLessThanOrEqual(15);
  }, 120_000);

  it("P2: GET /api/file on a sessionless worktree of a pinned repo is never indeterminate", async () => {
    const repo = makeGitRepo();
    const wt = addLinkedWorktree(repo, "bench-file-p2");
    writeFileSync(join(wt, "a.txt"), "x");
    const app = await fileAppWith([repo]);
    const { ms, codes } = await sample(app, `/api/file?cwd=${q(wt)}&path=a.txt`);
    emit(row("P2 GET /api/file derivation path", ms, ` statuses=${JSON.stringify([...codes])}`));
    expect(codes.get(503) ?? 0).toBe(0);
    expect(codes.get(200)).toBe(N);
  }, 120_000);

  it("P3: the per-asset live-preview re-check on a direct-match target costs <= 10 ms p95", async () => {
    const dir = tmpDir("bench-asset-");
    writeFileSync(join(dir, "a.css"), "a".repeat(20 * 1024));
    const routeAdmission = { knownCwds: () => [dir] };
    for (let i = 0; i < WARMUP; i++) await gateFilePath(dir, "a.css", routeAdmission, { allowGrant: true, quiet: true });
    const ms: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const gate = await gateFilePath(dir, "a.css", routeAdmission, { allowGrant: true, quiet: true });
      ms.push(performance.now() - t0);
      expect("code" in gate).toBe(false);
    }
    emit(row("P3 per-asset re-check (direct match)", ms, ` p95=${pct(ms, 0.95).toFixed(2)}ms`));
    expect(pct(ms, 0.95)).toBeLessThanOrEqual(10);
  }, 120_000);

  it("P4a: recorded baseline — the same 20 concurrent git routes on distinct worktrees WITHOUT a preview", async () => {
    const repos = Array.from({ length: 20 }, () => makeGitRepo());
    const worktrees = repos.map((r, i) => addLinkedWorktree(r, `bench-p4a-${i}`));
    const app = await fileAppWith(repos);
    const gitMs: number[] = [];
    let s503 = 0;
    await Promise.all(
      worktrees.map(async (wt) => {
        const t0 = performance.now();
        const res = await app.inject({ method: "GET", url: `/api/git/status?cwd=${q(wt)}` });
        gitMs.push(performance.now() - t0);
        if (res.statusCode === 503) s503++;
      }),
    );
    emit(row("P4a git status x20 distinct worktrees, no preview", gitMs, ` 503s=${s503}/${gitMs.length}`));
  }, 300_000);

  it("P4: a 50-asset derived-worktree preview does not starve 20 concurrent git routes on distinct worktrees", async () => {
    const previewRepo = makeGitRepo();
    const previewWt = addLinkedWorktree(previewRepo, "bench-p4-preview");
    writeFileSync(join(previewWt, "a.css"), "x");
    const repos = Array.from({ length: 20 }, () => makeGitRepo());
    const worktrees = repos.map((r, i) => addLinkedWorktree(r, `bench-p4-${i}`));
    const known = [previewRepo, ...repos];
    const app = await fileAppWith(known);
    const routeAdmission = { knownCwds: () => known };
    const gitMs: number[] = [];
    let gitIndeterminate = 0;
    let previewIndeterminate = 0;
    const gitWave = Promise.all(
      worktrees.map(async (wt) => {
        const t0 = performance.now();
        const res = await app.inject({ method: "GET", url: `/api/git/status?cwd=${q(wt)}` });
        gitMs.push(performance.now() - t0);
        if (res.statusCode === 503) gitIndeterminate++;
      }),
    );
    const assetMs: number[] = [];
    let nextAsset = 0;
    // 6 concurrent fetch workers share the 50 assets; each worker checks its asset before the next.
    const worker = async () => {
      while (nextAsset++ < 50) {
        const t0 = performance.now();
        const gate = await gateFilePath(previewWt, "a.css", routeAdmission, { allowGrant: true, quiet: true });
        assetMs.push(performance.now() - t0);
        if ("code" in gate && gate.code === 503) previewIndeterminate++;
      }
    };
    await Promise.all([gitWave, ...Array.from({ length: 6 }, worker)]);
    emit(row("P4 git status under preview load", gitMs, ` 503s=${gitIndeterminate}/${gitMs.length}`));
    emit(row("P4 per-asset re-check (derived)", assetMs, ` 503s=${previewIndeterminate}/${assetMs.length}`));
    expect(gitIndeterminate).toBe(0);
    expect(previewIndeterminate).toBe(0);
    expect(pct(gitMs, 0.99)).toBeLessThanOrEqual(3000);
  }, 300_000);

  it("P5: recorded — per-asset re-check on a derived worktree and 16 concurrent GET /api/file/raw", async () => {
    const repo = makeGitRepo();
    const wt = addLinkedWorktree(repo, "bench-p5");
    writeFileSync(join(wt, "a.png"), "x");
    const routeAdmission = { knownCwds: () => [repo] };
    const first = performance.now();
    await gateFilePath(wt, "a.png", routeAdmission, { allowGrant: true, quiet: true });
    const firstMs = performance.now() - first;
    const ms: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await gateFilePath(wt, "a.png", routeAdmission, { allowGrant: true, quiet: true });
      ms.push(performance.now() - t0);
    }
    emit(row("P5 per-asset re-check (derived)", ms, ` p95=${pct(ms, 0.95).toFixed(2)}ms first=${firstMs.toFixed(0)}ms`));
    expect(firstMs).toBeLessThanOrEqual(3000);

    const dir = tmpDir("bench-raw-");
    writeFileSync(join(dir, "a.png"), "x");
    const app = await fileAppWith([dir]);
    const raw: number[] = [];
    for (let r = 0; r < 25; r++) {
      await Promise.all(
        Array.from({ length: 16 }, async () => {
          const t0 = performance.now();
          await app.inject({ method: "GET", url: `/api/file/raw?cwd=${q(dir)}&path=a.png` });
          raw.push(performance.now() - t0);
        }),
      );
    }
    emit(row("P5 16 concurrent GET /api/file/raw (direct match)", raw));
  }, 300_000);
});
