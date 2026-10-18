// Site drift decision script (change: add-missing-ci-legs, #579; test-plan
// E21/E22/E23/X7/X8/X9). Real git fixture repos; `curl` and `gh` are stub
// executables on PATH that log their argv and fail on demand.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "site-drift-decision.mjs");

let root;
let bin;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "site-drift-"));
  bin = join(root, "bin");
  mkdirSync(bin);
  // curl: STUB_CURL_BODY (printf %b so \r\n works) | STUB_CURL_FAIL=<exit>:<stderr>
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
echo "curl $*" >> "$STUB_LOG"
if [ -n "$STUB_CURL_FAIL" ]; then
  echo "\${STUB_CURL_FAIL#*:}" >&2
  exit "\${STUB_CURL_FAIL%%:*}"
fi
printf '%b' "$STUB_CURL_BODY"
`,
  );
  // gh: run list --status <s> → STUB_RUNS_<S> JSON ([] default); STUB_LIST_FAIL=1 → exit 1;
  //     workflow run → STUB_RUN_FAIL=1 → exit 1 (403)
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
echo "gh $*" >> "$STUB_LOG"
case "$1 $2" in
  "run list")
    [ -n "$STUB_LIST_FAIL" ] && { echo "HTTP 503" >&2; exit 1; }
    case "$*" in
      *queued*) printf '%s' "\${STUB_RUNS_QUEUED:-[]}" ;;
      *in_progress*) printf '%s' "\${STUB_RUNS_IN_PROGRESS:-[]}" ;;
    esac ;;
  "workflow run")
    [ -n "$STUB_RUN_FAIL" ] && { echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; }
    ;;
esac
exit 0
`,
  );
  chmodSync(join(bin, "curl"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** Build a repo; `commits` = [[name, relPath], ...]; returns { dir, sha: {name: sha} }. */
function makeRepo(commits) {
  const dir = join(root, `repo-${n++}`);
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", "develop");
  const sha = {};
  for (const [name, rel] of commits) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), `${name}\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", name);
    sha[name] = git(dir, "rev-parse", "HEAD");
  }
  return { dir, sha };
}

function decide(dir, env = {}) {
  const log = join(root, `log-${n++}.txt`);
  writeFileSync(log, "");
  const r = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--ref", "HEAD"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, ...env },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    calls,
    dispatches: calls.filter((c) => c.startsWith("gh workflow run")),
  };
}

// base history: S1 (site) → S2 (shell; LAST) → D (design-scratch) → R (README)
const BASE = [
  ["init", "README.md"],
  ["S1", "site/index.html"],
  ["S2", "packages/shell/y.ts"],
  ["D", "site/design-scratch/x.md"],
  ["R", "README.md"],
];

describe("E21 — drift decision table", () => {
  it("(a) DEPLOYED == LAST → no-op, no dispatch", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.S2}\n` });
    expect(r.status).toBe(0);
    expect(r.dispatches).toEqual([]);
  });

  it("(b) DEPLOYED descends LAST → no-op", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.R}\n` });
    expect(r.status).toBe(0);
    expect(r.dispatches).toEqual([]);
  });

  it("(c) LAST is not an ancestor of DEPLOYED → exactly one dispatch + ::warning::", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.S1}\n` });
    expect(r.status).toBe(0);
    expect(r.dispatches).toEqual(["gh workflow run deploy-site.yml --ref develop"]);
    expect(r.out).toContain("::warning::");
    expect(r.out).toContain(sha.S2);
  });

  it("(d) marker 404 → stale: dispatch + warning 'marker unavailable'", () => {
    const { dir } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_FAIL: "22:curl: (22) The requested URL returned error: 404" });
    expect(r.dispatches).toHaveLength(1);
    expect(r.out).toMatch(/::warning::.*marker unavailable/);
  });

  it("(e) marker body 'not-a-sha' → stale", () => {
    const { dir } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: "not-a-sha\n" });
    expect(r.dispatches).toHaveLength(1);
    expect(r.out).toContain("::warning::");
  });

  it("(f) DEPLOYED SHA unknown to the repo → stale + warning naming it unknown", () => {
    const { dir } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${"deadbeef".repeat(5)}\n` });
    expect(r.dispatches).toHaveLength(1);
    expect(r.out).toMatch(/::warning::.*unknown/);
  });

  it("(g) stale + queued run → ::notice::, no dispatch, exit 0", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.S1}\n`, STUB_RUNS_QUEUED: '[{"databaseId":7}]' });
    expect(r.status).toBe(0);
    expect(r.dispatches).toEqual([]);
    expect(r.out).toContain("::notice::");
  });

  it("(h) stale + in_progress run → ::notice::, no dispatch, exit 0", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.S1}\n`, STUB_RUNS_IN_PROGRESS: '[{"databaseId":8}]' });
    expect(r.status).toBe(0);
    expect(r.dispatches).toEqual([]);
    expect(r.out).toContain("::notice::");
  });

  it("(i) up to date + in_progress run → no-op, no dispatch", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.R}\n`, STUB_RUNS_IN_PROGRESS: '[{"databaseId":8}]' });
    expect(r.status).toBe(0);
    expect(r.dispatches).toEqual([]);
  });
});

