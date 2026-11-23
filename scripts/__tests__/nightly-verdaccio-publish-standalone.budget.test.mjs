/**
 * Real run of `scripts/nightly-verdaccio-publish.mjs` on a throwaway git worktree
 * (test-plan #E5, #E6, #X1): step (c) must regenerate `pnpm-lock.yaml` itself so
 * step (d)'s cross-ref gate passes with NO lockfile pre-step from the caller.
 *
 * Budget lane: named `*.budget.test.*`, so `BUDGET_TEST_EXCLUDE` (vitest.workers.ts)
 * keeps it out of every blocking run; run it with RUN_BUDGET_TESTS=1. It resolves
 * the full dependency graph against the real npm registry (network, minutes).
 * The publish step (e) targets a closed loopback port, so nothing is published.
 *
 * See change: fix-nightly-publish-pnpm-lockfile.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = "scripts/nightly-verdaccio-publish.mjs";
const TIMEOUT_MS = 600_000;
const GATE_LINE = "✓ All cross-ref specifiers match";

const fixtures = [];

function nextPatch(v) {
  const [maj, min, pat] = v.split(".").map((n) => Number.parseInt(n, 10));
  return `${maj}.${min}.${pat + 1}`;
}

function closedPort() {
  return new Promise((ok, fail) => {
    const srv = net.createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

async function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), "nightly-standalone-"));
  const dir = join(parent, "wt");
  execFileSync("git", ["worktree", "add", "--detach", dir, "HEAD"], { cwd: REPO_ROOT, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, SCRIPT), join(dir, SCRIPT));
  const base = nextPatch(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version);
  const version = `${base}-nightly.20990101.abcdef0`;
  const port = await closedPort();
  const fx = { parent, dir, version, registry: `http://127.0.0.1:${port}` };
  fixtures.push(fx);
  return fx;
}

function sh(fx, cmd, args, env = process.env) {
  return spawnSync(cmd, args, { cwd: fx.dir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function runScript(fx, env = process.env) {
  return sh(fx, process.execPath, [SCRIPT], { ...env, NIGHTLY_VERSION: fx.version, REGISTRY: fx.registry });
}

/** Every workspace cross-ref specifier recorded under pnpm-lock.yaml `importers:`. */
function workspaceCrossRefs(fx) {
  const names = new Set();
  for (const d of readdirSync(join(fx.dir, "packages"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      names.add(JSON.parse(readFileSync(join(fx.dir, "packages", d.name, "package.json"), "utf8")).name);
    } catch {
      // not a package
    }
  }
  const refs = [];
  let inImporters = false;
  let dep = null;
  for (const line of readFileSync(join(fx.dir, "pnpm-lock.yaml"), "utf8").split("\n")) {
    if (/^\S/.test(line)) inImporters = line.startsWith("importers:");
    if (!inImporters) continue;
    const d = /^ {6}'?([^':]+)'?:\s*$/.exec(line);
    if (d) dep = d[1];
    const s = /^ {8}specifier:\s*(.+?)\s*$/.exec(line);
    if (s && dep && names.has(dep)) refs.push({ dep, specifier: s[1] });
  }
  return refs;
}

afterAll(() => {
  for (const fx of fixtures) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", fx.dir], { cwd: REPO_ROOT, stdio: "ignore" });
    } catch {
      // fall through to rm
    }
    rmSync(fx.parent, { recursive: true, force: true });
  }
  try {
    execFileSync("git", ["worktree", "prune"], { cwd: REPO_ROOT, stdio: "ignore" });
  } catch {
    // best effort
  }
});

describe("nightly-verdaccio-publish standalone (real run)", () => {
  it(
    "#E5 passes the cross-ref gate with no prior lockfile regeneration",
    async () => {
      const fx = await createFixture();
      const r = runScript(fx);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain(`${GATE_LINE} ^${fx.version}`);
      const refs = workspaceCrossRefs(fx);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(ref.specifier, ref.dep).toBe(`^${fx.version}`);
      // Step (e) targets a closed port: fails there, after the gate.
      expect(r.status).not.toBe(0);
      expect(out).not.toContain("✓ Published");
    },
    TIMEOUT_MS,
  );

  it(
    "#E6 still passes when the caller pre-regenerated the lockfile",
    async () => {
      const fx = await createFixture();
      for (const [cmd, args] of [
        ["npm", ["pkg", "set", `version=${fx.version}`, "--workspaces", "--include-workspace-root"]],
        ["node", ["scripts/sync-versions.js"]],
        ["pnpm", ["install", "--lockfile-only"]],
      ]) {
        const p = sh(fx, cmd, args);
        expect(p.status, `${cmd} ${args.join(" ")}: ${p.stderr}`).toBe(0);
      }
      const r = runScript(fx);
      expect(`${r.stdout}${r.stderr}`).toContain(`${GATE_LINE} ^${fx.version}`);
      for (const ref of workspaceCrossRefs(fx)) expect(ref.specifier, ref.dep).toBe(`^${fx.version}`);
    },
    TIMEOUT_MS,
  );

  it(
    "#X1 fails before publishing when pnpm is missing from PATH",
    async () => {
      const fx = await createFixture();
      // PATH with node + npm only: symlinks in a private dir, plus system dirs without pnpm.
      const bin = join(fx.parent, "bin");
      mkdirSync(bin);
      symlinkSync(process.execPath, join(bin, "node"));
      const npmPath = execFileSync("which", ["npm"], { encoding: "utf8" }).trim();
      symlinkSync(npmPath, join(bin, "npm"));
      const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
      const probe = spawnSync("pnpm", ["--version"], { env, encoding: "utf8" });
      expect(probe.error?.code ?? probe.status, "fixture PATH must not resolve pnpm").not.toBe(0);
      const r = runScript(fx, env);
      const out = `${r.stdout}${r.stderr}`;
      expect(r.status).not.toBe(0);
      expect(out).not.toContain(GATE_LINE);
      expect(out).not.toMatch(/Publishing \d+ workspace\(s\) to /);
    },
    TIMEOUT_MS,
  );
});
