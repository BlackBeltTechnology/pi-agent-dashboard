/**
 * Repo-lint: workflow token scope + dependency-cache poisoning
 * (change: harden-ci-cache-poisoning, D3/D6; test-plan E1–E14, X1, X2).
 *
 * WHY. The repo default `GITHUB_TOKEN` is write, and a cache entry saved by a
 * develop-scope run can be restored by a later tag/dispatch run. So a cache
 * restored into a job that holds a write scope, `id-token`, a non-GITHUB_TOKEN
 * secret, or that builds a release asset lets planted code run with release
 * credentials. This file pins two invariants over EVERY workflow:
 *   - no job runs on the repository-default token (rule 0), and
 *   - no release-privileged job restores a dependency cache (rules 1–3), with
 *     a ships-in-release guard keeping the hand-kept list honest (rule 4).
 *
 * RULES (checkWorkflows):
 *   0. Explicit tokens. Every job's permissions are explicit: top-level block
 *      or a job-level block. The seven files in TOP_READ_FILES have a top-level
 *      block EXACTLY equal to `{contents: read}`.
 *   1. No cache in release-privileged step-jobs: no `actions/cache*` step and no
 *      non-empty cache-enabling key (CACHE_KEYS) in any step.
 *   2. Callers of `_electron-build.yml`: a release-privileged caller passes the
 *      boolean `use_dependency_cache: false`; DEV_CACHE_CALLERS pass boolean `true`.
 *   3. Callee `_electron-build.yml`: input `use_dependency_cache` is boolean,
 *      default false; every non-empty cache is gated on it (expression, or the
 *      complementary `if:` pair). A gated step is exempt from rule 1.
 *   4. In `publish.yml` a job outside SHIPS_IN_RELEASE (and any reusable workflow
 *      it calls) must not upload an artifact named `electron-*` — the prefix that
 *      `github-release`'s `electron-*` files glob attaches.
 *
 * RELEASE-PRIVILEGED (per call site; a reusable callee's job is privileged for
 * a call when the calling job is):
 *   (a) effective permissions (job-level, else top-level) grant `write` on any
 *       scope (incl. `write-all`, `id-token: write`);
 *   (b) it can see a non-GITHUB_TOKEN secret: references `secrets.<NAME>`, is a
 *       `uses:` job carrying `secrets:`, or declares `environment:`;
 *   (c) it is named in SHIPS_IN_RELEASE — UPDATE THAT LIST when a new job's
 *       output is attached to a release.
 *
 * LIMITS (stated, not hidden): CACHE_KEYS is a deny-list — add a new
 * cache-capable action's key when adopted. Local composite actions are out of
 * scope (`.github/actions/` does not exist). pnpm cache content is not
 * integrity-verified against the lockfile (design.md D1), so "no cache" is the
 * control, not "verify the cache".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

// ── configuration ───────────────────────────────────────────────────────────

/** Workflows that had no top-level block; pinned to exactly `{contents: read}`. */
const TOP_READ_FILES = [
  "publish.yml",
  "_electron-build.yml",
  "_smoke.yml",
  "ci-electron.yml",
  "ci-smoke.yml",
  "ci-e2e-electron.yml",
  "ci-gateway-platform.yml",
];
/** Jobs whose output is attached to a GitHub Release (predicate (c)). */
const SHIPS_IN_RELEASE: Record<string, string[]> = { "publish.yml": ["runtime-asset", "electron"] };
/** Callers of `_electron-build.yml` that must keep the dev cache path exercised. */
const DEV_CACHE_CALLERS: Record<string, string[]> = { "ci-electron.yml": ["build"], "nightly.yml": ["electron"] };
const CACHE_KEYS = ["cache", "enable-cache", "bundler-cache", "cache-from", "cache-to"];
const ELECTRON_BUILD = "_electron-build.yml";
const INPUT = "use_dependency_cache";

// ── types + helpers ─────────────────────────────────────────────────────────

