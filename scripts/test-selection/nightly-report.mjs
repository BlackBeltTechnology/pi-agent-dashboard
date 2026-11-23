#!/usr/bin/env node
/**
 * Nightly full-suite report (change: speed-up-ci-affected-tests, D6).
 *
 *   node scripts/test-selection/nightly-report.mjs --reports <dir> --expected unit-1,unit-2,…
 *
 * Reads every downloaded vitest JSON report (`<dir>/vitest-report-<job>/*.json`),
 * lists the failing files per job and every expected job that produced NO
 * report (cancelled or infra — never counted as passing), then on a SCHEDULED
 * run opens/updates the single open `nightly-tests` issue (red) or comments and
 * closes it (green). The issue names the develop range since the last green
 * scheduled run — the bisect range for a regression affected-only selection
 * let through. Also writes the refreshed `timings.json` (not committed
 * automatically) next to the reports.
 *
 * Flags (design.md "Reporter interface"): `--reports`/`--expected` are required in
 * report mode (usage error, exit 1, otherwise). `--defer-first-attempt` makes the
 * run attempt-aware (change: stabilize-blocking-test-lanes, D7): attempt 1 writes
 * `<reports>/attempt-1.json` and, on a red scheduled night before the deadline,
 * defers the issue to the rerun; attempt >= 2 reads it from `--previous <dir>`.
 * `--watchdog` (with `--dry-run`) reads no reports: it reports the latest
 * scheduled run when nothing else did. Unknown flags are ignored.
 * `--jobs-only` (change: schedule-release-rehearsal, D2) is the second consumer's mode,
 * `nightly.yml`: no reports, the verdict comes from NEEDS_JSON, a "### Failed jobs and
 * legs" section from the jobs API. With it, `--label <l>` (issue label), `--name <n>`
 * (the four named strings) and `--no-close-on-rerun` (a re-run attempt may open or
 * comment, never close) apply; all three are ignored in every other mode.
 *
 * Env: NEEDS_JSON (`toJSON(needs)` — a job that failed after writing a clean
 * report still makes the night red), GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_SHA,
 * GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_SERVER_URL, GITHUB_STEP_SUMMARY.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_LABEL = "nightly-tests";
const WORKFLOW_FILE = "nightly-tests.yml";
/** Workflows whose `state: "active"` an attempt-1 deferral depends on (D7). */
const REQUIRED_WORKFLOWS = ["nightly-tests-rerun.yml", "nightly-tests-watchdog.yml"];
/** 04:05 UTC: the latest attempt-1 reporter start that can still defer (D7 "Timing"). */
export const DEFER_DEADLINE_UTC_MINUTE = 245;
const WATCHDOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UNAVAILABLE_RED = "first-attempt record unavailable — passed-on-rerun not computed";

const relTo = (root, name) => path.relative(root, name).split(path.sep).join("/");

/**
 * The anchor: the newest green SCHEDULED develop run (not this one) whose SHA
 * is an ancestor of head. Dispatch runs never anchor.
 * @returns {{kind:"range",a:string,b:string}|{kind:"same",b:string}|{kind:"none",b:string}}
 */
export function resolveAnchor({ runs, headSha, isAncestor, currentRunId = null }) {
  const candidates = runs
    .filter((r) => r.event === "schedule" && r.head_branch === "develop" && r.conclusion === "success" && r.id !== currentRunId)
    .sort((x, y) => y.id - x.id);
  for (const r of candidates) {
    if (r.head_sha === headSha) return { kind: "same", b: headSha };
    if (isAncestor(r.head_sha)) return { kind: "range", a: r.head_sha, b: headSha };
  }
  return { kind: "none", b: headSha };
}

export function rangeText(anchor) {
  if (anchor.kind === "range") return `Bisect range: \`${anchor.a}..${anchor.b}\` (since the last green scheduled run).`;
  if (anchor.kind === "same") return "Range: no new commits since the last green scheduled run — likely a flake or an environment change.";
  return "Range: no green anchor — no earlier green scheduled run on develop is an ancestor of this commit.";
}

/**
 * @param {{ expected: string[], reports: Record<string, object|null>, root: string, needs?: Record<string, {result: string}> }} opts
 */
