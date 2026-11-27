/**
 * Static contract guards for the in-process agent-teams L2 scripts (`qa/tests/60-agent-teams-inproc-persistence.sh`,
 * `qa/tests/61-agent-teams-inproc-perf.sh`, `qa/tests/agent-teams-inproc-lib.sh`, `qa/tests/lib/agent-teams-inproc-*.cjs`).
 *
 * The scripts need a hermetic dashboard install, real `pi` leads and minutes of wall clock, so they are NOT run here (no
 * VM, no docker). What runs everywhere is everything that does not: shell and Node syntax, runner registration, the
 * SKIP-first contract, the browser-in-shell repo lint, the pure upstream-detection helper, and that every faux scenario /
 * fake-subagents env var / sentinel the (unexecuted) drivers reference really exists — the typo class an unexecuted
 * script otherwise carries to its first VM run.
 *
 * See change: add-agent-teams-in-process (tasks 2.7, 13.5-13.8, 13.1-13.4).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shellBrowserViolations } from "../check-conventions.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const T = (name) => join(REPO_ROOT, "qa/tests", name);
const SCRIPTS = ["60-agent-teams-inproc-persistence.sh", "61-agent-teams-inproc-perf.sh"];
const LIB = "agent-teams-inproc-lib.sh";
const DRIVERS = ["lib/agent-teams-inproc-drive.cjs", "lib/agent-teams-inproc-persistence.cjs", "lib/agent-teams-inproc-perf.cjs"];
const FIXTURE = join(REPO_ROOT, "qa/fixtures/fake-subagents.ext.ts");
const read = (p) => readFileSync(p, "utf8");

/** A PATH holding only the tools the SKIP preambles use, and NO `pi`. */
function pathWithoutPi() {
  const bin = mkdtempSync(join(tmpdir(), "no-pi-"));
  for (const tool of ["grep", "dirname"]) {
    const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    symlinkSync(found, join(bin, tool));
  }
  return bin;
}

