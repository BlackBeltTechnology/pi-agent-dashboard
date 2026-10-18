#!/usr/bin/env node
// Site drift decision (change: add-missing-ci-legs, #579; design D6).
//
// Runs inside .github/workflows/site-drift-check.yml. Compares the commit the
// LIVE site was deployed from (https://pi-dashboard.dev/deploy-sha.txt, written
// by deploy-site.yml) with the last commit on develop that touches a path the
// deploy cares about, and dispatches deploy-site.yml when the live site is
// behind. It NEVER deploys itself and never dispatches while a deploy run is
// queued / in progress (the dispatched run would join `pages-deploy`, which has
// cancel-in-progress: true, and cancel it).
//
// Exit codes: 0 = no-op / skipped with a notice / corrective dispatch sent,
//             1 = dispatch rejected (the job must go red: a stale site with a
//                 failed correction is the silent rot this check exists to end).
//
// Usage: node scripts/site-drift-decision.mjs [--dir <git repo>] [--ref origin/develop]
//          [--url https://pi-dashboard.dev/deploy-sha.txt] [--workflow deploy-site.yml]
// `curl` and `gh` are resolved from PATH (tests stub them).
import { spawnSync } from "node:child_process";

// The push filter's own path set (deploy-site.yml `on.push.paths`).
export const SITE_PATHSPEC = [
  "site/",
  ":(exclude)site/design-scratch/",
  "packages/shell/",
  ".github/workflows/deploy-site.yml",
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = arg("dir", process.cwd());
const ref = arg("ref", "origin/develop");
const url = arg("url", "https://pi-dashboard.dev/deploy-sha.txt");
const workflow = arg("workflow", "deploy-site.yml");
const dispatchRef = arg("dispatch-ref", "develop");

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", cwd: dir, ...opts });
const git = (...args) => run("git", args);

/** Last commit on `ref` touching a site-relevant path ("" when none). */
function lastSiteCommit() {
  const r = git("log", "-1", "--format=%H", ref, "--", ...SITE_PATHSPEC);
  return r.status === 0 ? r.stdout.trim() : "";
}

/** { sha } | { unavailable: reason } — never throws. */
function fetchMarker() {
  const r = run("curl", [
    "-fsS", "--max-time", "20",
    "-H", "Cache-Control: no-cache",
    `${url}?ts=${Date.now()}`,
  ]);
  if (r.error || r.status !== 0) {
    const why = (r.error?.message ?? r.stderr ?? "").trim().split("\n")[0] || `curl exit ${r.status}`;
    return { unavailable: why };
  }
  const body = r.stdout.trim(); // tolerates trailing \n / CRLF
  if (!/^[0-9a-f]{7,40}$/i.test(body)) return { unavailable: `marker is not a commit SHA (${JSON.stringify(body.slice(0, 60))})` };
  const full = git("rev-parse", "--verify", "--quiet", `${body}^{commit}`);
  if (full.status !== 0) return { unavailable: `deployed SHA ${body} is unknown to this repo` };
  return { sha: full.stdout.trim() };
}

/** true | false | null (null = the query itself failed). */
function deployInFlight() {
  for (const status of ["queued", "in_progress"]) {
    const r = run("gh", ["run", "list", "--workflow", workflow, "--status", status, "--json", "databaseId"]);
    if (r.error || r.status !== 0) {
      console.log(`::notice::site drift: \`gh run list --workflow ${workflow} --status ${status}\` failed; cannot tell whether a deploy is in flight, skipping this interval`);
      return null;
    }
    let runs;
    try {
      runs = JSON.parse(r.stdout || "[]");
    } catch {
      runs = [];
    }
    if (Array.isArray(runs) && runs.length > 0) return true;
  }
  return false;
}

function main() {
  const last = lastSiteCommit();
  if (!last) {
    console.log("site drift: no site-relevant commit on " + ref + "; nothing to deploy");
    return 0;
  }
  const marker = fetchMarker();
  let reason;
  if (marker.sha) {
    if (git("merge-base", "--is-ancestor", last, marker.sha).status === 0) {
      console.log(`site drift: live ${marker.sha} contains ${last}; up to date`);
      return 0;
    }
    reason = `live ${marker.sha} lacks ${last}`;
  } else {
    reason = `marker unavailable (${marker.unavailable}); last site commit ${last}`;
  }

  const inFlight = deployInFlight();
  if (inFlight === null) return 0;
  if (inFlight) {
    console.log(`::notice::site drift: ${reason}; a ${workflow} run is already queued/in progress, skipping (next interval re-checks)`);
    return 0;
  }

  console.log(`::warning::site drift: ${reason}; dispatching ${workflow}`);
  const d = run("gh", ["workflow", "run", workflow, "--ref", dispatchRef]);
  if (d.error || d.status !== 0) {
    console.log(`::error::site drift: dispatching ${workflow} --ref ${dispatchRef} was rejected (${(d.stderr || d.error?.message || `exit ${d.status}`).trim().split("\n")[0]})`);
    return 1;
  }
  return 0;
}

process.exit(main());