export function summarizeReports({ expected, reports, root, needs = {} }) {
  const failing = [];
  const failingTests = [];
  const noReport = [];
  // A job can fail AFTER writing an all-passing report (e.g. verify-executed),
  // so the job results count too (review B2).
  const failedJobs = Object.entries(needs)
    .filter(([, v]) => v?.result !== "success")
    .map(([job, v]) => `${job}: ${v?.result ?? "unknown"}`);
  for (const job of expected) {
    const rep = reports[job];
    if (!rep) {
      noReport.push(job);
      continue;
    }
    for (const r of rep.testResults ?? []) {
      const file = relTo(root, r.name);
      if (r.status === "failed") failing.push({ job, file });
      const failed = (r.assertionResults ?? []).filter((a) => a.status === "failed");
      for (const a of failed) failingTests.push({ job, file, test: a.fullName ?? a.title ?? null });
      if (r.status === "failed" && failed.length === 0) failingTests.push({ job, file, test: null });
    }
  }
  return { failing, failingTests, noReport, failedJobs, red: failing.length > 0 || noReport.length > 0 || failedJobs.length > 0 };
}

export function timingsFrom(reports, root) {
  const out = {};
  for (const rep of Object.values(reports)) {
    for (const r of rep?.testResults ?? []) {
      const ms = r.endTime - r.startTime;
      if (Number.isFinite(ms)) out[relTo(root, r.name)] = Math.round(ms) / 1000;
    }
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

const testLine = (t) => `- \`${t.file}\`${t.test ? ` › ${t.test}` : ""} (${t.job})`;
const jobLine = (j) => `- ${j.job} (attempt 1: ${j.attempt1})`;

/** Markdown lines of the "Passed on rerun (flaky)" section; empty when both lists are. */
export function passedOnRerunLines({ passedOnRerun = [], jobsPassedOnRerun = [] } = {}) {
  if (!passedOnRerun.length && !jobsPassedOnRerun.length) return [];
  const lines = ["### Passed on rerun (flaky)"];
  if (passedOnRerun.length) lines.push("Tests that failed on attempt 1 and passed on the rerun:", ...passedOnRerun.map(testLine));
  if (jobsPassedOnRerun.length) lines.push("Jobs that did not succeed on attempt 1 and succeeded on the rerun:", ...jobsPassedOnRerun.map(jobLine));
  return lines;
}

export function buildIssueBody({ summary, range, runUrl, sha }) {
  const headline = summary.red ? `Nightly full suite is red at \`${sha}\`.` : `Nightly full suite is green at \`${sha}\`.`;
  const lines = [`${headline} Run: ${runUrl}`, "", range];
  for (const note of summary.notes ?? []) lines.push("", note);
  lines.push("", "### Failing test files");
  lines.push(...(summary.failing.length ? summary.failing.map((f) => `- \`${f.file}\` (${f.job})`) : ["_none_"]));
  lines.push("", "### Jobs that did not succeed");
  lines.push(...(summary.failedJobs?.length ? summary.failedJobs.map((j) => `- ${j}`) : ["_none_"]));
  lines.push("", "### Jobs with no report");
  lines.push(...(summary.noReport.length ? summary.noReport.map((j) => `- ${j}: no report (cancelled or infra)`) : ["_none_"]));
  const flaky = passedOnRerunLines(summary);
  if (flaky.length) lines.push("", ...flaky);
  return lines.join("\n");
}

/** Create/update the single open issue on red; comment + close on green. */
export async function syncIssue({ api, red, body, sha, passedOnRerun = [], jobsPassedOnRerun = [] }) {
  const open = await api.listOpen();
  const existing = open[0];
  if (red) {
    if (existing) {
      await api.update(existing.number, body);
      await api.comment(existing.number, `Still red at \`${sha}\`.`);
    } else {
      await api.create("Nightly full test suite is failing", body);
    }
  } else if (existing) {
    const flaky = passedOnRerunLines({ passedOnRerun, jobsPassedOnRerun });
    await api.comment(existing.number, [`Nightly full suite is green again at \`${sha}\`. Closing.`, ...(flaky.length ? ["", ...flaky] : [])].join("\n"));
    await api.close(existing.number);
  }
}

export function githubApi({ token, repo, server = "https://api.github.com", fetchImpl = globalThis.fetch }) {
  const raw = async (method, url, body) => {
    const res = await fetchImpl(`${server}${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res;
  };
  const call = async (method, url, body) => {
    const res = await raw(method, url, body);
    return res.status === 204 ? null : res.json();
  };
  return {
    runs: async () => (await call("GET", `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=develop&event=schedule&status=success&per_page=50`)).workflow_runs,
    run: (id) => call("GET", `/repos/${repo}/actions/runs/${id}`),
    runAttempt: (id, attempt) => call("GET", `/repos/${repo}/actions/runs/${id}/attempts/${attempt}`),
    workflow: (file) => call("GET", `/repos/${repo}/actions/workflows/${file}`),
    scheduledRuns: async () => (await call("GET", `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=develop&event=schedule&per_page=10`)).workflow_runs,
    /** Every job of a run, following `Link: rel="next"`. The token only ever goes to `server`: a next link keeps its path and query. */
    jobs: async (runId) => {
      const all = [];
      let url = `/repos/${repo}/actions/runs/${runId}/jobs?per_page=${JOBS_PER_PAGE}`;
      while (url) {
        const res = await raw("GET", url);
        all.push(...((await res.json()).jobs ?? []));
        const next = nextLink(res.headers?.get?.("link"));
        if (next) {
          const u = new URL(next);
          url = `${u.pathname}${u.search}`;
        } else url = null;
      }
      return all;
    },
    issues: {
      listOpen: async (label = ISSUE_LABEL) => (await call("GET", `/repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=10`)).filter((i) => !i.pull_request),
      create: (title, body, label = ISSUE_LABEL) => call("POST", `/repos/${repo}/issues`, { title, body, labels: [label] }),
      update: (n, body) => call("PATCH", `/repos/${repo}/issues/${n}`, { body }),
      comment: (n, body) => call("POST", `/repos/${repo}/issues/${n}/comments`, { body }),
      close: (n) => call("PATCH", `/repos/${repo}/issues/${n}`, { state: "closed" }),
    },
  };
}

/**
 * `<dir>/vitest-report-<job>/*.json` → { job: report|null }. An absent OR
 * unreadable (truncated, malformed) report is null — "no report" — so one bad
 * artifact never stops the issue from being raised for the others.
 */
export function readReports(dir, expected) {
  const out = {};
  for (const job of expected) {
    const d = path.join(dir, `vitest-report-${job}`);
    const file = fs.existsSync(d) ? fs.readdirSync(d).find((f) => f.endsWith(".json")) : null;
    out[job] = null;
    if (!file) continue;
    try {
      out[job] = JSON.parse(fs.readFileSync(path.join(d, file), "utf8"));
    } catch (e) {
      console.log(`::warning::${job}: unreadable vitest report (${String(e?.message ?? e).split("\n")[0]}) — counted as no report`);
    }
  }
  return out;
}

/** Value of `--k v`; undefined when absent, last in argv, or followed by another flag. */
function valueFlag(argv, k) {
  const i = argv.indexOf(k);
  const v = i < 0 ? undefined : argv[i + 1];
  return v === undefined || v.startsWith("--") ? undefined : v;
}
const boolFlag = (argv, k) => argv.includes(k);

const USAGE = "usage: nightly-report.mjs --reports <dir> --expected <k1,k2,…> [--defer-first-attempt [--previous <dir>]] | --watchdog [--dry-run]";

/** True only when every workflow attempt 1 relies on answers `state: "active"`; any error means no. */
async function workflowsActive(api) {
  try {
    for (const file of REQUIRED_WORKFLOWS) if ((await api.workflow(file))?.state !== "active") return false;
    return true;
  } catch {
    return false;
  }
}

/** The reporter ran at or before 04:05 UTC of the UTC date of the run's `created_at`. */
async function withinDeferDeadline({ api, runId, now }) {
  try {
    const created = new Date((await api.run(runId)).created_at);
    const deadline = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate()) + DEFER_DEADLINE_UTC_MINUTE * 60_000;
    return now().getTime() <= deadline;
  } catch {
    return false;
  }
}

function readRecord(previousDir) {
  if (!previousDir) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(previousDir, "attempt-1.json"), "utf8"));
    return rec && typeof rec === "object" && typeof rec.deferred === "boolean" ? rec : null;
  } catch {
    return null;
  }
}

/** Job conclusions the jobs-only report lists (GitHub marks a timed-out job `cancelled`). */
const FAILED_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out"]);
const JOBS_PER_PAGE = 100;

/** The four strings `--name` replaces; today's literals when it is absent. */
function reportNames(name) {
  return name === undefined
    ? { heading: "Nightly tests", headline: "Nightly full suite", title: "Nightly full test suite is failing", green: "Nightly full suite" }
    : { heading: name, headline: name, title: `${name} is failing`, green: name };
}

/** `toJSON(needs)` → the job-results object, or null when unset, empty, invalid or without entries. */
function parseNeeds(raw) {
  try {
    const needs = JSON.parse(raw);
    return needs && typeof needs === "object" && !Array.isArray(needs) && Object.keys(needs).length > 0 ? needs : null;
  } catch {
    return null;
  }
}

/** The `rel="next"` target of a `Link` header, or null. */
export function nextLink(link) {
  return /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? "")?.[1] ?? null;
}

