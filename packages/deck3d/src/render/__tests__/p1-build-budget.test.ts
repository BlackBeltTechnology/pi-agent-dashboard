/**
 * P1 (task 10.48) — render: build budget (wall time).
 *
 * `deck3d build fixtures/strategy-lab.md` (7 slides, 2 mermaid blocks, no props)
 * must finish within 20 s measured *from after chromium launch*. The build
 * launches chromium twice (mermaid harvest at parse + the fit check at the end),
 * so this test measures a chromium launch/close on this machine and subtracts
 * two launch constants from the CLI wall time. The subtraction is approximate
 * (launch cost varies with machine load); it is intentionally conservative — a
 * real regression in parse/render cost still blows the 20 s bound.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();
const FIXTURE = readFileSync(new URL("../../../fixtures/strategy-lab.md", import.meta.url), "utf8");

describe.skipIf(!hasChromium)("P1 fixture build within budget (chromium)", () => {
  it("completes within 20 s after chromium launch", async () => {
    const launched = performance.now();
    const probe = await chromium.launch({ channel: "chromium" });
    await probe.close();
    const launchMs = performance.now() - launched;

    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-p1-"));
    writeFileSync(join(dir, "strategy-lab.md"), FIXTURE);

    const start = Date.now();
    const build = spawnSync(BIN, ["build", "strategy-lab.md", "-o", "deck.html"], { cwd: dir, encoding: "utf8" });
    const wallMs = Date.now() - start;

    expect(build.status, build.stderr).toBe(0);
    expect(existsSync(join(dir, "deck.html"))).toBe(true);
    const postLaunchMs = wallMs - launchMs * 2;
    expect(postLaunchMs, `wall ${wallMs}ms − 2×launch ${launchMs.toFixed(0)}ms`).toBeLessThanOrEqual(20_000);
  }, 120_000);
});
