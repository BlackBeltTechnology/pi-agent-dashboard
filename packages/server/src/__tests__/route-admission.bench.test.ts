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
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { registerGitRoutes } from "../routes/git-routes.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";
import { addLinkedWorktree, cleanupAdmissionDirs, makeGitRepo, tmpDir } from "./helpers/admission-test-kit.js";

const WARMUP = 20;
const N = 200;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const KNOWN_SIZE = Math.max(30, Number(process.env.PI_BENCH_LIST_ALL ?? 0) || 0);
const q = encodeURIComponent;

async function appWith(known: string[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerGitRoutes(app, { networkGuard: async () => {}, knownCwds: () => known });
  registerOpenSpecRoutes(app, {
    sessionManager: { listAll: () => known.map((cwd, i) => ({ id: `s${i}`, cwd })) } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    directoryService: { refreshOpenSpec: vi.fn(), getOpenSpecData: vi.fn() } as never,
    networkGuard: async () => {},
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

    // One unreadable known entry: parent dir mode 000, entry inside it.
    const locked = tmpDir("bench-locked-");
    const entry = join(locked, "child");
    mkdirSync(entry);
    writeFileSync(join(entry, "f"), "x");
    chmodSync(locked, 0o000);
    try {
      const eacces = await appWith([repo, entry]);
      const unknown = tmpDir("bench-unknown-");
      const u = await sample(eacces, `/api/git/status?cwd=${q(unknown)}`, 50, 5);
      const k = await sample(eacces, `/api/git/status?cwd=${q(repo)}`, 50, 5);
      console.log(row("P3 EACCES entry, unknown cwd", u.ms, ` statuses=${JSON.stringify([...u.codes])}`));
      console.log(row("P3 EACCES entry, session cwd", k.ms, ` statuses=${JSON.stringify([...k.codes])}`));
      expect(u.codes.get(503)).toBe(50);
      expect(k.codes.get(200)).toBe(50);
    } finally {
      chmodSync(locked, 0o755);
    }
  }, 120_000);
});
