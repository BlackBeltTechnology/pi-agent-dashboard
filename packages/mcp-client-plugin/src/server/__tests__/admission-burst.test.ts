/**
 * Page-load burst: 25 DISTINCT worktrees of one pinned repo requested at once.
 *
 *   P2 — event-loop delay, before vs after. "Before" is the legacy synchronous
 *        guard (`isAllowedCwd`, up to 10 `spawnSync` probes per request) behind
 *        the same route shape; "after" is the shipped async, capped `admitCwd`.
 *        Real git, real worktrees. The measured numbers are printed and recorded
 *        in tasks 1.2 / 8.4.
 *   P1 — with git slowed to ~900 ms per probe, `/api/health` on the same server
 *        stays responsive (p99 < 250 ms) while the 25 admissions are pending.
 *
 * See change: harden-plugin-cwd-admission (test-plan #P1, #P2).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { isAllowedCwd } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { cleanupGitShims, makeSlowGitShim, resolveRealGit, useGitPath } from "@blackbelt-technology/pi-dashboard-shared/test-support/git-shim.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpClientConfigService } from "../../core/service.js";
import type { ConfigIO } from "../../core/types.js";
import { mountMcpClientRoutes } from "../routes.js";

const WORKTREES = 25;

let root: string;
let main: string;
let worktrees: string[];

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "admission-burst-")));
  main = join(root, "repo");
  mkdirSync(main);
  git(main, ["-c", "init.defaultBranch=main", "init"]);
  git(main, ["commit", "--allow-empty", "-m", "init"]);
  worktrees = Array.from({ length: WORKTREES }, (_, i) => {
    const wt = join(root, `wt-${i}`);
    git(main, ["worktree", "add", "-q", "-b", `wt${i}`, wt]);
    return wt;
  });
});

afterAll(() => {
  cleanupGitShims();
  rmSync(root, { recursive: true, force: true });
});

function io(): ConfigIO {
  return { readFile: () => null, writeFileAtomic: () => {} };
}

async function newServer(kind: "after" | "before"): Promise<{ app: FastifyInstance; base: string }> {
  const app = Fastify();
  app.get("/api/health", async () => ({ ok: true }));
  if (kind === "after") {
    const runtime = createMcpClientConfigService({
      configIO: io(),
      paths: { globalPath: () => "/g/mcp.json", projectPath: (cwd) => `${cwd}/.pi/mcp.json` },
      knownCwds: () => [main],
      isProjectTrusted: () => true,
      scratchCwd: "/tmp/mcp-scratch",
      runner: async () => ({ stdout: "{}", code: 0 }),
    });
    mountMcpClientRoutes(app, { runtime, knownCwds: () => [main], networkGuard: async () => undefined });
  } else {
    // The pre-change shape: the synchronous guard on the request path.
    app.get("/api/mcp-client/effective", async (request, reply) => {
      const cwd = (request.query as { cwd?: string }).cwd;
      if (!isAllowedCwd(cwd, () => [main])) return reply.code(403).send({ error: "not-allowed" });
      return { scope: "project", cwd, servers: [], layers: [] };
    });
  }
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, base: `http://127.0.0.1:${port}` };
}

/** Fire the 25-worktree burst; report event-loop delay and the `/api/health` latencies seen meanwhile. */
async function burst(base: string): Promise<{ p99Ms: number; healthMs: number[]; statuses: number[] }> {
  const hist = monitorEventLoopDelay({ resolution: 10 });
  hist.enable();
  const statuses: number[] = [];
  const healthMs: number[] = [];
  const requests = worktrees.map((wt) =>
    fetch(`${base}/api/mcp-client/effective?cwd=${encodeURIComponent(wt)}`).then(async (r) => {
      await r.arrayBuffer();
      statuses.push(r.status);
    }),
  );
  const all = Promise.all(requests).then(() => true);
  let done = false;
  void all.then(() => {
    done = true;
  });
  while (!done) {
    const t0 = performance.now();
    await fetch(`${base}/api/health`).then((r) => r.arrayBuffer());
    healthMs.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 50));
  }
  hist.disable();
  return { p99Ms: hist.percentile(99) / 1e6, healthMs, statuses };
}

const p99 = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
};

describe("25-worktree page-load burst", () => {
  it("P2: p99 event-loop delay is lower with async admission than with the legacy sync guard (real git)", async () => {
    const before = await newServer("before");
    const b = await burst(before.base);
    await before.app.close();
    const after = await newServer("after");
    const a = await burst(after.base);
    await after.app.close();

    // eslint-disable-next-line no-console
    console.log(`[P2] p99 event-loop delay: before=${b.p99Ms.toFixed(1)} ms, after=${a.p99Ms.toFixed(1)} ms`);
    expect(b.statuses.every((s) => s === 200)).toBe(true);
    expect(a.statuses.every((s) => s === 200)).toBe(true); // every worktree admitted, none a false 403/503
    expect(a.p99Ms).toBeLessThan(b.p99Ms);
  }, 120_000);

  it.skipIf(process.platform === "win32")(
    "P1: /api/health p99 stays under 250 ms while 25 admissions run with git at ~900 ms per probe",
    async () => {
      const shim = makeSlowGitShim(900, resolveRealGit());
      const restore = useGitPath(shim);
      const { app, base } = await newServer("after");
      try {
        const r = await burst(base);
        // eslint-disable-next-line no-console
        console.log(`[P1] /api/health p99=${p99(r.healthMs).toFixed(1)} ms over ${r.healthMs.length} polls`);
        expect(r.healthMs.length).toBeGreaterThan(5);
        expect(p99(r.healthMs)).toBeLessThan(250);
        // Nothing is mis-reported as a refusal: each is 200 (fast enough) or a transient 503.
        expect(r.statuses.every((s) => s === 200 || s === 503)).toBe(true);
      } finally {
        restore();
        await app.close();
      }
    },
    60_000,
  );
});
