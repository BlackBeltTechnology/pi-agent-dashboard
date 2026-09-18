/**
 * X4 — harvest: harvest hangs (#X4, 10.67).
 *
 * Observable: with the stall test hook on and the timeout lowered to 500 ms,
 * `parse` exits non-zero naming the slide and `timeout`, and leaves no
 * chromium process behind.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MERMAID = ["flowchart TD", "  A --> B"].join("\n");
const SLIDE_ID = "hang";
const TIMEOUT_MS = 500;

/** Pids of every running Playwright-managed chromium (browser + helpers). */
function chromiumPids(): number[] {
  const out = spawnSync("ps", ["-Awwo", "pid=,command="], { encoding: "utf8" }).stdout ?? "";
  const pids: number[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && m[2].includes("ms-playwright/")) pids.push(Number(m[1]));
  }
  return pids;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runHangingParse(dir: string) {
  const started = Date.now();
  const child = spawn(BIN, ["parse", "hang.md", "-o", "out.json"], {
    cwd: dir,
    env: { ...process.env, DECK3D_HARVEST_STALL: "1", DECK3D_HARVEST_TIMEOUT_MS: String(TIMEOUT_MS) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.resume();

  // Sample while the child lives so the "no browser left behind" check cannot
  // pass vacuously (we know which pids this run created), and ignore browsers
  // that already existed before the spawn (e.g. another suite's).
  const before = new Set(chromiumPids());
  const seen = new Set<number>();
  const poll = setInterval(() => {
    for (const pid of chromiumPids()) if (!before.has(pid)) seen.add(pid);
  }, 50);

  const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
  clearInterval(poll);
  const elapsedMs = Date.now() - started;

  const deadline = Date.now() + 5000;
  while ([...seen].some(alive) && Date.now() < deadline) await delay(100);

  return { status, stderr, elapsedMs, seen: [...seen], lingering: [...seen].filter(alive) };
}

describe.skipIf(!hasChromium)("harvest: harvest hangs (X4)", () => {
  it("times out promptly, names the slide and closes chromium", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-x4-"));
    writeFileSync(join(dir, "hang.md"), `# Hang\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);

    const { status, stderr, elapsedMs, seen, lingering } = await runHangingParse(dir);

    expect(status, stderr).not.toBe(0);
    expect(stderr).toContain(`"${SLIDE_ID}"`);
    expect(stderr).toMatch(/timeout/i);
    expect(existsSync(join(dir, "out.json"))).toBe(false);

    // The 500 ms hook was honoured: falling back to the 60 s default blows this.
    // (Not asserted as literally "<2 s": a cold chromium launch plus the ~8 MB
    // harness injection plus tsx boot already cost ~3.5 s here, before the
    // timeout is even armed, so a 2 s wall-clock bound would fail for reasons
    // unrelated to the timeout hook.)
    expect(elapsedMs, `parse took ${elapsedMs} ms with a ${TIMEOUT_MS} ms harvest timeout`).toBeLessThan(20_000);

    // A browser really was launched, and none survived the timeout.
    expect(seen.length, "no chromium process observed during the run").toBeGreaterThan(0);
    expect(lingering, "chromium pids still alive after parse exited").toEqual([]);
  }, 120_000);
});
