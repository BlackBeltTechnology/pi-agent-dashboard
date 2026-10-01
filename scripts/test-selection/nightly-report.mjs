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
 * Env: NEEDS_JSON (`toJSON(needs)` — a job that failed after writing a clean
 * report still makes the night red), GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_SHA,
 * GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_STEP_SUMMARY.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_LABEL = "nightly-tests";
const WORKFLOW_FILE = "nightly-tests.yml";

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
    for (const r of rep.testResults ?? []) if (r.status === "failed") failing.push({ job, file: relTo(root, r.name) });
  }
  return { failing, noReport, failedJobs, red: failing.length > 0 || noReport.length > 0 || failedJobs.length > 0 };
}

export function timingsFrom(reports, root) {
  const out = {};
  for (const rep of Object.values(reports)) {
    for (const r of rep?.testResults ?? []) out[relTo(root, r.name)] = Math.round(r.endTime - r.startTime) / 1000;
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

export function buildIssueBody({ summary, range, runUrl, sha }) {
  const headline = summary.red ? `Nightly full suite is red at \`${sha}\`.` : `Nightly full suite is green at \`${sha}\`.`;
  const lines = [`${headline} Run: ${runUrl}`, "", range, "", "### Failing test files"];
  lines.push(...(summary.failing.length ? summary.failing.map((f) => `- \`${f.file}\` (${f.job})`) : ["_none_"]));
  lines.push("", "### Jobs that did not succeed");
  lines.push(...(summary.failedJobs?.length ? summary.failedJobs.map((j) => `- ${j}`) : ["_none_"]));
  lines.push("", "### Jobs with no report");
  lines.push(...(summary.noReport.length ? summary.noReport.map((j) => `- ${j}: no report (cancelled or infra)`) : ["_none_"]));
  return lines.join("\n");
}

/** Create/update the single open issue on red; comment + close on green. */
export async function syncIssue({ api, red, body, sha }) {
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
    await api.comment(existing.number, `Nightly full suite is green again at \`${sha}\`. Closing.`);
    await api.close(existing.number);
  }
}

function githubApi({ token, repo, server = "https://api.github.com" }) {
  const call = async (method, url, body) => {
    const res = await fetch(`${server}${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    runs: async () => (await call("GET", `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?branch=develop&event=schedule&status=success&per_page=50`)).workflow_runs,
    issues: {
      listOpen: async () => (await call("GET", `/repos/${repo}/issues?labels=${ISSUE_LABEL}&state=open&per_page=10`)).filter((i) => !i.pull_request),
      create: (title, body) => call("POST", `/repos/${repo}/issues`, { title, body, labels: [ISSUE_LABEL] }),
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

async function main(argv) {
  const arg = (k) => argv[argv.indexOf(k) + 1];
  const dir = arg("--reports");
  const expected = arg("--expected").split(",").filter(Boolean);
  const root = process.cwd();
  const env = process.env;
  const sha = env.GITHUB_SHA;
  const reports = readReports(dir, expected);
  const needs = JSON.parse(env.NEEDS_JSON || "{}");
  const summary = summarizeReports({ expected, reports, root, needs });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "timings.json"), `${JSON.stringify(timingsFrom(reports, root), null, 1)}\n`);

  const api = githubApi({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY });
  const isAncestor = (a) => {
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
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Nightly tests: ${summary.red ? "RED" : "green"}\n\n${body}\n`);
  console.log(body);
  // Only a SCHEDULED run owns the issue: a dispatch may run anywhere, any time.
  if (env.GITHUB_EVENT_NAME === "schedule") await syncIssue({ api: api.issues, red: summary.red, body, sha });
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
