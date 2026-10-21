#!/usr/bin/env node
/**
 * Local CodeQL ratchet — blocks NEW code-scanning alerts at ship time.
 *
 * Analyses a content-addressed snapshot of the working tree with the repo's
 * pinned query-pack versions, keys every result by (rule, file, line hash) and
 * compares the counts with the committed `codeql-baseline.json`. A key whose
 * current count exceeds its baseline count is a NEW alert (exit 1). The
 * baseline is a debt ceiling: it only grows with a typed reason
 * (`--check-baseline-diff`), and only shrinks through `--prune`.
 *
 * Modes: (default) analyse · `--prune` · `--accept` · `--triage` ·
 * `--mirror-dismissal` (record a GitHub dismissal GitHub confirms) ·
 * `--write-baseline` (seed) · `--check-baseline-diff <ref>` (static, no CodeQL).
 * Exit codes: 0 pass / skipped · 1 new alerts or growth violation · 2 error.
 *
 * `CODEQL_BIN` selects the binary (also the test seam: a fake that writes
 * fixture SARIF). A machine without CodeQL SKIPS loudly (exit 0); every other
 * failure is exit 2.
 *
 * See change: add-local-codeql-ratchet.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";

export const BASELINE_FILE = "codeql-baseline.json";
export const CONFIG_FILE = ".github/codeql/codeql-config.yml";

/** The only place pack versions are written down besides recorded baseline headers. */
export const SEED_PACKS = {
  "codeql/javascript-queries": "2.4.7",
  "codeql/actions-queries": "0.6.37",
};

/** Languages analysed locally; `python` is CI-only (design non-goal). */
export const LANGUAGES = {
  "javascript-typescript": { pack: "codeql/javascript-queries", suite: "codeql-suites/javascript-code-scanning.qls" },
  actions: { pack: "codeql/actions-queries", suite: "codeql-suites/actions-code-scanning.qls" },
};

/** The local wrapper pack that carries the repo's CodeQL data extensions (JavaScript analysis only). */
export const MODEL_PACK = "pi-dashboard/local-models";
const MODEL_DIR = ".github/codeql/extensions";
const MODEL_MANIFEST = `name: ${MODEL_PACK}\nversion: 0.0.0\nlibrary: true\nextensionTargets: { codeql/javascript-all: "*" }\ndataExtensions: ["*.model.yml"]\n`;

const PRESET_RULES = ["js/path-injection", "js/command-line-injection", "js/shell-command-constructed-from-input"];
const BASELINE_COMMENT =
  "Local CodeQL ratchet baseline (debt ceiling). Edit only via `node scripts/codeql-local.mjs --prune|--accept|--triage`; see change add-local-codeql-ratchet.";
const PACK_DOWNLOAD_TIMEOUT_MS = 60_000;
const NO_SOURCE_EXIT = 32;

/** An expected failure: message goes to stderr, process exits with `code`. */
export class CodeqlError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.exitCode = code;
  }
}
/** CodeQL unavailable — exit 0 with a loud line. */
class Skip extends Error {}

/* ───────────────────────────── pure helpers ───────────────────────────── */

/** Stable identity of a result. */
export const keyOf = (ruleId, file, lineHash) => JSON.stringify([ruleId, file, lineHash]);
const entryKey = (e) => keyOf(e.ruleId, e.file, e.lineHash);

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Flatten SARIF (one document or an array) into results with their keys.
 * A result without `primaryLocationLineHash` is keyed `-@<startLine>` (line
 * sensitive, fail-closed) and produces a warning. Pure.
 */
function toResult(r, warnings) {
  const loc = r.locations?.[0]?.physicalLocation;
  const file = safeDecode(loc?.artifactLocation?.uri ?? "");
  const startLine = loc?.region?.startLine ?? 0;
  const ruleId = r.ruleId ?? r.rule?.id ?? "";
  let lineHash = r.partialFingerprints?.primaryLocationLineHash;
  if (!lineHash) {
    lineHash = `-@${startLine}`;
    warnings.push(`CODEQL WARNING: ${ruleId} at ${file}:${startLine} has no primaryLocationLineHash; keyed by line number`);
  }
  return { ruleId, file, lineHash, startLine, message: r.message?.text ?? "", key: keyOf(ruleId, file, lineHash) };
}

export function resultKeys(sarif) {
  const warnings = [];
  const runs = (Array.isArray(sarif) ? sarif : [sarif]).flatMap((doc) => doc?.runs ?? []);
  const results = runs.flatMap((run) => (run.results ?? []).map((r) => toResult(r, warnings)));
  return { results, warnings };
}

/** `{ key: count }` for a result list. */
export function countResults(results) {
  const counts = {};
  for (const r of results) counts[r.key] = (counts[r.key] ?? 0) + 1;
  return counts;
}