/** "### Failed jobs and legs" section; `needsFallback` adds the failing job results when the jobs request failed. */
function failedJobsSection({ jobs, error, failedNeeds, needsFallback }) {
  if (error) return ["### Failed jobs and legs", `failed-job list unavailable: ${error}`, ...(needsFallback ? failedNeeds.map((j) => `- ${j}`) : [])];
  return ["### Failed jobs and legs", ...(jobs.length ? jobs.map((j) => `- ${j}`) : ["_none_"])];
}

/**
 * Jobs-only mode: verdict from NEEDS_JSON, failed legs from the jobs API, one tracking issue.
 * Only a scheduled run writes the issue; `--no-close-on-rerun` lets attempt >= 2 open or comment, never close.
 */
async function jobsOnly({ argv, api, env }) {
  const names = reportNames(valueFlag(argv, "--name"));
  const label = valueFlag(argv, "--label") ?? ISSUE_LABEL;
  const noCloseOnRerun = boolFlag(argv, "--no-close-on-rerun");
  const attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  const scheduled = env.GITHUB_EVENT_NAME === "schedule";
  const sha = env.GITHUB_SHA;
  const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;

  const needs = parseNeeds(env.NEEDS_JSON);
  const failedNeeds = Object.entries(needs ?? {})
    .filter(([, v]) => v?.result !== "success")
    .map(([job, v]) => `${job}: ${v?.result ?? "unknown"}`);
  const red = needs === null || failedNeeds.length > 0;

  let jobs = [];
  let jobsError = null;
  if (red) {
    try {
      jobs = (await api.jobs(env.GITHUB_RUN_ID)).filter((j) => FAILED_CONCLUSIONS.has(j.conclusion)).map((j) => j.name);
    } catch (e) {
      jobsError = String(e?.message ?? e);
    }
  }
  const failedSection = (needsFallback) => failedJobsSection({ jobs, error: jobsError, failedNeeds, needsFallback });
  const body = [
    `${names.headline} is ${red ? "red" : "green"} at \`${sha}\`. Run: ${runUrl}`,
    ...(needs === null ? ["", "job results unavailable: NEEDS_JSON is unset, empty or not a job-results object, so this run is treated as red."] : []),
    "",
    "### Jobs that did not succeed",
    ...(failedNeeds.length ? failedNeeds.map((j) => `- ${j}`) : ["_none_"]),
    "",
    ...failedSection(false),
  ].join("\n");

  const rerun = noCloseOnRerun && attempt > 1;
  const rerunGreenLine = scheduled && rerun && !red ? `Re-run attempt ${attempt}: a re-run never closes the \`${label}\` issue; the next green scheduled night does.` : null;
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${names.heading}: ${red ? "RED" : "green"}\n\n${body}\n${rerunGreenLine ? `\n${rerunGreenLine}\n` : ""}`);
  }
  console.log(body);

  if (scheduled && !(rerun && !red)) {
    try {
      const open = await api.issues.listOpen(label);
      const existing = open[0];
      if (rerun) {
        // red re-run: visible as a comment, body untouched; no open issue → open it
        if (existing) await api.issues.comment(existing.number, [`Re-run attempt ${attempt} of ${runUrl} is red at \`${sha}\`.`, "", ...failedSection(true)].join("\n"));
        else await api.issues.create(names.title, body, label);
      } else if (red) {
        if (existing) {
          await api.issues.update(existing.number, body);
          await api.issues.comment(existing.number, `Still red at \`${sha}\`.`);
        } else await api.issues.create(names.title, body, label);
      } else if (existing) {
        await api.issues.comment(existing.number, `${names.green} is green again at \`${sha}\`. Closing.`);
        await api.issues.close(existing.number);
      }
    } catch (e) {
      const msg = `Issue call failed: ${String(e?.message ?? e)}. The \`${label}\` issue may not reflect this run; re-run the \`report\` job.`;
      if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `\n${msg}\n`);
      console.log(`::error::${msg}`);
      return 1;
    }
  }
  return red ? 1 : 0;
}
const needsKey = (name) => name.replace(/-\d+$/, "");
const sameTest = (a, b) => a.job === b.job && a.file === b.file && a.test === b.test;