type Step = { name?: string; uses?: string; if?: string; with?: Record<string, unknown>; [k: string]: unknown };
type Job = { uses?: string; with?: Record<string, unknown>; secrets?: unknown; environment?: unknown; permissions?: unknown; steps?: Step[]; [k: string]: unknown };
type Wf = { on?: any; permissions?: unknown; jobs?: Record<string, Job> };
interface Violation {
  rule: number;
  file: string;
  job?: string;
  step?: string;
  message: string;
}

const jobsOf = (wf: Wf): [string, Job][] => Object.entries(wf.jobs ?? {});
const nonEmpty = (v: unknown): boolean => !(v === undefined || v === null || v === false || (typeof v === "string" && v.trim() === ""));
const grantsOf = (p: unknown): string[] => {
  if (typeof p === "string") return p === "write-all" ? ["write-all"] : [];
  if (p && typeof p === "object") return Object.entries(p as Record<string, unknown>).filter(([, v]) => v === "write").map(([k]) => `${k}: write`);
  return [];
};
const stepLabel = (s: Step, i: number) => `steps[${i}]${[s.name, s.uses].filter(Boolean).length ? ` (${[s.name, s.uses].filter(Boolean).join(" · ")})` : ""}`;
const squash = (s: string) => s.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/\s+/g, " ").trim();
const callee = (j: Job): string | undefined => (typeof j.uses === "string" && j.uses.startsWith("./.github/workflows/") ? path.basename(j.uses) : undefined);
const secretRefs = (j: Job): string[] =>
  [...JSON.stringify(j).matchAll(/secrets\.([A-Za-z_][\w]*)/g)].map((m) => m[1]).filter((n) => n !== "GITHUB_TOKEN");

interface Ctx { file: string; jobName: string; job: Job; wf: Wf }

/** Release-privileged reasons for `job`, optionally evaluated at a call site. */
function privilege(file: string, jobName: string, job: Job, wf: Wf, caller?: Ctx): string[] {
  const why: string[] = [];
  const eff = job.permissions ?? wf.permissions;
  const where = job.permissions !== undefined ? "job-level" : "inherited top-level";
  for (const g of grantsOf(eff)) why.push(`(a) ${where} permissions grant \`${g}\``);
  if (caller) {
    const ceff = caller.job.permissions ?? caller.wf.permissions;
    const cwhere = caller.job.permissions !== undefined ? "job-level" : "inherited top-level";
    for (const g of grantsOf(ceff)) why.push(`(a) calling job ${caller.file}:${caller.jobName} ${cwhere} permissions grant \`${g}\``);
    if (caller.job.secrets !== undefined) why.push(`(b) calling job ${caller.file}:${caller.jobName} passes secrets`);
    if (SHIPS_IN_RELEASE[caller.file]?.includes(caller.jobName)) why.push(`(c) calling job ${caller.file}:${caller.jobName} ships in the release`);
  }
  for (const n of secretRefs(job)) why.push(`(b) references secrets.${n}`);
  if (job.secrets !== undefined) why.push("(b) passes `secrets:` to a reusable workflow");
  if (job.environment !== undefined) why.push("(b) declares `environment:` (can inject secrets)");
  if (SHIPS_IN_RELEASE[file]?.includes(jobName)) why.push("(c) listed in SHIPS_IN_RELEASE");
  return why;
}

function isGatedCache(job: Job, step: Step): boolean {
  const w = step.with ?? {};
  const v = w.cache;
  if (typeof v === "string" && /^inputs\.use_dependency_cache && 'pnpm' \|\| ''$/.test(squash(v))) return true;
  // D4 fallback: input-gated step + a complementary `!input` step without cache.
  if (typeof step.if === "string" && squash(step.if) === `inputs.${INPUT}`) {
    return (job.steps ?? []).some((o) => o !== step && typeof o.if === "string" && squash(o.if) === `!inputs.${INPUT}` && !nonEmpty(o.with?.cache));
  }
  return false;
}