const REASON_PREFIX = /^(operator-authz|false-positive|accepted-risk): \S/;
/** `github-dismissed (#12[, #13…], <GitHub reason>): <original reason>` — written only by `--mirror-dismissal`. */
const GITHUB_DISMISS_REASONS = ["false positive", "won't fix", "used in tests"];
const REASON_DISMISSED = /^github-dismissed \(#[1-9][0-9]*(, #[1-9][0-9]*)*, (false positive|won't fix|used in tests)\): \S/;

/** Error text for an invalid reason on `ruleId`, or null when valid. Pure. */
export function reasonError(reason, ruleId) {
  if (typeof reason !== "string" || reason === "") return "reason is empty";
  if (reason === "untriaged") return null;
  const m = REASON_PREFIX.exec(reason);
  if (!m && !REASON_DISMISSED.test(reason)) {
    return `reason "${reason}" is neither "untriaged" nor "operator-authz|false-positive|accepted-risk: <text>" nor "github-dismissed (#<n>[, #<m>…], false positive|won't fix|used in tests): <text>"`;
  }
  if (m?.[1] === "operator-authz" && !PRESET_RULES.includes(ruleId)) {
    return `"operator-authz:" is only valid on ${PRESET_RULES.join(", ")} (not ${ruleId})`;
  }
  return null;
}

const HASH_OK = /^([0-9a-f]+:[0-9]+|-@[0-9]+)$/;

/** Problems with one baseline entry; records its key in `seen` to catch duplicates. */
function entryErrors(e, i, seen) {
  const at = `entry ${i}`;
  if (!e || typeof e !== "object") return [`${at}: not an object`];
  const errors = ["ruleId", "file", "lineHash", "count", "reason"].filter((f) => e[f] === undefined || e[f] === null).map((f) => `${at}: missing ${f}`);
  const label = `${at} (${e.ruleId} ${e.file} ${e.lineHash})`;
  if (typeof e.file === "string" && (e.file === "" || e.file !== e.file.trim())) errors.push(`${label}: file has leading/trailing whitespace or is empty`);
  if (e.count !== undefined && !(Number.isInteger(e.count) && e.count >= 1)) errors.push(`${label}: count must be a positive integer`);
  if (typeof e.lineHash === "string" && !HASH_OK.test(e.lineHash)) errors.push(`${label}: malformed lineHash`);
  const why = e.reason === undefined ? null : reasonError(e.reason, e.ruleId);
  if (why) errors.push(`${label}: ${why}`);
  const k = entryKey(e);
  if (seen.has(k)) errors.push(`${label}: duplicate key`);
  seen.add(k);
  return errors;
}

/** Validate a parsed baseline. Pure; never throws. */
export function validateBaseline(b) {
  const errors = [];
  if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, errors: ["baseline is not an object"] };
  if (b.version !== 1) errors.push(`version must be 1 (got ${JSON.stringify(b.version)})`);
  if (typeof b.codeql !== "string" || b.codeql === "") errors.push("header `codeql` version is missing");
  for (const pack of Object.keys(SEED_PACKS)) {
    if (typeof b.packs?.[pack] !== "string" || b.packs[pack] === "") errors.push(`header packs.${pack} is missing`);
  }
  if (!Array.isArray(b.entries)) {
    errors.push("`entries` must be an array");
    return { ok: false, errors };
  }
  const seen = new Set();
  b.entries.forEach((e, i) => errors.push(...entryErrors(e, i, seen)));
  return { ok: errors.length === 0, errors };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Deterministic text of a baseline: fixed header order, sorted entries, trailing newline. Pure. */
export function serializeBaseline(b) {
  const entries = [...b.entries]
    .sort((x, y) => cmp(x.file, y.file) || cmp(x.ruleId, y.ruleId) || cmp(x.lineHash, y.lineHash))
    .map((e) => ({ ruleId: e.ruleId, file: e.file, lineHash: e.lineHash, count: e.count, reason: e.reason }));
  const packs = {};
  for (const k of Object.keys(b.packs).sort()) packs[k] = b.packs[k];
  const out = { _comment: b._comment ?? BASELINE_COMMENT, version: 1, codeql: b.codeql, packs, entries };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Compare current results with the baseline. Excess results of a key (current >
 * baseline, absent = 0) are NEW; entries with fewer current results are STALE.
 * Pure.
 */
export function ratchetDecision(baseline, results) {
  const counts = countResults(results);
  const base = new Map(baseline.entries.map((e) => [entryKey(e), e]));
  const newResults = [];
  const byKey = new Map();
  for (const r of results) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  for (const [k, rs] of byKey) {
    const excess = rs.length - (base.get(k)?.count ?? 0);
    if (excess > 0) {
      const sorted = [...rs].sort((a, b) => a.startLine - b.startLine);
      newResults.push(...sorted.slice(sorted.length - excess));
    }
  }
  newResults.sort((a, b) => cmp(a.file, b.file) || a.startLine - b.startLine || cmp(a.ruleId, b.ruleId));
  const staleEntries = [];
  for (const e of baseline.entries) {
    const current = counts[entryKey(e)] ?? 0;
    if (current < e.count) staleEntries.push({ ruleId: e.ruleId, file: e.file, lineHash: e.lineHash, baseline: e.count, current });
  }
  return { status: newResults.length > 0 ? "new" : "pass", newResults, staleEntries, counts };
}

const group = (e) => `${e.ruleId} ${e.file}`;

/**
 * Growth rules between the baseline at a ref and the working tree (both already
 * validated). Returns `{ ok, violations, lines }`. Pure.
 *
 * Untriaged never grows (per rule+file, so changing a key cannot evade it);
 * growth with a real reason is allowed but printed; `noGrowth` forbids any new
 * key or raised count.
 */
export function baselineGrowth(ref, work, { noGrowth = false } = {}) {
  const refMap = new Map(ref.entries.map((e) => [entryKey(e), e]));
  const workMap = new Map(work.entries.map((e) => [entryKey(e), e]));
  const violations = untriagedViolations(ref, work, refMap);
  const lines = [];
  for (const k of [...new Set([...refMap.keys(), ...workMap.keys()])].sort()) {
    const change = describeChange(refMap.get(k), workMap.get(k));
    if (!change) continue;
    lines.push(change.line);
    if (noGrowth && change.newCount > change.oldCount) violations.push(`--no-growth: ${change.id} ${change.isNew ? "is a new key" : `raised ${change.oldCount} → ${change.newCount}`}`);
  }
  return { ok: violations.length === 0, violations, lines };
}

/** One printed line for an entry whose count or reason differs between ref (`r`) and work (`w`), else null. */
function describeChange(r, w) {
  if (r && w && r.count === w.count && r.reason === w.reason) return null;
  const id = `${(w ?? r).ruleId} ${(w ?? r).file} ${(w ?? r).lineHash}`;
  const [oldCount, newCount] = [r?.count ?? 0, w?.count ?? 0];
  const line = `${id}: count ${oldCount} → ${newCount}; reason ${JSON.stringify(r?.reason ?? null)} → ${JSON.stringify(w?.reason ?? null)}`;
  return { id, line, oldCount, newCount, isNew: !r };
}

/** Per rule+file `untriaged` totals, and per-key "may only carry untriaged if the ref did". */
function untriagedViolations(ref, work, refMap) {
  const violations = [];
  const sums = (entries) => {
    const m = new Map();
    for (const e of entries) if (e.reason === "untriaged") m.set(group(e), (m.get(group(e)) ?? 0) + e.count);
    return m;
  };
  const refSum = sums(ref.entries);
  for (const [g, n] of sums(work.entries)) {
    if (n > (refSum.get(g) ?? 0)) violations.push(`untriaged total for ${g} grew ${refSum.get(g) ?? 0} → ${n}`);
  }
  for (const e of work.entries) {
    if (e.reason !== "untriaged") continue;
    const r = refMap.get(entryKey(e));
    if (r?.reason !== "untriaged" || r.count < e.count) {
      violations.push(`entry ${e.ruleId} ${e.file} ${e.lineHash} carries "untriaged" but did not at the ref with an equal or higher count`);
    }
  }
  return violations;
}

/**
 * Lower every entry to its current count, drop entries at 0; never raise, never
 * change a reason. `counts` is `{ key: count }`. Pure.
 */
export function pruneBaseline(baseline, counts) {
  const changes = [];
  const entries = [];
  for (const e of baseline.entries) {
    const current = counts[entryKey(e)] ?? 0;
    if (current >= e.count) {
      entries.push(e);
      continue;
    }
    changes.push({ ruleId: e.ruleId, file: e.file, lineHash: e.lineHash, baseline: e.count, current, reason: e.reason, removed: current === 0 });
    if (current > 0) entries.push({ ...e, count: current });
  }
  return { baseline: { ...baseline, entries }, changes };
}

const GH_REMOTES = [
  /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];
const GH_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * `{ owner, repo }` of a plain github.com remote URL, else null. A security boundary: the result is
 * spliced into a `gh api` path, so only a strict character class is accepted and `.`/`..` never are.
 * Not shared with the extension's lenient display-link parser. Pure.
 */
export function parseGithubRemote(url) {
  for (const re of GH_REMOTES) {
    const m = re.exec(String(url).trim());
    if (!m) continue;
    const [, owner, repo] = m;
    if ([owner, repo].every((p) => GH_NAME.test(p) && p !== "." && p !== "..")) return { owner, repo };
  }
  return null;
}

const normWs = (s) => s.trim().replace(/\s+/g, " ");

/**
 * Accept the excess results of one key into the baseline with a typed reason.
 * Returns `{ ok, baseline }` or `{ ok:false, error }`. Pure.
 */
export function acceptEntry(baseline, counts, { ruleId, file, lineHash, reason }) {
  const key = keyOf(ruleId, file, lineHash);
  const current = counts[key] ?? 0;
  const existing = baseline.entries.find((e) => entryKey(e) === key);
  if (current <= (existing?.count ?? 0)) return { ok: false, error: `${ruleId} ${file} ${lineHash} has no results in excess of its baseline in the last run` };
  if (reason === "untriaged") return { ok: false, error: 'reason "untriaged" cannot be accepted' };
  const why = reasonError(reason, ruleId);
  if (why) return { ok: false, error: why };
  if (existing && normWs(existing.reason) === normWs(reason)) return { ok: false, error: "reason equals the entry's current reason; say why it changed" };
  const entries = baseline.entries.filter((e) => entryKey(e) !== key);
  entries.push({ ruleId, file, lineHash, count: current, reason });
  return { ok: true, baseline: { ...baseline, entries } };
}

/** `**`/`*`/`?` glob → RegExp over `/`-separated repo-relative paths. Pure. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; ) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

/** The first `paths-ignore` glob matching `file` (or one of its parent directories), else null. Pure. */
export function matchingIgnoreGlob(file, globs) {
  const segs = file.split("/");
  for (const g of globs) {
    const re = globToRegExp(g);
    for (let i = 1; i <= segs.length; i++) if (re.test(segs.slice(0, i).join("/"))) return g;
  }
  return null;
}

/** `LGTM_INDEX_FILTERS` value: one `exclude:` line per glob, trailing `/**` dropped, newline-joined. Pure. */
export function indexFilters(globs) {
  return globs.map((g) => `exclude:${g.replace(/\/\*\*$/, "")}`).join("\n");
}

/** `2.4.7+abc123` → `2.4.7`. */
const stripBuild = (v) => String(v).replace(/\+.*$/, "");

/** Pack versions recorded in SARIF `tool.extensions[]`. Pure. */
export function sarifPackVersions(sarifs) {
  const out = {};
  for (const doc of Array.isArray(sarifs) ? sarifs : [sarifs]) {
    for (const run of doc?.runs ?? []) {
      for (const ext of run.tool?.extensions ?? []) {
        if (ext?.name in SEED_PACKS && ext.semanticVersion) out[ext.name] = stripBuild(ext.semanticVersion);
      }
    }
  }
  return out;
}

/* ─────────────────────────── git / snapshot / locks ─────────────────────────── */

function git(args, { cwd, env, allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    if (allowFail) return null;
    throw new CodeqlError(`git ${args.join(" ")} failed: ${String(err.stderr ?? err.message).trim()}`);
  }
}

export function topLevel(cwd) {
  const top = git(["rev-parse", "--show-toplevel"], { cwd, allowFail: true });
  if (!top) throw new CodeqlError(`${cwd} is not inside a git repository`);
  return top.trim();
}

/**
 * Take a content-addressed snapshot through a COPY of the worktree's index:
 * `git add -A`, drop the baseline, `write-tree`. The real index/worktree are
 * untouched. Returns `{ tree, indexFile, dispose }`; `indexFile` can feed
 * `git checkout-index`.
 */
export function takeSnapshot(cwd) {
  const top = topLevel(cwd);
  const real = resolve(top, git(["rev-parse", "--git-path", "index"], { cwd: top }).trim());
  const dir = mkdtempSync(join(tmpdir(), "pi-codeql-idx-"));
  const indexFile = join(dir, "index");
  if (existsSync(real)) copyFileSync(real, indexFile);
  const env = { GIT_INDEX_FILE: indexFile };
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  try {
    // `git add -A` would silently stage conflict markers, so check first.
    if (git(["ls-files", "--unmerged"], { cwd: top, env }).trim() !== "") {
      throw new CodeqlError("the index has unmerged entries; resolve conflicts first");
    }
    git(["add", "-A"], { cwd: top, env });
    git(["rm", "--cached", "-q", "--ignore-unmatch", "--", BASELINE_FILE], { cwd: top, env });
    const tree = git(["write-tree"], { cwd: top, env }).trim();
    return { tree, indexFile, top, dispose };
  } catch (err) {
    dispose();
    throw err;
  }
}

/** The snapshot id (git tree id) of the working tree, excluding the baseline. */
export function snapshotId(cwd) {
  const snap = takeSnapshot(cwd);
  snap.dispose();
  return snap.tree;
}

/** Per-worktree state directory under the OS temp dir. */
export function stateDir(cwd) {
  const top = topLevel(cwd);
  return join(tmpdir(), "pi-codeql", createHash("sha1").update(top).digest("hex"));
}

/** Process start time as printed by `ps`, or null when unavailable. */
export function processStartTime(pid) {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Without a recorded start time (no `ps`), a reused PID cannot be told apart — trust the lock only while it is younger than any real run. */
const UNVERIFIABLE_LOCK_MAX_AGE_MS = 30 * 60 * 1000;

function isLockStale(owner, ownerFile) {
  try {
    process.kill(owner.pid, 0);
  } catch (err) {
    if (err.code === "ESRCH") return true;
  }
  if (owner.start == null) return Date.now() - statSync(ownerFile).mtimeMs > UNVERIFIABLE_LOCK_MAX_AGE_MS;
  const now = processStartTime(owner.pid);
  return now != null && owner.start !== now;
}

let heldLock = null;
function releaseLock() {
  if (heldLock) rmSync(heldLock, { recursive: true, force: true });
  heldLock = null;
}

/** Atomic `mkdir` lock holding PID + start time. A stale lock is taken over. */
export function acquireLock(cwd) {
  const dir = stateDir(cwd);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, start: processStartTime(process.pid) }));
      heldLock = lock;
      process.on("exit", releaseLock);
      for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
      return dir;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let owner = null;
      try {
        owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
      } catch {}
      if (owner && !isLockStale(owner, join(lock, "owner.json"))) {
        throw new CodeqlError(`another codeql-local run is active in this worktree (pid ${owner.pid}); wait for it or retry`);
      }
      rmSync(lock, { recursive: true, force: true });
    }
  }
  throw new CodeqlError("could not acquire the codeql-local lock");
}

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const lastRunPath = (cwd) => join(stateDir(cwd), "last-run.json");
function readLastRun(cwd) {
  try {
    return JSON.parse(readFileSync(lastRunPath(cwd), "utf8"));
  } catch {
    return null;
  }
}