describe("in-process agent-teams L2 scripts: static contract", () => {
  it("every script, the lib and the drivers parse (`bash -n`, `node --check`)", () => {
    for (const f of [...SCRIPTS, LIB]) {
      expect(existsSync(T(f)), f).toBe(true);
      const r = spawnSync("bash", ["-n", T(f)], { encoding: "utf8" });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
    for (const f of DRIVERS) {
      expect(existsSync(T(f)), f).toBe(true);
      const r = spawnSync(process.execPath, ["--check", T(f)], { encoding: "utf8" });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });

  it("run-all.sh registers the persistence script; the perf script is an announced OPT-IN, not in TESTS", () => {
    const runAll = read(T("run-all.sh"));
    expect(runAll).toContain('"60-agent-teams-inproc-persistence.sh"');
    expect(runAll).not.toContain('"61-agent-teams-inproc-perf.sh"');
    expect(runAll).toMatch(/#\s*61-agent-teams-inproc-perf\.sh is OPT-IN/);
  });

  it("each script names the scenarios it covers (test-plan ids)", () => {
    for (const id of ["S103", "S104", "S105", "S106"]) expect(read(T(SCRIPTS[0])), id).toContain(`#${id}`);
    for (const id of ["S97", "S98", "S100", "S101"]) expect(read(T(SCRIPTS[1])), id).toContain(`#${id}`);
  });

  it("neither script drives rendered browser UI (repo-lint rule 2)", () => {
    for (const f of SCRIPTS) expect(shellBrowserViolations(`qa/tests/${f}`, read(T(f))), f).toEqual([]);
  });

  it("each script sources dist-only-lib.sh and only calls helpers the libs define", () => {
    const libs = read(T("dist-only-lib.sh")) + read(T(LIB));
    const defined = new Set([...libs.matchAll(/^([a-z_]+)\(\) \{/gm)].map((m) => m[1]));
    for (const name of SCRIPTS) {
      const src = read(T(name));
      expect(src, name).toContain('. "$HERE/dist-only-lib.sh"');
      expect(src, name).toContain('. "$HERE/agent-teams-inproc-lib.sh"');
      const called = new Set([...src.matchAll(/\b(do_[a-z_]+|ati_[a-z_]+)\b/g)].map((m) => m[1]));
      for (const c of called) expect(defined.has(c), `${name} calls undefined ${c}`).toBe(true);
    }
  });

  it("SKIP first (exit 0): perf without the opt-in; both without pi on PATH", () => {
    const perf = spawnSync("bash", [T(SCRIPTS[1])], { encoding: "utf8", env: { ...process.env, PI_QA_INPROC_PERF: "" } });
    expect(perf.status).toBe(0);
    expect(perf.stdout.split("\n")[0]).toMatch(/^SKIP: opt-in/);
    const env = { PATH: pathWithoutPi(), HOME: tmpdir(), PI_QA_INPROC_PERF: "1" };
    const bash = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim(); // absolute: the child PATH has no bash
    for (const name of SCRIPTS) {
      const r = spawnSync(bash, [T(name)], { encoding: "utf8", env });
      expect(r.status, `${name}: ${r.stderr}`).toBe(0);
      expect(r.stdout.split("\n")[0], name).toMatch(/^SKIP: pi not on PATH/);
    }
  });
});

describe("ati_upstream_reason (real-upstream detection of the perf script)", () => {
  const reasonFor = (dir) => {
    const r = spawnSync("bash", ["-c", `. "${T(LIB)}"; ati_upstream_reason`], { encoding: "utf8", env: { ...process.env, QA_SUBAGENTS_PKG_DIR: dir ?? "" } });
    return { rc: r.status, out: r.stdout.trim() };
  };
  const pkg = (pkgJson, source) => {
    const dir = mkdtempSync(join(tmpdir(), "subagents-pkg-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkgJson));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/index.ts"), source);
    return dir;
  };
  const NAME = "@blackbelt-technology/pi-dashboard-subagents";

  it("unset or missing directory: not usable, with a visible reason", () => {
    expect(reasonFor(undefined)).toMatchObject({ rc: 1, out: expect.stringContaining("QA_SUBAGENTS_PKG_DIR not set") });
    expect(reasonFor("/nonexistent/subagents")).toMatchObject({ rc: 1, out: expect.stringContaining("no package.json") });
  });

  it("rejects another package, an older release (the 0.6.0 install) and a release without the capability handler", () => {
    expect(reasonFor(pkg({ name: "other", version: "1.0.0" }, "subagents:capabilities"))).toMatchObject({ rc: 1, out: expect.stringContaining("not @blackbelt-technology/pi-dashboard-subagents") });
    expect(reasonFor(pkg({ name: NAME, version: "0.6.0" }, "subagents:capabilities"))).toMatchObject({ rc: 1, out: expect.stringContaining("0.6.0 < 0.9.0") });
    expect(reasonFor(pkg({ name: NAME, version: "0.9.0" }, "nothing here"))).toMatchObject({ rc: 1, out: expect.stringContaining("handles subagents:capabilities") });
  });

  it("accepts a >= 0.9.0 release that handles subagents:capabilities (0.10.x included)", () => {
    expect(reasonFor(pkg({ name: NAME, version: "0.9.0" }, 'bus.on("subagents:capabilities", h)'))).toEqual({ rc: 0, out: "" });
    expect(reasonFor(pkg({ name: NAME, version: "0.10.2" }, 'bus.on("subagents:capabilities", h)'))).toEqual({ rc: 0, out: "" });
  });
});

describe("the unexecuted drivers only reference things that exist", () => {
  it("every `[[faux:<id>]]` the drivers send is a faux scenario (and the two bench cycles the perf driver builds)", async () => {
    const { SCENARIOS } = await import("../../qa/fixtures/faux-scenarios.ts");
    const ids = new Set(["agent-teams-bench-cycle-session", "agent-teams-bench-cycle-inproc"]);
    for (const f of DRIVERS) for (const m of read(T(f)).matchAll(/\[\[faux:([a-z0-9-]+)\]\]/g)) ids.add(m[1]);
    expect(ids.size).toBeGreaterThan(6);
    for (const id of ids) expect(Object.hasOwn(SCENARIOS, id), `scenario ${id}`).toBe(true);
  });

  it("every FAKE_SUBAGENTS_* variable the drivers set is read by the fixture", () => {
    const fixture = read(FIXTURE);
    const vars = new Set();
    for (const f of DRIVERS) for (const m of read(T(f)).matchAll(/FAKE_SUBAGENTS_[A-Z_]+/g)) vars.add(m[0]);
    expect(vars.size).toBeGreaterThan(3);
    for (const v of vars) expect(fixture, v).toContain(v);
  });

  it("the scenarios' child-script sentinels parse as intended by the fake", async () => {
    const { SCENARIOS } = await import("../../qa/fixtures/faux-scenarios.ts");
    const { parseChildScript } = await import("../../qa/fixtures/fake-subagents.ext.ts");
    const spawnPrompt = (id) => {
      const step = SCENARIOS[id].script.find((s) => typeof s !== "function" && JSON.stringify(s).includes("TeammateSpawn"));
      return JSON.stringify(step);
    };
    expect(parseChildScript(spawnPrompt("agent-teams-bench-cycle-inproc"), 1500).run).toEqual({ kind: "run", ms: 50 });
    expect(parseChildScript(spawnPrompt("agent-teams-inproc-spawn-blocker"), 1500)).toEqual({ run: { kind: "forever" }, blockMs: 400000 });
  });
});
