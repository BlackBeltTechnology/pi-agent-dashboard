/**
 * Oversubscription guard for the co-resident test harness (change:
 * stabilize-browser-e2e, task 2.1; issue #451 part 2).
 *
 * Two 4 GiB harnesses on an 8 GB VM saturate the daemon, and a run under that
 * contention cannot be attributed. `test-up.sh` must therefore look at the
 * OTHER running `pi-dash-test-*` compose projects and compare
 * `(n+1) × MEM_LIMIT` against the daemon's `MemTotal`:
 *
 *   - oversubscribed            → REFUSE before `compose up` (nothing is built),
 *                                 naming the project(s) and the arithmetic;
 *   - oversubscribed + override → proceed with one warning
 *                                 (PI_HARNESS_ALLOW_OVERSUBSCRIBE=1);
 *   - fits, but a peer is up    → proceed with one warning (attribution is
 *                                 degraded under contention);
 *   - no peer                   → silent;
 *   - memory unreadable         → warn and proceed (never refuse on missing data).
 *
 * `docker` is stubbed on PATH; no daemon is touched. Pattern:
 * scripts/__tests__/test-up-port-derivation.test.mjs.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEST_UP = path.join(REPO_ROOT, "docker", "test-up.sh");
const LIB = path.join(REPO_ROOT, "docker", "lib-ports.sh");

const PEER = "pi-dash-test-987654321";
const GIB = 1024 ** 3;
const EIGHT_GIB = 8 * GIB;
const SIXTEEN_GIB = 16 * GIB;

/**
 * Stub `docker` on PATH. Understands the three calls test-up.sh makes:
 *   ps    → the co-resident harness projects (FAKE_PROJECTS)
 *   info  → MemTotal in bytes (FAKE_MEMTOTAL), or exit 1 (FAKE_INFO_FAIL=1)
 *   compose … up → success
 * Every invocation is appended to $FAKE_DOCKER_LOG so a test can prove
 * `compose up` was never reached.
 */
function makeDockerStub() {
  const bin = mkdtempSync(path.join(os.tmpdir(), "pi-guard-bin-"));
  const stub = path.join(bin, "docker");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
[ -n "\${FAKE_DOCKER_LOG:-}" ] && printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  ps)
    if [ -n "\${FAKE_PROJECTS:-}" ]; then printf '%s\\n' "$FAKE_PROJECTS"; fi
    exit 0 ;;
  info)
    if [ "\${FAKE_INFO_FAIL:-}" = "1" ]; then exit 1; fi
    printf '%s\\n' "\${FAKE_MEMTOTAL:-8589934592}"
    exit 0 ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(stub, 0o755);
  return bin;
}

/**
 * Run test-up.sh against the stub. Returns the exit status (never throws on a
 * non-zero exit — the refusal IS the behaviour under test).
 */
function runTestUp({ projects, memTotal, infoFail, allowOversubscribe, memLimit } = {}) {
  const ws = mkdtempSync(path.join(os.tmpdir(), "pi-guard-ws-"));
  const bin = makeDockerStub();
  const log = path.join(ws, "docker.log");
  writeFileSync(log, "");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TEST_COPY_MODE: "1",
    FAKE_PROJECTS: projects ?? "",
    FAKE_DOCKER_LOG: log,
    // Never inherit a real daemon's values or a developer's override.
    MEM_LIMIT: memLimit ?? "",
    PI_HARNESS_ALLOW_OVERSUBSCRIBE: "",
  };
  if (memTotal !== undefined) env.FAKE_MEMTOTAL = String(memTotal);
  if (infoFail) env.FAKE_INFO_FAIL = "1";
  if (allowOversubscribe) env.PI_HARNESS_ALLOW_OVERSUBSCRIBE = "1";

  let status = 0;
  let out = "";
  // spawnSync (NOT execFileSync): the guard writes to stderr and exits 0 on the
  // warn-and-proceed paths, so BOTH streams must be captured regardless of exit.
  const res = spawnSync("bash", [TEST_UP, "-d"], { cwd: ws, env, encoding: "utf8" });
  status = res.status ?? 1;
  out = String(res.stdout ?? "") + String(res.stderr ?? "");
  const calls = readFileSync(log, "utf8");
  const stateFile = path.join(ws, ".pi-test-harness.json");
  const wroteState = existsSync(stateFile);
  rmSync(ws, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
  return { status, out, calls, wroteState };
}