/* ───────────────────────────── baseline / config IO ───────────────────────────── */

function readBaseline(top, { required = true } = {}) {
  const file = join(top, BASELINE_FILE);
  if (!existsSync(file)) {
    if (!required) return null;
    throw new CodeqlError(`${BASELINE_FILE} is missing. Refusing to adopt current results implicitly; seed it with --write-baseline.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new CodeqlError(`${BASELINE_FILE} is not valid JSON: ${err.message}`);
  }
  const v = validateBaseline(parsed);
  if (!v.ok) throw new CodeqlError(`${BASELINE_FILE} is invalid:\n  ${v.errors.join("\n  ")}`);
  return parsed;
}

function parseBaselineText(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new CodeqlError(`${label} is not valid JSON: ${err.message}`);
  }
  const v = validateBaseline(parsed);
  if (!v.ok) throw new CodeqlError(`${label} is invalid:\n  ${v.errors.join("\n  ")}`);
  return parsed;
}

/** Writes the canonical text and returns it (callers re-bind `last-run.json` to it). */
function writeBaseline(top, baseline) {
  const text = serializeBaseline(baseline);
  atomicWrite(join(top, BASELINE_FILE), text);
  return text;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
/** Canonical baseline hash: formatting and entry order do not change it. See change: harden-codeql-ratchet-followups. */
const baselineHash = (baseline) => sha256(serializeBaseline(baseline));

/** Bind the recorded run to the baseline text just written (no-op without a record). */
function rebindLastRun(cwd, last, text) {
  if (last) atomicWrite(lastRunPath(cwd), JSON.stringify({ ...last, baselineHash: sha256(text) }));
}

function readIgnoreGlobs(top) {
  const file = join(top, CONFIG_FILE);
  if (!existsSync(file)) throw new CodeqlError(`${CONFIG_FILE} is missing`);
  const cfg = parseYaml(readFileSync(file, "utf8"));
  const globs = cfg?.["paths-ignore"] ?? [];
  if (!Array.isArray(globs) || globs.some((g) => typeof g !== "string")) throw new CodeqlError(`${CONFIG_FILE}: paths-ignore must be a list of strings`);
  return globs;
}

/* ───────────────────────────── CodeQL invocation ───────────────────────────── */

function findCodeql() {
  const set = process.env.CODEQL_BIN;
  if (set) {
    try {
      accessSync(set, constants.X_OK);
    } catch {
      throw new CodeqlError(`CODEQL_BIN=${set} is not an executable file`);
    }
    return set;
  }
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, `codeql${ext}`);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {}
    }
  }
  return null;
}

const tail = (text, n = 20) => String(text ?? "").trim().split("\n").slice(-n).join("\n");

function runCodeql(bin, args, { env, timeout, label } = {}) {
  const res = spawnSync(bin, args, { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout });
  return { ...res, label: label ?? args.slice(0, 2).join(" ") };
}

function mustRun(bin, args, opts) {
  const res = runCodeql(bin, args, opts);
  if (res.error || res.status !== 0) {
    throw new CodeqlError(`codeql ${res.label} failed (${res.error ? res.error.message : `exit ${res.status}`}):\n${tail(res.stderr) || tail(res.stdout)}`);
  }
  return res;
}

function cliVersion(bin) {
  const res = mustRun(bin, ["version", "--format=json"], { label: "version" });
  try {
    const v = JSON.parse(res.stdout).version;
    if (typeof v === "string" && v) return v;
  } catch {}
  const m = /(\d+\.\d+\.\d+)/.exec(res.stdout);
  if (m) return m[1];
  throw new CodeqlError(`could not read the CodeQL CLI version from: ${tail(res.stdout, 3)}`);
}

/** Offline-safe: cached packs resolve without the network; only then try a bounded download. */
function ensurePacks(bin, packs) {
  for (const { pack, suite } of Object.values(LANGUAGES)) {
    const ref = `${pack}@${packs[pack]}`;
    const resolved = runCodeql(bin, ["resolve", "queries", `${ref}:${suite}`], { timeout: PACK_DOWNLOAD_TIMEOUT_MS, label: "resolve queries" });
    if (!resolved.error && resolved.status === 0) continue;
    const dl = runCodeql(bin, ["pack", "download", ref], { timeout: PACK_DOWNLOAD_TIMEOUT_MS, label: "pack download" });
    if (dl.error || dl.status !== 0) throw new Skip(`query pack ${ref} is neither cached nor downloadable (${dl.error ? dl.error.message : tail(dl.stderr, 2)})`);
  }
}

/* ───────────────────────────── modes ───────────────────────────── */

function makeReporter(json) {
  // Human lines go to stderr under --json so stdout stays one object.
  return { say: (line) => (json ? console.error(line) : console.log(line)) };
}

function describeResult(r) {
  return `${r.ruleId}  ${r.file}:${r.startLine}  ${r.message}`;
}

function printVerdict(say, decision) {
  for (const r of decision.newResults) say(`NEW  ${describeResult(r)}`);
  for (const s of decision.staleEntries) say(`STALE  ${s.ruleId}  ${s.file}  ${s.lineHash}  baseline ${s.baseline} > current ${s.current}  (run --prune)`);
}

function jsonObject(status, extra) {
  return { status, versions: { codeql: null, packs: {}, models: null }, newResults: [], staleEntries: [], warnings: [], ...extra };
}

function resultView(r) {
  return { ruleId: r.ruleId, file: r.file, lineHash: r.lineHash, startLine: r.startLine, message: r.message };
}

/** Materialize the snapshot of `cwd` under `<run>/src`; returns its tree id. */
function materializeSnapshot(cwd, top, run) {
  const snap = takeSnapshot(cwd);
  try {
    git(["checkout-index", "-a", `--prefix=${join(run, "src")}/`], { cwd: top, env: { GIT_INDEX_FILE: snap.indexFile } });
    return snap.tree;
  } finally {
    snap.dispose();
  }
}

const modelPackFlags = (modelPack) => [`--additional-packs=${modelPack.dir}`, `--model-packs=${MODEL_PACK}`];

/** Data rows of one model YAML: the sum of its `extensions[].data` lengths. */
function modelRowCount(name, text) {
  let doc;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new CodeqlError(`model pack ${MODEL_PACK}: ${name} is not valid YAML: ${err.message}`);
  }
  return (doc?.extensions ?? []).reduce((n, ext) => n + (Array.isArray(ext?.data) ? ext.data.length : 0), 0);
}

/**
 * Write `<run>/model-pack/` (manifest + the snapshot's `*.model.yml` bytes — what the analysis sees
 * and, once committed, what CI sees). Outside `<run>/src`, so the snapshot id is untouched.
 * Returns `{ dir, files: [{ name, path, rows }], digest }`, or null when the snapshot has no model file.
 */
function prepareModelPack(run) {
  const from = join(run, "src", MODEL_DIR);
  if (!existsSync(from)) return null;
  const names = readdirSync(from)
    .filter((n) => n.endsWith(".model.yml") && statSync(join(from, n)).isFile())
    .sort(cmp);
  if (names.length === 0) return null;
  const dir = join(run, "model-pack");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "codeql-pack.yml"), MODEL_MANIFEST);
  const hash = createHash("sha256");
  const files = names.map((name) => {
    const bytes = readFileSync(join(from, name));
    writeFileSync(join(dir, name), bytes);
    hash.update(bytes);
    return { name, path: join(dir, name), rows: modelRowCount(name, bytes.toString("utf8")) };
  });
  return { dir, files, digest: hash.digest("hex") };
}

const realPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/**
 * Prove the CLI resolves the wrapper pack and loads every copied file: per file the summed `rowCount`
 * must equal its data rows. A presence check only — matching is proven by the spike. Any failure is
 * exit 2, never a skip (a skip would disarm the whole JavaScript gate). The exit code alone is
 * meaningless (`resolve extensions` exits 0 with no data), so the JSON is the verdict.
 */
function verifyModelPack(bin, modelPack, packs) {
  const { pack, suite } = LANGUAGES["javascript-typescript"];
  const fail = (why) => new CodeqlError(`model pack ${MODEL_PACK} is not usable: ${why}`);
  const res = runCodeql(bin, ["resolve", "extensions", ...modelPackFlags(modelPack), "--", `${pack}@${packs[pack]}:${suite}`], { timeout: PACK_DOWNLOAD_TIMEOUT_MS, label: "resolve extensions" });
  if (res.error || res.status !== 0) throw fail(`codeql resolve extensions failed (${res.error ? res.error.message : `exit ${res.status}`}): ${tail(res.stderr, 3) || tail(res.stdout, 3)}`);
  let entries;
  try {
    entries = Object.values(JSON.parse(res.stdout).data).flat();
    if (!entries.every((e) => typeof e?.file === "string" && Number.isInteger(e.rowCount))) throw new Error("unexpected entry shape");
  } catch (err) {
    throw fail(`unparsable \`resolve extensions\` output (${err.message})`);
  }
  for (const f of modelPack.files) {
    const loaded = entries.filter((e) => realPath(e.file) === realPath(f.path)).reduce((n, e) => n + e.rowCount, 0);
    if (loaded !== f.rows) throw fail(`${f.name}: ${loaded} of ${f.rows} data rows loaded`);
  }
}

