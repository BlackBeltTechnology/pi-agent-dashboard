/**
 * Soak-gate helper tests (change enforce-strict-csp-default, tasks 1.2–1.4).
 * Drives the exported pure functions; the CLI only shells `pi-dashboard api`
 * and file IO around them. Run: `node --test openspec/changes/enforce-strict-csp-default/soak/csp-soak.test.mjs`
 * (node's built-in runner; this directory is outside every vitest project).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canaryDelta, gateVerdict, strictBlockingCounts } from "./csp-soak.mjs";

const SINCE = "2026-11-01T10:00:00.000Z";
const snap = ({ since = SINCE, dropped = 0, strict = {}, baseline = {}, tt = {}, serverVersion = "0.11.0" } = {}) => ({
  takenAt: "2026-11-15T10:00:00.000Z",
  serverVersion,
  cspReports: { since, dropped, counts: { baseline, strict, "trusted-types": tt } },
});
const open = snap();

describe("strictBlockingCounts", () => {
  it("keeps every non-zero strict directive except require-trusted-types-for", () => {
    const s = snap({ strict: { "script-src-elem": 2, "connect-src": 1, "require-trusted-types-for": 9, "img-src": 0 } });
    assert.deepEqual(strictBlockingCounts(s), { "script-src-elem": 2, "connect-src": 1 });
  });
  it("ignores the baseline and trusted-types labels", () => {
    assert.deepEqual(strictBlockingCounts(snap({ baseline: { "script-src-elem": 3 }, tt: { "require-trusted-types-for": 4 } })), {});
  });
});

describe("gateVerdict", () => {
  it("passes a clean window", () => {
    const v = gateVerdict({ open, close: snap({ serverVersion: "0.11.1" }), openTag: "v0.11.0", closeTag: "v0.11.1" });
    assert.equal(v.pass, true);
    assert.deepEqual(v.failures, []);
  });

  it("fails on a strict script-src violation", () => {
    const v = gateVerdict({ open, close: snap({ strict: { "script-src-elem": 1 } }) });
    assert.equal(v.pass, false);
    assert.match(v.failures.join("\n"), /strict script-src-elem = 1/);
  });

  it("fails on a strict non-script directive too (connect-src)", () => {
    assert.equal(gateVerdict({ open, close: snap({ strict: { "connect-src": 2 } }) }).pass, false);
  });

  it("does not count require-trusted-types-for", () => {
    assert.equal(gateVerdict({ open, close: snap({ strict: { "require-trusted-types-for": 5 } }) }).pass, true);
  });

  it("fails on dropped > 0", () => {
    const v = gateVerdict({ open, close: snap({ dropped: 1 }) });
    assert.equal(v.pass, false);
    assert.match(v.failures.join("\n"), /dropped = 1/);
  });

  it("fails when since changed (evidence restarted)", () => {
    const v = gateVerdict({ open, close: snap({ since: "2026-11-05T00:00:00.000Z" }) });
    assert.equal(v.pass, false);
    assert.match(v.failures.join("\n"), /since changed/);
  });

  it("fails when either snapshot lacks cspReports (disclosure refused)", () => {
    assert.equal(gateVerdict({ open, close: { serverVersion: "0.11.1" } }).pass, false);
  });

  it("an exclusion covering the full count passes and is reported", () => {
    const v = gateVerdict({
      open,
      close: snap({ strict: { "connect-src": 2 } }),
      exclusions: [{ directive: "connect-src", count: 2, reason: "switcher flow: known-server switch on /" }],
    });
    assert.equal(v.pass, true);
    assert.deepEqual(v.excluded, [{ directive: "connect-src", count: 2, reason: "switcher flow: known-server switch on /" }]);
  });

  it("an exclusion below the observed count still fails", () => {
    const v = gateVerdict({
      open,
      close: snap({ strict: { "connect-src": 3 } }),
      exclusions: [{ directive: "connect-src", count: 2, reason: "switcher" }],
    });
    assert.equal(v.pass, false);
    assert.match(v.failures.join("\n"), /connect-src = 3 \(2 excluded\)/);
  });

  it("an exclusion without a reason is rejected", () => {
    const v = gateVerdict({ open, close: snap({ strict: { "img-src": 1 } }), exclusions: [{ directive: "img-src", count: 1, reason: " " }] });
    assert.equal(v.pass, false);
    assert.match(v.failures.join("\n"), /exclusion for img-src has no reason/);
  });

  it("an exclusion for require-trusted-types-for or dropped is rejected", () => {
    const v = gateVerdict({ open, close: snap(), exclusions: [{ directive: "dropped", count: 1, reason: "x" }] });
    assert.equal(v.pass, false);
  });

  it("fails when open and close tags are the same release", () => {
    const v = gateVerdict({ open, close: snap(), openTag: "v0.11.0", closeTag: "v0.11.0" });
    assert.equal(v.pass, false);
    assert.match(v.failures.join("\n"), /same release/);
  });

  it("compares serverVersion to the tag without its leading v", () => {
    const v = gateVerdict({ open, close: snap({ serverVersion: "0.11.0" }), openTag: "v0.11.0", closeTag: "v0.11.1" });
    assert.equal(v.pass, false);
    assert.match(v.failures.join("\n"), /close serverVersion 0\.11\.0 != tag v0\.11\.1/);
  });
});

describe("canaryDelta", () => {
  it("reports the strict script-src-elem increase", () => {
    assert.equal(canaryDelta(snap({ strict: { "script-src-elem": 1 } }), snap({ strict: { "script-src-elem": 2 } })), 1);
  });
  it("is 0 when nothing arrived", () => {
    assert.equal(canaryDelta(snap(), snap()), 0);
  });
});