describe("E22 — marker text boundaries", () => {
  it("trailing newline, CRLF and an abbreviated 7-hex SHA all resolve like a clean SHA", () => {
    const { dir, sha } = makeRepo(BASE);
    for (const body of [`${sha.R}`, `${sha.R}\\r\\n`, `${sha.R}\\n\\n`, sha.R.slice(0, 7)]) {
      const r = decide(dir, { STUB_CURL_BODY: body });
      expect(r.status, body).toBe(0);
      expect(r.dispatches, body).toEqual([]);
    }
  });

  it("an empty marker and a 41-hex marker are stale (warning + dispatch)", () => {
    const { dir, sha } = makeRepo(BASE);
    for (const body of ["", `${sha.R}0`]) {
      const r = decide(dir, { STUB_CURL_BODY: body });
      expect(r.dispatches, JSON.stringify(body)).toHaveLength(1);
      expect(r.out).toContain("::warning::");
    }
  });

  it("an abbreviated SHA that resolves to a stale commit is stale; an unresolvable one never crashes", () => {
    const { dir, sha } = makeRepo(BASE);
    expect(decide(dir, { STUB_CURL_BODY: sha.S1.slice(0, 7) }).dispatches).toHaveLength(1);
    const r = decide(dir, { STUB_CURL_BODY: "abcdef0" });
    expect(r.status).toBe(0);
    expect(r.dispatches).toHaveLength(1);
  });
});

describe("E23 — LAST mirrors the push filter's path set", () => {
  it("design-scratch and README commits never become LAST", () => {
    const { dir, sha } = makeRepo([
      ["init", "README.md"],
      ["S1", "site/index.html"],
      ["D", "site/design-scratch/x.md"],
      ["R", "README.md"],
    ]);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.S1}\n` });
    expect(r.dispatches).toEqual([]);
  });

  it("a packages/shell commit becomes LAST", () => {
    const { dir, sha } = makeRepo([["init", "README.md"], ["S1", "site/index.html"], ["SH", "packages/shell/y.ts"]]);
    expect(decide(dir, { STUB_CURL_BODY: `${sha.S1}\n` }).dispatches).toHaveLength(1);
  });

  it("a deploy-site.yml workflow commit becomes LAST", () => {
    const { dir, sha } = makeRepo([["init", "README.md"], ["S1", "site/index.html"], ["W", ".github/workflows/deploy-site.yml"]]);
    expect(decide(dir, { STUB_CURL_BODY: `${sha.S1}\n` }).dispatches).toHaveLength(1);
  });
});

describe("API / fetch faults (decision L3)", () => {
  it("(X7) curl timeout / HTTP 503 / DNS failure → dispatch + 'marker unavailable', never a silent exit 0", () => {
    const { dir } = makeRepo(BASE);
    for (const fail of ["28:curl: (28) Operation timed out", "22:curl: (22) The requested URL returned error: 503", "6:curl: (6) Could not resolve host"]) {
      const r = decide(dir, { STUB_CURL_FAIL: fail });
      expect(r.dispatches, fail).toHaveLength(1);
      expect(r.out, fail).toMatch(/::warning::.*marker unavailable/);
    }
  });

  it("(X8) `gh run list` fails while stale → no dispatch, ::notice:: naming the query, exit 0", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.S1}\n`, STUB_LIST_FAIL: "1" });
    expect(r.status).toBe(0);
    expect(r.dispatches).toEqual([]);
    expect(r.out).toMatch(/::notice::.*gh run list/);
  });

  it("(X9) `gh workflow run` rejected (403) with nothing in flight → non-zero + ::error::", () => {
    const { dir, sha } = makeRepo(BASE);
    const r = decide(dir, { STUB_CURL_BODY: `${sha.S1}\n`, STUB_RUN_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/::error::.*rejected/);
  });
});

describe("script presence", () => {
  it("exists and is executable-by-node", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });
});