/** `database create` + `analyze` for one language; returns its SARIF document, or null when it has no source. */
function analyseLanguage(bin, run, language, { pack, suite }, packs, globs, modelPack) {
  const db = join(run, `db-${language}`);
  const out = join(run, `${language}.sarif`);
  const created = runCodeql(bin, ["database", "create", db, `--language=${language}`, "--build-mode=none", `--source-root=${join(run, "src")}`, "--overwrite", "--threads=0"], {
    env: { LGTM_INDEX_FILTERS: indexFilters(globs) },
    label: `database create ${language}`,
  });
  // Exit 32: the extractor saw no source of this language (e.g. a repo without workflows) — no results, not a failure.
  if (created.status === NO_SOURCE_EXIT) return null;
  if (created.error || created.status !== 0) {
    throw new CodeqlError(`codeql ${created.label} failed (${created.error ? created.error.message : `exit ${created.status}`}):\n${tail(created.stderr) || tail(created.stdout)}`);
  }
  const modelFlags = modelPack && language === "javascript-typescript" ? modelPackFlags(modelPack) : [];
  mustRun(bin, ["database", "analyze", db, `${pack}@${packs[pack]}:${suite}`, "--threat-model=remote", ...modelFlags, "--format=sarif-latest", `--output=${out}`, "--threads=0"], {
    label: `database analyze ${language}`,
  });
  try {
    return JSON.parse(readFileSync(out, "utf8"));
  } catch (err) {
    throw new CodeqlError(`unreadable SARIF for ${language}: ${err.message}`);
  }
}