/** Pure checker over `{ basename → parsed workflow }`. */
function checkWorkflows(files: Map<string, unknown>): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (v: Violation) => {
    const k = JSON.stringify(v);
    if (!seen.has(k)) { seen.add(k); out.push(v); }
  };
  const wfs = new Map([...files].map(([k, v]) => [k, (v ?? {}) as Wf]));

  // call-site index: callee basename → callers
  const sites = new Map<string, Ctx[]>();
  for (const [file, wf] of wfs)
    for (const [jobName, job] of jobsOf(wf)) {
      const c = callee(job);
      if (c) sites.set(c, [...(sites.get(c) ?? []), { file, jobName, job, wf }]);
    }

  for (const [file, wf] of wfs) {
    // rule 0
    const top = wf.permissions;
    if (TOP_READ_FILES.includes(file) && JSON.stringify(top) !== JSON.stringify({ "contents": "read" }))
      add({ rule: 0, file, message: `${file}: top-level permissions must equal exactly {contents: read}` });
    if (top === undefined)
      for (const [jobName, job] of jobsOf(wf))
        if (job.permissions === undefined) add({ rule: 0, file, job: jobName, message: `${file} job ${jobName}: no top-level and no job-level permissions (repository-default token)` });

    // rule 1
    for (const [jobName, job] of jobsOf(wf)) {
      if (!Array.isArray(job.steps)) continue;
      const ctxs: (Ctx | undefined)[] = [undefined, ...(sites.get(file) ?? [])];
      for (const ctx of ctxs) {
        const why = privilege(file, jobName, job, wf, ctx);
        if (!why.length) continue;
        job.steps.forEach((step, i) => {
          const label = stepLabel(step, i);
          if (file === ELECTRON_BUILD && isGatedCache(job, step)) return;
          const bad: string[] = [];
          if (typeof step.uses === "string" && /^actions\/cache(\/|@)/.test(step.uses)) bad.push(`uses ${step.uses}`);
          for (const k of CACHE_KEYS) if (nonEmpty(step.with?.[k])) bad.push(`with.${k}=${JSON.stringify(step.with?.[k])}`);
          if (bad.length)
            add({ rule: 1, file, job: jobName, step: label, message: `${file} job ${jobName} ${label}: release-privileged job restores a cache (${bad.join(", ")}); privileged because ${why.join("; ")}` });
        });
      }
    }

    // rule 2 (caller side)
    for (const [jobName, job] of jobsOf(wf)) {
      if (callee(job) !== ELECTRON_BUILD) continue;
      const val = job.with?.[INPUT];
      const why = privilege(file, jobName, job, wf);
      if (why.length && val !== false)
        add({ rule: 2, file, job: jobName, message: `${file} job ${jobName}: release-privileged caller (${why.join("; ")}) must pass boolean ${INPUT}: false (got ${JSON.stringify(val)})` });
      if (DEV_CACHE_CALLERS[file]?.includes(jobName) && val !== true)
        add({ rule: 2, file, job: jobName, message: `${file} job ${jobName}: dev caller must pass boolean ${INPUT}: true (got ${JSON.stringify(val)})` });
    }

    // rule 3 (callee side)
    if (file === ELECTRON_BUILD) {
      const inp = wf.on?.workflow_call?.inputs?.[INPUT];
      if (!inp || inp.type !== "boolean" || inp.default !== false)
        add({ rule: 3, file, message: `${file}: input ${INPUT} must exist with type boolean and default false (got ${JSON.stringify(inp)})` });
      for (const [jobName, job] of jobsOf(wf))
        (job.steps ?? []).forEach((step, i) => {
          const label = stepLabel(step, i);
          const bad: string[] = [];
          if (typeof step.uses === "string" && /^actions\/cache(\/|@)/.test(step.uses)) bad.push(`uses ${step.uses}`);
          for (const k of CACHE_KEYS) if (nonEmpty(step.with?.[k]) && !(k === "cache" && isGatedCache(job, step))) bad.push(`with.${k}=${JSON.stringify(step.with?.[k])}`);
          if (bad.length) add({ rule: 3, file, job: jobName, step: label, message: `${file} job ${jobName} ${label}: cache not gated on inputs.${INPUT} (${bad.join(", ")})` });
        });
    }

    // rule 4
    if (file === "publish.yml") {
      const shippers = SHIPS_IN_RELEASE[file] ?? [];
      const uploads = (steps: Step[] | undefined) =>
        (steps ?? []).filter((s) => typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact") && String(s.with?.name ?? "").startsWith("electron-"));
      for (const [jobName, job] of jobsOf(wf)) {
        if (shippers.includes(jobName)) continue;
        const direct = uploads(job.steps);
        const viaCallee = callee(job) ? jobsOf(wfs.get(callee(job)!) ?? {}).flatMap(([, j]) => uploads(j.steps)) : [];
        if (direct.length || viaCallee.length)
          add({ rule: 4, file, job: jobName, message: `${file} job ${jobName} uploads an \`electron-*\` artifact (attached by github-release's glob) but is not in SHIPS_IN_RELEASE (${shippers.join(", ")}) in workflow-token-cache-contract.test.ts` });
      }
    }
  }
  return out;
}