/** design.md D7 "Two passed-on-rerun lists". */
export function passedOnRerunLists({ previous, summary, reports, needs, expected }) {
  const hasReport = (job) => reports[job] != null;
  const nowFailing = summary.failingTests;
  const passedOnRerun = (previous.failingTests ?? []).filter((t) => {
    if (!hasReport(t.job)) return false;
    // A file that failed without a failed assertion (import error) passes only when the whole file no longer fails.
    return t.test === null ? !nowFailing.some((n) => n.job === t.job && n.file === t.file) : !nowFailing.some((n) => sameTest(n, t));
  });
  const attempt1 = new Map();
  for (const entry of previous.failedJobs ?? []) {
    const [job, ...rest] = String(entry).split(": ");
    attempt1.set(job, rest.join(": ") || "failure");
  }
  for (const job of previous.noReport ?? []) if (!attempt1.has(job)) attempt1.set(job, "no report");
  const jobsPassedOnRerun = [];
  for (const [job, result] of attempt1) {
    const key = needsKey(job);
    if ((needs[job] ?? needs[key])?.result !== "success") continue;
    const related = expected.filter((k) => k === job || needsKey(k) === key);
    if (!related.every(hasReport)) continue;
    jobsPassedOnRerun.push({ job, attempt1: result });
  }
  return { passedOnRerun, jobsPassedOnRerun };
}