/** Pack versions that actually ran (SARIF), refusing a drift from the pinned ones. */
function ranPackVersions(sarifs, packs) {
  const seen = sarifPackVersions(sarifs);
  const out = {};
  for (const pack of Object.keys(SEED_PACKS)) {
    if (seen[pack] && seen[pack] !== packs[pack]) throw new CodeqlError(`pack ${pack} ran at ${seen[pack]} but ${packs[pack]} is pinned`);
    out[pack] = seen[pack] ?? packs[pack];
  }
  return out;
}

/**
 * Persist the run for --prune/--accept/--triage/--mirror-dismissal. `headCommit` + `clean` let the mirror
 * compare GitHub's alert commit with HEAD and demand a tree where only the baseline can differ.
 */
function writeRunRecord(dir, top, { tree, results, baseline }) {
  const status = git(["status", "--porcelain", "--untracked-files=all", "--", `:(exclude)${BASELINE_FILE}`], { cwd: top, allowFail: true });
  const record = {
    snapshotId: tree,
    headCommit: git(["rev-parse", "HEAD"], { cwd: top, allowFail: true })?.trim() ?? null,
    clean: status !== null && status.trim() === "",
    counts: countResults(results),
    results,
  };
  if (baseline) record.baselineHash = baselineHash(baseline);
  atomicWrite(join(dir, "last-run.json"), JSON.stringify(record));
}

/** Run CodeQL over a snapshot. Returns `{ results, warnings, versions, snapshotId }`. */
function analyse(cwd, { packs, baseline, seed }) {
  const top = topLevel(cwd);
  const globs = readIgnoreGlobs(top);
  const bin = findCodeql();
  if (!bin) {
    if (seed) throw new CodeqlError("CodeQL is required for --write-baseline (set CODEQL_BIN or put `codeql` on PATH)");
    throw new Skip("`codeql` not found (set CODEQL_BIN or put it on PATH)");
  }
  const dir = acquireLock(cwd);
  const warnings = [];

  const version = cliVersion(bin);
  if (baseline && version !== baseline.codeql) warnings.push(`CODEQL WARNING: version mismatch: CLI ${version} vs baseline ${baseline.codeql}`);
  ensurePacks(bin, packs);

  for (const entry of readdirSync(dir)) if (entry.startsWith("run-")) rmSync(join(dir, entry), { recursive: true, force: true });
  const run = join(dir, `run-${process.pid}`);
  mkdirSync(run, { recursive: true });
  const tree = materializeSnapshot(cwd, top, run);
  const modelPack = prepareModelPack(run);
  if (modelPack) verifyModelPack(bin, modelPack, packs);

  const sarifs = Object.entries(LANGUAGES)
    .map(([language, cfg]) => analyseLanguage(bin, run, language, cfg, packs, globs, modelPack))
    .filter(Boolean);
  const { results, warnings: keyWarnings } = resultKeys(sarifs);
  warnings.push(...keyWarnings);
  for (const r of results) {
    const glob = matchingIgnoreGlob(r.file, globs);
    if (glob) throw new CodeqlError(`exclusion not applied: result in ${r.file} matches paths-ignore glob ${glob}`);
  }

  const versions = { codeql: version, packs: ranPackVersions(sarifs, packs), models: modelPack?.digest ?? null };
  writeRunRecord(dir, top, { tree, results, baseline });
  return { results, warnings, versions, snapshotId: tree };
}

