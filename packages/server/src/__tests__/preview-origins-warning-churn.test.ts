/**
 * Tier-2 cookie-tossing warning under config churn.
 *
 *  T.P20  200 config writes in 10 s alternating an invalid / valid shared-parent wildcard suffix: no more than one
 *         warning per effective change (dedupe on identical state); evaluation time per write ≤ 1.2× the same
 *         churn with no warning to emit, measured in the same run (Q48).
 *
 * The warning lives in `config-snapshot.ts` (`warnParentDomainShare`, called from the change-only logging block of
 * `getResolvedPreviewOrigins`), so this sits in the server package beside `config-snapshot-preview-origins.test.ts`.
 *
 * See change: serve-live-previews-on-capability-origin (D10; task 4.3; test-plan #P20, Q21, Q48).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getResolvedPreviewOrigins,
  resetConfigSnapshot,
  setPreviewOriginsRuntime,
} from "../config-snapshot.js";

let tmp: string;
let origHome: string | undefined;
let tick = 0;
const cfg = () => path.join(tmp, ".pi", "dashboard", "config.json");

/** Write the file and force a distinct mtime so the stamp moves even within one millisecond. */
function write(data: object) {
  fs.mkdirSync(path.dirname(cfg()), { recursive: true });
  fs.writeFileSync(cfg(), JSON.stringify(data), { mode: 0o600 });
  tick += 2;
  const t = new Date(1_700_000_000_000 + tick * 1000);
  fs.utimesSync(cfg(), t, t);
}

const HOST = "dash.example.com";
/** Valid wildcard whose suffix shares the dashboard host's registrable parent: tier 2 active ⇒ one warning. */
const SHARED = { liveServer: { previewOrigins: { wildcard: { suffix: "preview.example.com", forHosts: [HOST] } } } };
/** The same shape on an unrelated registrable domain: tier 2 active, nothing to warn about. */
const SEPARATE = { liveServer: { previewOrigins: { wildcard: { suffix: "preview.separate-domain.net", forHosts: [HOST] } } } };
/** An invalid suffix: tier 2 is not active, so there is no tossing surface and no warning. */
const INVALID = { liveServer: { previewOrigins: { wildcard: { suffix: "not a valid suffix!", forHosts: [HOST] } } } };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "po-churn-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  tick = 0;
  resetConfigSnapshot();
  setPreviewOriginsRuntime({});
});
afterEach(() => {
  process.env.HOME = origHome;
  vi.restoreAllMocks();
  setPreviewOriginsRuntime({});
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sharedWarnings = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => String(c[0]).includes("shares a parent domain"));

describe("T.P20 — warning storm on config churn", () => {
  it("sanity: the three fixtures resolve as intended (shared ⇒ tier 2 + warning, separate ⇒ tier 2 only, invalid ⇒ no tier 2)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    write(SHARED);
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
    expect(sharedWarnings(warn)).toHaveLength(1);
    write(SEPARATE);
    expect(getResolvedPreviewOrigins().tiers).toContain(2);
    expect(sharedWarnings(warn)).toHaveLength(1); // no new one
    write(INVALID);
    expect(getResolvedPreviewOrigins().tiers).not.toContain(2);
    expect(sharedWarnings(warn)).toHaveLength(1);
  });

  it("200 alternating invalid/valid shared-parent writes within 10 s: exactly one warning per effective change into the shared state, none otherwise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const started = performance.now();
    let effectiveChanges = 0; // writes that moved the resolved state INTO "tier 2 + shared parent"
    for (let i = 0; i < 200; i++) {
      const shared = i % 2 === 1; // 0: invalid, 1: shared, 2: invalid, …
      write(shared ? SHARED : INVALID);
      const before = sharedWarnings(warn).length;
      getResolvedPreviewOrigins();
      const emitted = sharedWarnings(warn).length - before;
      if (shared) {
        effectiveChanges++;
        expect(emitted, `write ${i}`).toBe(1);
      } else expect(emitted, `write ${i}`).toBe(0);
    }
    const elapsedMs = performance.now() - started;
    expect(effectiveChanges).toBe(100);
    expect(sharedWarnings(warn)).toHaveLength(100); // ≤ 1 per effective change, never a storm
    expect(elapsedMs).toBeLessThan(10_000); // the window of the workload
    // every line names the dashboard host once (one forHosts entry ⇒ one line per change)
    expect(sharedWarnings(warn).every((c) => String(c[0]).includes(HOST))).toBe(true);
  });

  it("dedupe on identical state: 200 rewrites of the same effective config (the stamp moves every time) add no warning after the first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < 200; i++) {
      // an unrelated key changes, so the file really is rewritten and re-parsed; the resolved preview state is identical
      write({ ...SHARED, ui: { churn: i } });
      getResolvedPreviewOrigins();
    }
    expect(sharedWarnings(warn)).toHaveLength(1);
    // repeated reads of an unchanged file never warn either
    for (let i = 0; i < 1000; i++) getResolvedPreviewOrigins();
    expect(sharedWarnings(warn)).toHaveLength(1);
  });

  it("a read burst between two writes is one evaluation: still one warning per change", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (let round = 0; round < 20; round++) {
      write(round % 2 === 0 ? SHARED : INVALID);
      for (let k = 0; k < 50; k++) getResolvedPreviewOrigins();
    }
    expect(sharedWarnings(warn)).toHaveLength(10);
  });

  it("evaluation time per write with the warning path live is ≤ 1.2× the same churn with nothing to warn about (same run)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    /** Mean µs of `getResolvedPreviewOrigins()` right after a write, over a 200-write alternating run. */
    const run = (valid: object): number => {
      resetConfigSnapshot();
      let total = 0;
      for (let i = 0; i < 200; i++) {
        write(i % 2 === 1 ? valid : INVALID);
        const t0 = process.hrtime.bigint();
        getResolvedPreviewOrigins();
        total += Number(process.hrtime.bigint() - t0);
      }
      return total / 200 / 1000;
    };

    // warm both paths, then alternate rounds so drift hits both equally
    run(SHARED);
    run(SEPARATE);
    const withWarning: number[] = [];
    const without: number[] = [];
    for (let round = 0; round < 9; round++) {
      if (round % 2 === 0) {
        withWarning.push(run(SHARED));
        without.push(run(SEPARATE));
      } else {
        without.push(run(SEPARATE));
        withWarning.push(run(SHARED));
      }
    }
    const w = median(withWarning);
    const b = median(without);
    process.stderr.write(`[P20] 200 writes/round × 9 rounds: eval with warning median=${w.toFixed(1)}µs, without=${b.toFixed(1)}µs, ratio=${(w / b).toFixed(3)}\n`);
    expect(w).toBeLessThanOrEqual(b * 1.2);
  }, 120_000);
});