/**
 * Attempt >= 2 with `--defer-first-attempt`: what attempt 1 left behind.
 * Returns the extra summary fields (lists, notes, a forced red).
 */
async function previousAttempt({ api, runId, previousDir, summary, reports, needs, expected }) {
  const record = readRecord(previousDir);
  if (record) return passedOnRerunLists({ previous: record, summary, reports, needs, expected });
  try {
    const a1 = await api.runAttempt(runId, 1);
    if (a1.event !== "schedule" || a1.conclusion === "success") {
      return { notes: [`first-attempt record unavailable; attempt 1 did not defer (${a1.event}, ${a1.conclusion})`] };
    }
  } catch {
    // fail-closed below
  }
  return { notes: [UNAVAILABLE_RED], forceRed: true };
}

async function watchdog({ api, env, now, dryRun }) {
  const runs = (await api.scheduledRuns())
    .filter((r) => r.event === "schedule" && r.head_branch === "develop")
    .sort((x, y) => y.id - x.id);
  const run = runs[0];
  const quiet = (why) => {
    console.log(`watchdog: nothing to report (${why})`);
    return 0;
  };
  if (!run) return quiet("no scheduled run");
  const started = new Date(run.run_started_at ?? run.created_at).getTime();
  if (now().getTime() - started > WATCHDOG_MAX_AGE_MS) return quiet("latest scheduled run started more than 24 h ago");
  if (run.conclusion === "success") return quiet(`latest scheduled run ${run.id} succeeded`);
  const runUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${run.id}`;
  const open = await api.issues.listOpen();
  const named = new RegExp(`${runUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`);
  if (open.some((i) => named.test(i.body ?? ""))) return quiet(`an open issue already names ${runUrl}`);
  const reason = "rerun not performed or not reported";
  const body = [
    `The nightly full suite did not end green and no report named it: ${reason}.`,
    "",
    `- Run: ${runUrl}`,
    `- Attempt: ${run.run_attempt}`,
    `- Status: ${run.status}`,
    `- Conclusion: ${run.conclusion ?? "none yet"}`,
    `- Commit: \`${run.head_sha}\``,
    `- Reason: ${reason}`,
  ].join("\n");
  console.log(`watchdog: report ${runUrl} (attempt ${run.run_attempt}, status ${run.status}, conclusion ${run.conclusion ?? "none"}): ${reason}${dryRun ? " [dry run: no issue written]" : ""}`);
  if (!dryRun) await syncIssue({ api: api.issues, red: true, body, sha: run.head_sha });
  return 1;
}