function emit(json, obj) {
  if (json) console.log(JSON.stringify(obj));
}

function modeAnalyse(cwd, opts) {
  const { json, seed } = opts;
  const { say } = makeReporter(json);
  const top = topLevel(cwd);
  let baseline = null;
  let packs = SEED_PACKS;
  if (seed) {
    if (existsSync(join(top, BASELINE_FILE))) throw new CodeqlError(`${BASELINE_FILE} already exists; refusing to overwrite it`);
  } else {
    baseline = readBaseline(top);
    packs = baseline.packs;
  }

  let run;
  try {
    run = analyse(cwd, { packs, baseline, seed });
  } catch (err) {
    if (err instanceof Skip) {
      console.error(`CODEQL SKIPPED: ${err.message}`);
      emit(json, jsonObject("skipped", { message: err.message }));
      return 0;
    }
    throw err;
  }
  for (const w of run.warnings) console.error(w);

  if (seed) {
    const entries = Object.entries(countResults(run.results)).map(([k, count]) => {
      const [ruleId, file, lineHash] = JSON.parse(k);
      return { ruleId, file, lineHash, count, reason: "untriaged" };
    });
    const text = writeBaseline(top, { version: 1, codeql: run.versions.codeql, packs: run.versions.packs, entries });
    rebindLastRun(cwd, readLastRun(cwd), text);
    say(`wrote ${BASELINE_FILE}: ${entries.length} entries, all "untriaged" (CodeQL ${run.versions.codeql})`);
    emit(json, jsonObject("pass", { versions: run.versions, warnings: run.warnings }));
    return 0;
  }

  const decision = ratchetDecision(baseline, run.results);
  printVerdict(say, decision);
  say(decision.status === "pass" ? `codeql ratchet: pass (${run.results.length} results, ${decision.staleEntries.length} stale entries)` : `codeql ratchet: ${decision.newResults.length} NEW result(s)`);
  emit(
    json,
    jsonObject(decision.status, {
      versions: run.versions,
      newResults: decision.newResults.map(resultView),
      staleEntries: decision.staleEntries,
      warnings: run.warnings,
    }),
  );
  return decision.status === "pass" ? 0 : 1;
}

/**
 * Shared by --prune/--accept: the last run, valid only for the current snapshot
 * and for the baseline its verdict was computed from (`baselineHash`; a legacy
 * record without one is accepted with a note).
 */
function requireFreshRun(cwd, baseline) {
  const last = readLastRun(cwd);
  if (!last) throw new CodeqlError("no recorded CodeQL run for this worktree; run the analysis first");
  if (last.snapshotId !== snapshotId(cwd)) throw new CodeqlError("the working tree changed since the recorded CodeQL run; re-run the analysis first");
  if (last.baselineHash === undefined) console.error("CODEQL NOTE: the recorded run has no baseline hash; the baseline binding was not checked");
  else if (last.baselineHash !== baselineHash(baseline)) throw new CodeqlError("baseline changed since the recorded run; re-run the analysis first");
  return last;
}

function verdictAfter(say, baseline, last) {
  const decision = ratchetDecision(baseline, last.results);
  printVerdict(say, { ...decision, staleEntries: [] });
  say(decision.status === "pass" ? "codeql ratchet: pass" : `codeql ratchet: ${decision.newResults.length} NEW result(s) remain`);
  return decision.status === "pass" ? 0 : 1;
}

function modePrune(cwd) {
  const { say } = makeReporter(false);
  const top = topLevel(cwd);
  acquireLock(cwd);
  const baseline = readBaseline(top);
  const last = requireFreshRun(cwd, baseline);
  const { baseline: next, changes } = pruneBaseline(baseline, last.counts);
  rebindLastRun(cwd, last, writeBaseline(top, next));
  say(`pruned ${changes.length} entr${changes.length === 1 ? "y" : "ies"}`);
  for (const c of changes) {
    if (c.reason === "untriaged") continue;
    say(`${c.removed ? "REMOVED" : "LOWERED"}  ${c.ruleId}  ${c.file}  ${c.lineHash}  ${c.baseline} → ${c.current}  reason: ${c.reason}`);
  }
  return verdictAfter(say, next, last);
}

function modeAccept(cwd, [ruleId, file, lineHash], reason) {
  const { say } = makeReporter(false);
  if (!ruleId || !file || !lineHash) throw new CodeqlError("usage: --accept <ruleId> <file> <lineHash> --reason <text>");
  const top = topLevel(cwd);
  acquireLock(cwd);
  const baseline = readBaseline(top);
  const last = requireFreshRun(cwd, baseline);
  const res = acceptEntry(baseline, last.counts, { ruleId, file, lineHash, reason: reason ?? "" });
  if (!res.ok) throw new CodeqlError(`--accept refused: ${res.error}`);
  rebindLastRun(cwd, last, writeBaseline(top, res.baseline));
  say(`accepted ${ruleId} ${file} ${lineHash} (${last.counts[keyOf(ruleId, file, lineHash)]}): ${reason}`);
  return verdictAfter(say, res.baseline, last);
}

function modeTriage(cwd, [ruleId, file, lineHash], reason) {
  const { say } = makeReporter(false);
  if (!ruleId || !file || !lineHash) throw new CodeqlError("usage: --triage <ruleId> <file> <lineHash> --reason <text>");
  const top = topLevel(cwd);
  acquireLock(cwd);
  const baseline = readBaseline(top);
  const entry = baseline.entries.find((e) => entryKey(e) === keyOf(ruleId, file, lineHash));
  if (!entry) throw new CodeqlError(`--triage refused: no baseline entry for ${ruleId} ${file} ${lineHash}`);
  if (entry.reason !== "untriaged") throw new CodeqlError(`--triage refused: entry already has reason "${entry.reason}"`);
  if (reason === undefined || reason === "untriaged") throw new CodeqlError("--triage needs a non-untriaged --reason");
  const why = reasonError(reason, ruleId);
  if (why) throw new CodeqlError(`--triage refused: ${why}`);
  // Re-bind only a record bound to the pre-triage baseline: never launder a hand edit or a legacy record.
  const last = readLastRun(cwd);
  const bound = last?.baselineHash !== undefined && last.baselineHash === baselineHash(baseline);
  const text = writeBaseline(top, { ...baseline, entries: baseline.entries.map((e) => (e === entry ? { ...e, reason } : e)) });
  if (bound) rebindLastRun(cwd, last, text);
  say(`triaged ${ruleId} ${file} ${lineHash}: ${reason}`);
  return 0;
}