/** Parse `{ path → text }`; a malformed file is an error naming it, never a skip. */
function parseWorkflowTexts(texts: Map<string, string>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [file, text] of texts) {
    try {
      out.set(file, parseYaml(text));
    } catch (e) {
      throw new Error(`workflow ${file} is not valid YAML: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Load every `*.yml` / `*.yaml` in `dir`. */
function loadWorkflowDir(dir: string): Map<string, unknown> {
  const texts = new Map<string, string>();
  for (const f of fs.readdirSync(dir).sort()) if (/\.ya?ml$/.test(f)) texts.set(f, fs.readFileSync(path.join(dir, f), "utf8"));
  return parseWorkflowTexts(texts);
}

// ── tests ───────────────────────────────────────────────────────────────────

const real = () => loadWorkflowDir(WORKFLOWS_DIR);
/** Real tree + a mutation, never touching the on-disk files. */
const mutated = (fn: (f: Record<string, any>) => void): Map<string, unknown> => {
  const m = real();
  const plain: Record<string, any> = Object.fromEntries([...m].map(([k, v]) => [k, structuredClone(v)]));
  fn(plain);
  return new Map(Object.entries(plain));
};
const hit = (vs: Violation[], want: Partial<Violation>) =>
  vs.filter((v) => Object.entries(want).every(([k, val]) => (v as any)[k] === val));
const setupNode = (job: any) => job.steps.find((s: any) => String(s.uses).startsWith("actions/setup-node"));
const single = (file: string, wf: Wf) => new Map<string, unknown>([[file, wf]]);
const cachedJob = (extra: Partial<Job> = {}): Job => ({ "runs-on": "ubuntu-latest", steps: [{ uses: "actions/setup-node@v4", with: { cache: "pnpm" } }], ...extra });

describe("workflow token + cache contract", () => {
  it("E1: real post-change tree has zero violations", () => {
    expect(checkWorkflows(real()).map((v) => v.message)).toEqual([]);
  });

  it("E2: ci-gateway-platform.yml without top-level permissions fails rule 0 per job", () => {
    const vs = checkWorkflows(mutated((f) => delete f["ci-gateway-platform.yml"].permissions));
    expect(hit(vs, { rule: 0, file: "ci-gateway-platform.yml", job: "posix" })).toHaveLength(1);
    expect(hit(vs, { rule: 0, file: "ci-gateway-platform.yml", job: "windows" })).toHaveLength(1);
  });

  it("E3: job-level-only permissions form is valid", () => {
    const wf: Wf = { on: "push", jobs: { a: { permissions: { contents: "read" }, steps: [] }, b: { permissions: {}, steps: [] } } };
    expect(hit(checkWorkflows(single("generic.yml", wf)), { rule: 0 })).toEqual([]);
  });

  it("E4: listed workflows need exactly {contents: read}", () => {
    const bad = checkWorkflows(mutated((f) => (f["publish.yml"].permissions = { contents: "read", actions: "read" })));
    expect(hit(bad, { rule: 0, file: "publish.yml" }).length).toBeGreaterThan(0);
    const ok = checkWorkflows(mutated((f) => (f["publish.yml"].permissions = { contents: "read" })));
    expect(hit(ok, { rule: 0, file: "publish.yml" })).toEqual([]);
  });

  it("E5: privileged predicate (a) — effective permissions", () => {
    const run = (top: unknown, jobPerm?: unknown) => {
      const job = cachedJob(jobPerm === undefined ? {} : { permissions: jobPerm });
      const wf: Wf = { on: "push", ...(top === undefined ? {} : { permissions: top }), jobs: { j: job } };
      if (top === undefined && jobPerm === undefined) return [];
      return hit(checkWorkflows(single("fx.yml", wf)), { rule: 1, job: "j" });
    };
    expect(run({ contents: "read" }, { issues: "write" })).toHaveLength(1); // i
    expect(run({ contents: "read" }, "write-all")).toHaveLength(1); // ii
    expect(run({ contents: "read" }, "read-all")).toHaveLength(0); // iii
    expect(run({ contents: "write" }, { contents: "read" })).toHaveLength(0); // iv
    const inherited = run({ pages: "write" }); // v (deploy-site shape)
    expect(inherited).toHaveLength(1);
    expect(inherited[0].message).toContain("inherited top-level");
    expect(inherited[0].message).toContain("pages: write");
    expect(run({ contents: "read" }, { "id-token": "write" })).toHaveLength(1); // vi
  });

  it("E6: predicate (b) — secrets / environment / secret-passing caller", () => {
    const r1 = (job: Job) => hit(checkWorkflows(single("fx.yml", { on: "push", permissions: { contents: "read" }, jobs: { j: job } })), { rule: 1, job: "j" });
    expect(r1(cachedJob({ env: { X: "${{ secrets.NPM_X }}" } }))).toHaveLength(1);
    expect(r1(cachedJob({ env: { X: "${{ secrets.GITHUB_TOKEN }}" } }))).toHaveLength(0);
    expect(r1(cachedJob({ environment: "npm-publish" }))).toHaveLength(1);
    const vs = checkWorkflows(mutated((f) => Object.assign(f["ci-electron.yml"].jobs.build, { secrets: "inherit" })));
    expect(hit(vs, { rule: 2, file: "ci-electron.yml", job: "build" })).toHaveLength(1);
  });

  it("E7: re-adding cache: pnpm to a release job fails and names file/job/step", () => {
    for (const job of ["runtime-asset", "publish", "tag-and-push"]) {
      const vs = checkWorkflows(mutated((f) => (setupNode(f["publish.yml"].jobs[job]).with.cache = "pnpm")));
      const v = hit(vs, { rule: 1, file: "publish.yml", job });
      expect(v.length, job).toBeGreaterThan(0);
      expect(v[0].step).toMatch(/setup-node/);
    }
  });

  it("E8: cache-enabling keys and actions/cache variants on a privileged job", () => {
    const variants: [string, any, boolean][] = [
      ["enable-cache", { uses: "x/y@v1", with: { "enable-cache": true } }, true],
      ["bundler-cache", { uses: "x/y@v1", with: { "bundler-cache": true } }, true],
      ["cache-from", { uses: "x/y@v1", with: { "cache-from": "type=gha" } }, true],
      ["cache/save", { uses: "actions/cache/save@v4", with: { path: "p", key: "k" } }, true],
      ["cache", { uses: "actions/cache@v4", with: { path: "p", key: "k" } }, true],
      ["expr", { uses: "actions/setup-node@v4", with: { cache: "${{ inputs.x }}" } }, true],
      ["empty", { uses: "actions/setup-node@v4", with: { cache: "" } }, false],
    ];
    for (const [name, step, violates] of variants) {
      const wf: Wf = { on: "push", permissions: { contents: "read" }, jobs: { j: { permissions: { contents: "write" }, steps: [step] } } };
      expect(hit(checkWorkflows(single("fx.yml", wf)), { rule: 1, job: "j" }).length > 0, name).toBe(violates);
    }
  });

  it("E9: publish.yml electron must pass boolean false", () => {
    const run = (mut: (w: Record<string, unknown>) => void) =>
      hit(checkWorkflows(mutated((f) => mut(f["publish.yml"].jobs.electron.with))), { rule: 2, file: "publish.yml", job: "electron" });
    expect(run((w) => delete w[INPUT])).toHaveLength(1);
    expect(run((w) => (w[INPUT] = "false"))).toHaveLength(1);
    expect(run((w) => (w[INPUT] = true))).toHaveLength(1);
    expect(run((w) => (w[INPUT] = false))).toHaveLength(0);
  });

  it("E10: dev callers must keep passing boolean true", () => {
    const a = checkWorkflows(mutated((f) => delete f["ci-electron.yml"].jobs.build.with[INPUT]));
    expect(hit(a, { rule: 2, file: "ci-electron.yml", job: "build" })).toHaveLength(1);
    const b = checkWorkflows(mutated((f) => (f["nightly.yml"].jobs.electron.with[INPUT] = false)));
    expect(hit(b, { rule: 2, file: "nightly.yml", job: "electron" })).toHaveLength(1);
  });

  it("E11: callee cache must stay input-gated and default closed", () => {
    const run = (mut: (eb: any) => void) => hit(checkWorkflows(mutated((f) => mut(f[ELECTRON_BUILD]))), { rule: 3, file: ELECTRON_BUILD });
    expect(run((eb) => (setupNode(eb.jobs.build).with.cache = "pnpm")).length).toBeGreaterThan(0);
    expect(run((eb) => (eb.on.workflow_call.inputs[INPUT].default = true)).length).toBeGreaterThan(0);
    expect(run((eb) => (eb.on.workflow_call.inputs[INPUT].type = "string")).length).toBeGreaterThan(0);
    expect(run((eb) => (setupNode(eb.jobs.build).with.cache = `\${{  inputs.${INPUT}   && 'pnpm' || '' }}`))).toEqual([]);
    expect(
      run((eb) => {
        const steps = eb.jobs.build.steps;
        const i = steps.indexOf(setupNode(eb.jobs.build));
        const gated = { ...steps[i], if: `\${{ inputs.${INPUT} }}` };
        const cold = { ...steps[i], if: `\${{ !inputs.${INPUT} }}`, with: { "node-version": steps[i].with["node-version"] } };
        steps.splice(i, 1, gated, cold);
      }),
    ).toEqual([]);
  });

  it("E12: a gated callee step stays exempt when the callee gains secrets (per call site)", () => {
    const vs = checkWorkflows(mutated((f) => (f[ELECTRON_BUILD].jobs.build.env = { CSC_LINK: "${{ secrets.CSC_LINK }}" })));
    expect(vs.map((v) => v.message)).toEqual([]);
  });

  it("E13: ships-in-release guard (rule 4)", () => {
    const upload = (name: string) => ({ uses: "actions/upload-artifact@v4", with: { name, path: "x" } });
    const a = checkWorkflows(mutated((f) => f["publish.yml"].jobs["ci-checks"].steps.push(upload("electron-debug"))));
    const av = hit(a, { rule: 4, file: "publish.yml", job: "ci-checks" });
    expect(av).toHaveLength(1);
    expect(av[0].message).toContain("SHIPS_IN_RELEASE");
    const b = checkWorkflows(mutated((f) => f["_smoke.yml"].jobs["standalone-install-smoke-linux"].steps.push(upload("electron-smoke-log"))));
    expect(hit(b, { rule: 4, file: "publish.yml", job: "smoke" })).toHaveLength(1);
    expect(hit(checkWorkflows(real()), { rule: 4 })).toEqual([]); // runtime-asset + electron legit
  });

  it("X1: invalid YAML is an error naming the file, never a silent pass", () => {
    expect(() => parseWorkflowTexts(new Map([["bad.yml", "a: {b"]]))).toThrow(/bad\.yml/);
  });

  it("X2: .yaml files are covered by the directory listing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-"));
    try {
      fs.writeFileSync(path.join(dir, "extra.yaml"), "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n");
      const vs = checkWorkflows(loadWorkflowDir(dir));
      expect(hit(vs, { rule: 0, file: "extra.yaml", job: "a" })).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