/**
 * @param {string[]} argv
 * @param {{ api?: object, fetch?: typeof fetch, now?: () => Date, env?: NodeJS.ProcessEnv }} [deps] GitHub API client (or a `fetch` for the built-in one), clock and environment.
 */
export async function main(argv, { api, fetch: fetchImpl, now = () => new Date(), env = process.env, gitIsAncestor } = {}) {
  api ??= githubApi({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, fetchImpl });
  if (boolFlag(argv, "--jobs-only")) return jobsOnly({ argv, api, env });
  if (boolFlag(argv, "--watchdog")) return watchdog({ api, env, now, dryRun: boolFlag(argv, "--dry-run") });

  const dir = valueFlag(argv, "--reports");
  const expectedArg = valueFlag(argv, "--expected");
  if (dir === undefined || expectedArg === undefined) {
    console.error(USAGE);
    return 1;
  }
  const expected = expectedArg.split(",").filter(Boolean);
  const defer = boolFlag(argv, "--defer-first-attempt");
  const attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  const root = process.cwd();
  const sha = env.GITHUB_SHA;
  const reports = readReports(dir, expected);
  const needs = JSON.parse(env.NEEDS_JSON || "{}");
  let summary = summarizeReports({ expected, reports, root, needs });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "timings.json"), `${JSON.stringify(timingsFrom(reports, root), null, 1)}\n`);

  const scheduled = env.GITHUB_EVENT_NAME === "schedule";
  let deferred = false;
  if (defer && attempt === 1) {
    deferred = summary.red && scheduled && (await workflowsActive(api)) && (await withinDeferDeadline({ api, runId: env.GITHUB_RUN_ID, now }));
    const { failingTests, failedJobs, noReport } = summary;
    fs.writeFileSync(path.join(dir, "attempt-1.json"), `${JSON.stringify({ deferred, failingTests, failedJobs, noReport }, null, 1)}\n`);
  } else if (defer) {
    const extra = await previousAttempt({ api, runId: env.GITHUB_RUN_ID, previousDir: valueFlag(argv, "--previous"), summary, reports, needs, expected });
    const { forceRed, ...fields } = extra;
    summary = { ...summary, ...fields, red: summary.red || Boolean(forceRed) };
  }

  const isAncestor = (a) => {
    if (gitIsAncestor) return gitIsAncestor(a, sha);
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", a, sha], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  const anchor = resolveAnchor({ runs: await api.runs(), headSha: sha, isAncestor, currentRunId: Number(env.GITHUB_RUN_ID) });
  const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const body = buildIssueBody({ summary, range: rangeText(anchor), runUrl, sha });
  if (env.GITHUB_STEP_SUMMARY) {
    const verdict = deferred ? "RED — first attempt deferred to the rerun (no issue yet)" : summary.red ? "RED" : "green";
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Nightly tests: ${verdict}\n\n${body}\n`);
  }
  console.log(body);
  // Only a SCHEDULED run owns the issue: a dispatch may run anywhere, any time. A deferred attempt 1 leaves it to the rerun.
  if (scheduled && !deferred) {
    await syncIssue({ api: api.issues, red: summary.red, body, sha, passedOnRerun: summary.passedOnRerun, jobsPassedOnRerun: summary.jobsPassedOnRerun });
  }
  return summary.red ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