const GH_TIMEOUT_DEFAULT_MS = 15_000;
const sameMultiset = (a, b) => {
  const sorted = (xs) => [...xs].sort((x, y) => x - y);
  const right = sorted(b);
  return a.length === b.length && sorted(a).every((v, i) => v === right[i]);
};

/** `--alert 12,13` → `[12, 13]`: positive integers, no duplicates. */
function parseAlertList(value) {
  const parts = String(value ?? "").split(",");
  if (!parts.every((p) => /^[1-9][0-9]*$/.test(p))) throw new CodeqlError(`--alert must be a comma-separated list of positive integers (got ${JSON.stringify(value)})`);
  const nums = parts.map(Number);
  if (new Set(nums).size !== nums.length) throw new CodeqlError("--alert lists a number twice");
  return nums.sort((a, b) => a - b);
}

/** The `gh` binary and call timeout. `PI_CODEQL_GH_BIN` is an explicit path trusted like `CODEQL_BIN`. */
function ghSettings() {
  const raw = process.env.PI_CODEQL_GH_TIMEOUT_MS;
  if (raw !== undefined && !/^[1-9][0-9]*$/.test(raw)) throw new CodeqlError(`PI_CODEQL_GH_TIMEOUT_MS must be a positive integer (got ${JSON.stringify(raw)})`);
  const bin = process.env.PI_CODEQL_GH_BIN;
  if (bin) {
    try {
      accessSync(bin, constants.X_OK);
    } catch {
      throw new CodeqlError(`PI_CODEQL_GH_BIN=${bin} is not an executable file`);
    }
  }
  return { bin: bin || "gh", timeout: raw === undefined ? GH_TIMEOUT_DEFAULT_MS : Number(raw) };
}

