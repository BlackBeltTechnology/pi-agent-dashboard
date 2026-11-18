/**
 * Unit tests for scripts/e2e-csp-lane-check.mjs (test-plan #E6).
 *
 * The fixture `fixtures/e2e-csp-lane-report.json` was captured from the
 * installed Playwright's real JSON reporter on a throwaway spec
 * `lane-fixture.spec.mjs`: one test skipped with a PI_DASHBOARD_CSP message,
 * one skipped for an unrelated reason, one passing.
 *
 * See change: enforce-strict-csp-default (D4).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "e2e-csp-lane-check.mjs");
const FIXTURE = path.join(__dirname, "fixtures", "e2e-csp-lane-report.json");
const SPEC = "lane-fixture.spec.mjs";

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "csp-lane-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const load = () => JSON.parse(readFileSync(FIXTURE, "utf8"));
function write(report) {
  const p = path.join(tmp, "r.json");
  writeFileSync(p, JSON.stringify(report));
  return p;
}
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

/** Drop every test whose skip annotation names PI_DASHBOARD_CSP. */
function withoutCspSkip(report) {
  for (const suite of report.suites) {
    suite.specs = suite.specs.filter((s) => !s.tests.some((t) => t.annotations.some((a) => a.type === "skip" && String(a.description).includes("PI_DASHBOARD_CSP"))));
  }
  report.stats.skipped -= 1;
  return report;
}

describe("e2e-csp-lane-check", () => {
  it("fails on a CSP-reason skip outside the allow-list", () => {
    const r = run(FIXTURE);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toContain(SPEC);
  });

  it("passes when the skipping spec is allow-listed", () => {
    expect(run(FIXTURE, "--allow", SPEC).status).toBe(0);
  });

  it("passes when only unrelated skips remain", () => {
    expect(run(write(withoutCspSkip(load()))).status).toBe(0);
  });

  it("fails on stats.unexpected > 0", () => {
    const rep = withoutCspSkip(load());
    rep.stats.unexpected = 1;
    expect(run(write(rep)).status).toBe(1);
  });

  it("fails on a report with 0 tests", () => {
    const rep = load();
    rep.suites = [];
    rep.stats = { ...rep.stats, expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
    expect(run(write(rep)).status).toBe(1);
  });

  it("fails when a --require'd spec is absent, passes when present", () => {
    expect(run(FIXTURE, "--allow", SPEC, "--require", `${SPEC},missing.spec.ts`).status).toBe(1);
    expect(run(FIXTURE, "--allow", SPEC, "--require", SPEC).status).toBe(0);
  });

  it("finds specs in nested describe suites", () => {
    const rep = load();
    const [top] = rep.suites;
    rep.suites = [{ ...top, specs: [], suites: [{ title: "group", file: top.file, specs: top.specs }] }];
    expect(run(write(rep)).status).toBe(1);
    expect(run(write(rep), "--allow", SPEC).status).toBe(0);
  });

  it("exits 2 on an unreadable report", () => {
    expect(run(path.join(tmp, "nope.json")).status).toBe(2);
  });
});
