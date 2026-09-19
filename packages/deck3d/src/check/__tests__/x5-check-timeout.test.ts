/**
 * X5 (test-plan) — check: per-viewport timeout.
 *
 * `runCheck` wraps each viewport's check in `withTimeout(..., DECK3D_CHECK_TIMEOUT_MS)`
 * and closes the browser in a `finally`. There is no `DECK3D_CHECK_STALL` harness
 * hook in `src/check/index.ts` (the deck's `ready()` is never awaited by check),
 * so the stall is driven with a page-mock: a deck.html whose `measure()` returns a
 * promise that never settles.
 *
 * Asserted: the CLI exits non-zero naming viewport `1920x1080` + `timeout`; the
 * direct `runCheck` path rejects with that message and `browser.close()` ran once.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({ launched: 0, closed: 0 }));

vi.mock("playwright", async (importOriginal) => {
  const actual = await importOriginal<typeof import("playwright")>();
  const launch = actual.chromium.launch.bind(actual.chromium);
  return {
    ...actual,
    chromium: new Proxy(actual.chromium, {
      get(target, prop, receiver) {
        if (prop === "launch") {
          return async (...args: Parameters<typeof launch>) => {
            counters.launched += 1;
            const browser: Browser = await launch(...args);
            const close = browser.close.bind(browser);
            browser.close = async () => {
              counters.closed += 1;
              return close();
            };
            return browser;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { runCheck } from "../index.js";

const hasChromium = await chromiumAvailable();
const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

/** Minimal deck.html satisfying the check driver, whose `measure()` never resolves. */
const STALL_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>stall</title></head>
<body><script>
window.__DECK = { slides: [{ id: "stall" }] };
window.__deck3d = {
  gotoSlide: function () {},
  peaks: function () { return [0]; },
  setTime: function () {},
  measure: function () { return new Promise(function () {}); },
  effects: function () { return { active: [], skipped: [] }; }
};
</script></body></html>
`;

function writeStall(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-check-x5-"));
  const path = join(dir, "stall.html");
  writeFileSync(path, STALL_HTML);
  return path;
}

describe.skipIf(!hasChromium)("deck3d check timeout per viewport (X5)", () => {
  it("exits non-zero naming viewport 1920x1080 and timeout (CLI)", () => {
    const path = writeStall();
    const r = spawnSync(BIN, ["check", path], {
      env: { ...process.env, DECK3D_CHECK_TIMEOUT_MS: "500" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain("1920x1080");
    expect(r.stderr).toContain("timeout");
  }, 60_000);

  it("rejects with the viewport timeout and closes the browser", async () => {
    counters.launched = 0;
    counters.closed = 0;
    const path = writeStall();

    await expect(runCheck(path, { timeoutMs: 500, viewports: [{ w: 1920, h: 1080 }] })).rejects.toThrow(
      /viewport 1920x1080: check timeout after 500 ms/,
    );

    expect(counters.launched).toBe(1);
    expect(counters.closed).toBe(1);
  }, 60_000);
});