/** One alert from GitHub with every field the checks need, or a refusal naming the missing field. */
function fetchAlert(gh, slug, n) {
  let text;
  try {
    text = execFileSync(gh.bin, ["api", `repos/${slug.owner}/${slug.repo}/code-scanning/alerts/${n}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: gh.timeout, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const why = err.code === "ETIMEDOUT" ? `timed out after ${gh.timeout} ms` : tail(err.stderr || err.message, 3);
    throw new CodeqlError(`--mirror-dismissal refused: reading alert #${n} failed: ${why}`);
  }
  let a;
  try {
    a = JSON.parse(text);
  } catch {
    throw new CodeqlError(`--mirror-dismissal refused: alert #${n} is not JSON`);
  }
  const at = (path, type) => {
    const v = path.split(".").reduce((o, k) => o?.[k], a);
    if (type === "int" ? !Number.isInteger(v) : typeof v !== "string" || v === "") throw new CodeqlError(`--mirror-dismissal refused: alert #${n} has no usable \`${path}\``);
    return v;
  };
  return {
    n,
    state: at("state", "str"),
    ruleId: at("rule.id", "str"),
    path: at("most_recent_instance.location.path", "str"),
    line: at("most_recent_instance.location.start_line", "int"),
    commit: at("most_recent_instance.commit_sha", "str"),
    reason: a.state === "dismissed" ? at("dismissed_reason", "str") : null,
  };
}

/** The baseline entry a mirror may rewrite: it exists, is operator-triaged, and has one alert per result. */
function mirrorEntry(baseline, key, alertCount) {
  const entry = baseline.entries.find((e) => entryKey(e) === key);
  if (!entry) throw new CodeqlError(`--mirror-dismissal refused: no baseline entry for ${JSON.parse(key).join(" ")}`);
  if (!REASON_PREFIX.test(entry.reason)) throw new CodeqlError(`--mirror-dismissal refused: entry reason "${entry.reason}" is not an operator-authz|false-positive|accepted-risk reason`);
  if (alertCount !== entry.count) throw new CodeqlError(`--mirror-dismissal refused: ${alertCount} alert(s) given for an entry of ${entry.count} result(s)`);
  return entry;
}

/** The recorded run a mirror may rely on: this snapshot, clean, at a commit, with a baseline hash. */
function mirrorRun(cwd) {
  const last = readLastRun(cwd);
  if (!last) throw new CodeqlError("--mirror-dismissal refused: no recorded CodeQL run; run the analysis first");
  if (last.baselineHash === undefined) throw new CodeqlError("--mirror-dismissal refused: the recorded run has no baseline hash (legacy record); re-run the analysis");
  if (last.snapshotId !== snapshotId(cwd)) throw new CodeqlError("--mirror-dismissal refused: the working tree changed since the recorded run; re-run the analysis");
  if (last.clean !== true || typeof last.headCommit !== "string" || last.headCommit === "") {
    throw new CodeqlError("--mirror-dismissal refused: the recorded run was not on a clean tree at a commit; check out the commit GitHub analysed and re-run the analysis");
  }
  return last;
}

/** Why one GitHub alert does not confirm the entry (rule, file, commit, dismissal), or null. */
function alertProblem(a, { ruleId, file, headCommit }) {
  if (a.state !== "dismissed") return `is ${a.state}, not dismissed`;
  if (a.ruleId !== ruleId) return `is for rule ${a.ruleId}`;
  if (a.path !== file) return `is for file ${a.path}`;
  if (a.commit !== headCommit) return `was analysed at ${a.commit}, not ${headCommit}`;
  if (!GITHUB_DISMISS_REASONS.includes(a.reason)) return `has dismissal reason ${JSON.stringify(a.reason)}`;
  return null;
}

/** Refuse unless every alert confirms the entry, shares one reason, and covers exactly the recorded lines. */
function confirmAlerts(alerts, want, last, recorded) {
  for (const a of alerts) {
    const bad = alertProblem(a, { ruleId: want.ruleId, file: want.file, headCommit: last.headCommit });
    if (bad) throw new CodeqlError(`--mirror-dismissal refused: alert #${a.n} ${bad}`);
  }
  if (new Set(alerts.map((a) => a.reason)).size !== 1) throw new CodeqlError("--mirror-dismissal refused: the alerts carry different dismissal reasons");
  const lines = alerts.map((a) => a.line);
  if (!sameMultiset(lines, recorded)) {
    const sorted = (xs) => [...xs].sort((x, y) => x - y);
    throw new CodeqlError(`--mirror-dismissal refused: alert lines [${sorted(lines)}] differ from the recorded results' lines [${sorted(recorded)}]`);
  }
}

/**
 * `--mirror-dismissal <rule> <file> <lineHash> --alert <n>[,<n>…]`: record that GitHub dismissed the
 * alerts of one baseline entry. Every check must pass or nothing is written (exit 2): the run is
 * recorded, clean and at HEAD; one dismissed alert per recorded result (start lines as a multiset), at
 * HEAD, for the same rule and file, with one shared GitHub reason.
 */
function modeMirror(cwd, [ruleId, file, lineHash], alertValue) {
  const { say } = makeReporter(false);
  if (!ruleId || !file || !lineHash) throw new CodeqlError("usage: --mirror-dismissal <ruleId> <file> <lineHash> --alert <n>[,<n>…]");
  if (alertValue === undefined) throw new CodeqlError("--mirror-dismissal needs --alert <n>[,<n>…]");
  const alertNumbers = parseAlertList(alertValue);
  const gh = ghSettings();
  const top = topLevel(cwd);
  acquireLock(cwd);
  const baseline = readBaseline(top);
  const key = keyOf(ruleId, file, lineHash);
  const entry = mirrorEntry(baseline, key, alertNumbers.length);
  const last = mirrorRun(cwd);
  const recorded = last.results.filter((r) => r.key === key).map((r) => r.startLine);

  const origin = git(["remote", "get-url", "origin"], { cwd: top, allowFail: true })?.trim();
  const slug = origin ? parseGithubRemote(origin) : null;
  if (!slug) throw new CodeqlError(`--mirror-dismissal refused: origin ${JSON.stringify(origin ?? null)} is not a plain github.com repository URL`);

  const alerts = alertNumbers.map((n) => fetchAlert(gh, slug, n));
  confirmAlerts(alerts, { ruleId, file }, last, recorded);

  const reason = `github-dismissed (${alertNumbers.map((n) => `#${n}`).join(", ")}, ${alerts[0].reason}): ${entry.reason}`;
  const why = reasonError(reason, ruleId);
  if (why) throw new CodeqlError(`--mirror-dismissal refused: ${why}`);
  // Re-bind only a record bound to the pre-write baseline: never launder a hand edit.
  const bound = last.baselineHash === baselineHash(baseline);
  const text = writeBaseline(top, { ...baseline, entries: baseline.entries.map((e) => (e === entry ? { ...e, reason } : e)) });
  if (bound) rebindLastRun(cwd, last, text);
  say(`mirrored ${ruleId} ${file} ${lineHash}: ${reason}`);
  return 0;
}

/** The introducing change (the ref has no baseline): the seed must equal the recorded run exactly. */
function seedCheck(cwd, ref, work, say) {
  const last = readLastRun(cwd);
  if (!last || last.snapshotId !== snapshotId(cwd)) {
    say(`SEED: ${ref} has no ${BASELINE_FILE}; verification deferred to the analysis run`);
    return 0;
  }
  const want = last.counts;
  const have = Object.fromEntries(work.entries.map((e) => [entryKey(e), e.count]));
  const bad = [...new Set([...Object.keys(want), ...Object.keys(have)])]
    .filter((k) => (want[k] ?? 0) !== (have[k] ?? 0))
    .map((k) => `${JSON.parse(k).join(" ")}: baseline ${have[k] ?? 0} vs recorded run ${want[k] ?? 0}`);
  for (const b of bad) console.error(`SEED MISMATCH  ${b}`);
  if (bad.length > 0) return 1;
  say(`codeql baseline diff: seed equals the recorded run (${work.entries.length} entries)`);
  return 0;
}

function modeCheckDiff(cwd, ref, noGrowth) {
  const { say } = makeReporter(false);
  const top = topLevel(cwd);
  const work = readBaseline(top);
  if (git(["rev-parse", "--verify", `${ref}^{commit}`], { cwd: top, allowFail: true }) === null) {
    throw new CodeqlError(`cannot resolve ref "${ref}" to a commit`);
  }
  if (git(["cat-file", "-e", `${ref}:${BASELINE_FILE}`], { cwd: top, allowFail: true }) === null) return seedCheck(cwd, ref, work, say);
  const refBaseline = parseBaselineText(git(["show", `${ref}:${BASELINE_FILE}`], { cwd: top }), `${BASELINE_FILE} at ${ref}`);
  const res = baselineGrowth(refBaseline, work, { noGrowth });
  for (const l of res.lines) say(`CHANGED  ${l}`);
  for (const v of res.violations) console.error(`VIOLATION  ${v}`);
  if (!res.ok) return 1;
  say(`codeql baseline diff: ok (${res.lines.length} change${res.lines.length === 1 ? "" : "s"})`);
  return 0;
}

/* ───────────────────────────── CLI ───────────────────────────── */

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      prune: { type: "boolean" },
      accept: { type: "boolean" },
      triage: { type: "boolean" },
      "write-baseline": { type: "boolean" },
      "check-baseline-diff": { type: "string" },
      "no-growth": { type: "boolean" },
      "mirror-dismissal": { type: "boolean" },
      alert: { type: "string" },
      reason: { type: "string" },
    },
  });
  if (values["mirror-dismissal"]) {
    const clash = ["json", "reason", "prune", "accept", "triage", "write-baseline", "check-baseline-diff", "no-growth"].filter((o) => values[o] !== undefined);
    if (clash.length > 0) throw new CodeqlError(`--mirror-dismissal cannot be combined with ${clash.map((o) => `--${o}`).join(", ")}`);
    return modeMirror(cwd, positionals, values.alert);
  }
  if (values.alert !== undefined) throw new CodeqlError("--alert is only valid with --mirror-dismissal");
  const modes = ["prune", "accept", "triage", "write-baseline", "check-baseline-diff"].filter((m) => values[m] !== undefined);
  if (modes.length > 1) throw new CodeqlError(`choose one mode (got ${modes.map((m) => `--${m}`).join(", ")})`);
  if (values.prune) return modePrune(cwd);
  if (values.accept) return modeAccept(cwd, positionals, values.reason);
  if (values.triage) return modeTriage(cwd, positionals, values.reason);
  if (values["check-baseline-diff"] !== undefined) return modeCheckDiff(cwd, values["check-baseline-diff"], values["no-growth"] === true);
  return modeAnalyse(cwd, { json: values.json === true, seed: values["write-baseline"] === true });
}

function isEntrypoint() {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  let code;
  try {
    code = main();
  } catch (err) {
    if (err instanceof CodeqlError) {
      console.error(`CODEQL ERROR: ${err.message}`);
      if (process.argv.includes("--json")) console.log(JSON.stringify(jsonObject("error", { message: err.message })));
      code = err.exitCode;
    } else {
      console.error(`CODEQL ERROR: ${err?.stack ?? err}`);
      if (process.argv.includes("--json")) console.log(JSON.stringify(jsonObject("error", { message: String(err?.message ?? err) })));
      code = 2;
    }
  }
  process.exit(code);
}
