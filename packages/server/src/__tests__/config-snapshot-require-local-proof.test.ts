/**
 * `liveRequireLocalProof()` is strict by default and reports a present non-boolean value once.
 * See change: close-container-loopback-impersonation (D1; test-plan #E1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveRequireLocalProof, resetConfigSnapshot } from "../config-snapshot.js";

let tmp: string;
let origHome: string | undefined;
const cfg = () => path.join(tmp, ".pi", "dashboard", "config.json");
function seed(data: object) {
  fs.mkdirSync(path.dirname(cfg()), { recursive: true });
  fs.writeFileSync(cfg(), JSON.stringify(data), { mode: 0o600 });
  resetConfigSnapshot();
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cs-rlp-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  resetConfigSnapshot();
});
afterEach(() => {
  process.env.HOME = origHome;
  vi.restoreAllMocks();
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("liveRequireLocalProof (E1)", () => {
  it.each([
    [undefined, true, 0],
    [true, true, 0],
    [false, false, 0],
    ["false", true, 1],
    ["yes", true, 1],
    [null, true, 1],
  ])("%j → %j with %i warning(s) however often it is read", (raw, want, warnings) => {
    seed(raw === undefined ? {} : { requireLocalProof: raw });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(liveRequireLocalProof()).toBe(want);
    expect(liveRequireLocalProof()).toBe(want);
    expect(liveRequireLocalProof()).toBe(want);
    const mine = warn.mock.calls.filter((c) => String(c[0]).includes("requireLocalProof"));
    expect(mine).toHaveLength(warnings);
  });

  it("warns again when the raw value changes to a different invalid value", () => {
    seed({ requireLocalProof: "false" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    liveRequireLocalProof();
    seed({ requireLocalProof: "no" });
    liveRequireLocalProof();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("requireLocalProof"))).toHaveLength(2);
  });
});