describe("lib-ports: list_running_harness_projects", () => {
  function lib(script, extraEnv = {}) {
    return execFileSync("bash", ["-c", `source "${LIB}"; ${script}`], {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    }).trim();
  }

  it("excludes the caller's own project and non-harness projects", () => {
    const bin = makeDockerStub();
    try {
      const out = lib(`list_running_harness_projects pi-dash-test-111`, {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_PROJECTS: `pi-dash-test-111\npi-dash-test-222\nsome-other-app`,
      });
      expect(out.split("\n")).toEqual(["pi-dash-test-222"]);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("is empty (exit 0) when only the caller's own project is up", () => {
    const bin = makeDockerStub();
    try {
      const out = lib(`list_running_harness_projects pi-dash-test-111; echo "rc=$?"`, {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_PROJECTS: `pi-dash-test-111\nsome-other-app`,
      });
      expect(out).toBe("rc=0");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("is empty (exit 0) when the docker call fails", () => {
    const bin = makeDockerStub();
    try {
      const out = lib(`list_running_harness_projects pi-dash-test-111; echo "rc=$?"`, {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_INFO_FAIL: "1",
        FAKE_DOCKER_LOG: "",
      });
      expect(out).toBe("rc=0");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("test-up.sh oversubscription guard (#451 part 2)", () => {
  it("(a) refuses before compose up when (n+1) × MEM_LIMIT exceeds MemTotal", () => {
    const r = runTestUp({ projects: PEER, memTotal: EIGHT_GIB });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(PEER);
    expect(r.out).toMatch(/2 × 4 GiB/);
    expect(r.out).toMatch(/8 GiB/);
    expect(r.out).toMatch(/PI_HARNESS_ALLOW_OVERSUBSCRIBE/);
    // The refusal must cost nothing: no build, no `compose up`.
    expect(r.calls).not.toMatch(/\bup\b/);
    expect(r.wroteState).toBe(false);
  });

  it("(b) proceeds with a warning when the override is set", () => {
    const r = runTestUp({ projects: PEER, memTotal: EIGHT_GIB, allowOversubscribe: true });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/override|PI_HARNESS_ALLOW_OVERSUBSCRIBE/);
    expect(r.calls).toMatch(/\bup\b/);
  });

  it("(c) proceeds with one warning when the limits fit but a peer is up", () => {
    const r = runTestUp({ projects: PEER, memTotal: SIXTEEN_GIB });
    expect(r.status).toBe(0);
    expect(r.out).toContain(PEER);
    expect(r.out).toMatch(/attribution|contention|another/i);
    expect(r.calls).toMatch(/\bup\b/);
  });

  it("(d) says nothing extra when no other harness is up", () => {
    const r = runTestUp({ projects: "", memTotal: EIGHT_GIB });
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/attribution|oversubscri|co-resident|PI_HARNESS_ALLOW_OVERSUBSCRIBE/i);
    expect(r.calls).toMatch(/\bup\b/);
  });

  it("(d) says nothing extra when other projects are non-harness", () => {
    const r = runTestUp({ projects: "some-other-app", memTotal: EIGHT_GIB });
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/oversubscri|co-resident/i);
  });

  it("(e) warns and proceeds when docker info fails", () => {
    const r = runTestUp({ projects: PEER, infoFail: true });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/could not|unavailable|cannot read|MemTotal/i);
    expect(r.calls).toMatch(/\bup\b/);
  });

  it("(e) warns and proceeds when MEM_LIMIT is unparseable", () => {
    const r = runTestUp({ projects: PEER, memTotal: EIGHT_GIB, memLimit: "lots" });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/MEM_LIMIT|unparse|could not/i);
    expect(r.calls).toMatch(/\bup\b/);
  });
});
