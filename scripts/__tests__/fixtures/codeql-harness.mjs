/**
 * Test harness for scripts/codeql-local.mjs: temp git repos, a fake CODEQL_BIN
 * (fixtures/fake-codeql.mjs) driven by a per-call plan, and SARIF builders.
 *
 * See change: add-local-codeql-ratchet.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const SCRIPT = resolve(import.meta.dirname, "..", "..", "codeql-local.mjs");
export const FAKE_BIN = resolve(import.meta.dirname, "fake-codeql.mjs");
export const FAKE_GH = resolve(import.meta.dirname, "fake-gh.mjs");
export const GH_ALERT_FIXTURE = resolve(import.meta.dirname, "gh-code-scanning-alert.json");
export const REAL_CONFIG = resolve(import.meta.dirname, "..", "..", "..", ".github", "codeql", "codeql-config.yml");

export const PACKS = { "codeql/actions-queries": "0.6.37", "codeql/javascript-queries": "2.4.7" };
export const DEFAULT_CONFIG = 'name: t\npaths-ignore:\n  - "**/__tests__/**"\n  - tests/**\n';

export const git = (cwd, args, { allowFail = false } = {}) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r;
};

export function write(dir, rel, content) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** A committed temp repo (+ its own TMPDIR for the script's state). */
export function makeRepo({ files = { "a.js": "const a = 1;\n" }, config = DEFAULT_CONFIG } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codeql-test-")));
  const dir = join(root, "repo");
  const tmp = join(root, "tmp");
  mkdirSync(dir);
  mkdirSync(tmp);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  write(dir, ".gitignore", "node_modules\n");
  write(dir, ".github/codeql/codeql-config.yml", config);
  for (const [rel, c] of Object.entries(files)) write(dir, rel, c);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return { root, dir, tmp, plan: join(root, "plan.json"), log: join(root, "calls.jsonl") };
}

export const stateDirOf = (repo, dir = repo.dir) => {
  const top = git(dir, ["rev-parse", "--show-toplevel"]).stdout.trim();
  return join(repo.tmp, "pi-codeql", createHash("sha1").update(top).digest("hex"));
};

export const baselineOf = (entries = [], header = {}) => ({
  version: 1,
  codeql: "2.27.2",
  packs: { ...PACKS },
  entries,
  ...header,
});
export const entry = (ruleId, file, lineHash, count = 1, reason = "untriaged") => ({ ruleId, file, lineHash, count, reason });
export const writeBaselineFile = (repo, baseline, dir = repo.dir) => write(dir, "codeql-baseline.json", `${JSON.stringify(baseline, null, 2)}\n`);

/** A code-scanning alert as `gh api` returns it, built from the recorded real response. */
export function ghAlert(number, { rule = "js/path-injection", path = "a.js", line = 1, sha = "0".repeat(40), state = "dismissed", reason = "won't fix", drop = [] } = {}) {
  const alert = JSON.parse(readFileSync(GH_ALERT_FIXTURE, "utf8"));
  alert.number = number;
  alert.state = state;
  alert.dismissed_reason = state === "dismissed" ? reason : null;
  alert.rule.id = rule;
  alert.most_recent_instance.commit_sha = sha;
  alert.most_recent_instance.location = { ...alert.most_recent_instance.location, path, start_line: line, end_line: line };
  for (const dotted of drop) {
    const keys = dotted.split(".");
    const last = keys.pop();
    delete keys.reduce((o, k) => o[k], alert)[last];
  }
  return alert;
}

/** SARIF doc with `results: [{ruleId, file, line, hash?, message?}]` and pack extensions. */
export function sarifOf(results = [], { packVersions = { "codeql/javascript-queries": "2.4.7+abc", "codeql/actions-queries": "0.6.37+def" } } = {}) {
  return {
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: { name: "CodeQL" },
          extensions: Object.entries(packVersions).map(([name, semanticVersion]) => ({ name, semanticVersion })),
        },
        results: results.map((r) => ({
          ruleId: r.ruleId,
          message: { text: r.message ?? `${r.ruleId} finding` },
          locations: [{ physicalLocation: { artifactLocation: { uri: r.file }, region: { startLine: r.line ?? 1 } } }],
          ...(r.hash === null ? {} : { partialFingerprints: { primaryLocationLineHash: r.hash ?? "aaaa:1" } }),
        })),
      },
    ],
  };
}

/**
 * Run the script in `repo` against the fake binary.
 * opts: plan (fake plan, `sarif` keyed by language), env (null deletes), cwd.
 * `calls` holds only this run's fake-binary invocations.
 */
export function run(repo, args = [], { plan = {}, env = {}, cwd = repo.dir, gh = null } = {}) {
  rmSync(repo.log, { force: true });
  writeFileSync(repo.plan, JSON.stringify({ log: repo.log, ...plan }));
  const ghPlan = join(repo.root, "gh-plan.json");
  const ghLog = join(repo.root, "gh-calls.jsonl");
  rmSync(ghLog, { force: true });
  // `gh` (when given) is the fake GitHub CLI plan: { alerts, exit, stderr, sleepMs }.
  if (gh) writeFileSync(ghPlan, JSON.stringify({ log: ghLog, ...gh }));
  const ghEnv = gh ? { PI_CODEQL_GH_BIN: FAKE_GH, FAKE_GH_PLAN: ghPlan } : {};
  const childEnv = { ...process.env, TMPDIR: repo.tmp, CODEQL_BIN: FAKE_BIN, FAKE_CODEQL_PLAN: repo.plan, ...ghEnv, ...env };
  for (const [k, v] of Object.entries(env)) if (v === null) delete childEnv[k];
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv, encoding: "utf8" });
  const ghCalls = existsSync(ghLog) ? readFileSync(ghLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: calls(repo), ghCalls };
}

export function calls(repo) {
  if (!existsSync(repo.log)) return [];
  return readFileSync(repo.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export const creates = (cs) => cs.filter((c) => c.argv[0] === "database" && c.argv[1] === "create");
export const analyzes = (cs) => cs.filter((c) => c.argv[0] === "database" && c.argv[1] === "analyze");

export const gitOut = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });
