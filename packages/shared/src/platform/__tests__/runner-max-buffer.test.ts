/**
 * `Recipe.maxBuffer` — opt-in stdout byte limit honoured by `runAsync`.
 * Real child processes (`process.execPath -e <script>`), so byte counting,
 * termination and settle-once are exercised end to end.
 * See change: fix-session-diff-heap-retention (D3).
 */
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type Recipe, runAsync } from "../runner.js";

const MiB = 1024 * 1024;

function nodeRecipe(script: string, extra: Partial<Recipe<void, string>> = {}): Recipe<void, string> {
  return {
    argv: () => [process.execPath, "-e", script],
    parse: (s) => s,
    timeout: 15_000,
    ...extra,
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tmpPidFile(tag: string): string {
  return join(tmpdir(), `runner-max-buffer-${tag}-${process.pid}-${Date.now()}.pid`);
}

/** Prefix a child script so it records its own pid in `pidFile` first. */
function withPidFile(pidFile: string, script: string): string {
  return `require("fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid));${script}`;
}

function readPid(pidFile: string): number {
  const pid = Number(readFileSync(pidFile, "utf8"));
  rmSync(pidFile, { force: true });
  expect(pid).toBeGreaterThan(0);
  return pid;
}

async function waitDead(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

/** Script that writes stdout forever (respecting backpressure). */
const WRITE_FOREVER = `const b="x".repeat(65536);(function w(){while(process.stdout.write(b)){}process.stdout.once("drain",w)})()`;

describe("runAsync — Recipe.maxBuffer", () => {
  it("E13: output exactly at the limit succeeds", async () => {
    const r = await runAsync(nodeRecipe(`process.stdout.write("a".repeat(${MiB}))`, { maxBuffer: MiB }), undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(MiB);
  });

  it("E14: output one byte over the limit fails with output-too-large", async () => {
    const r = await runAsync(nodeRecipe(`process.stdout.write("a".repeat(${MiB + 1}))`, { maxBuffer: MiB }), undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("output-too-large");
      if (r.error.kind === "output-too-large") {
        expect(r.error.limitBytes).toBe(MiB);
        expect(typeof r.error.message).toBe("string");
      }
    }
  });

  it("E15: counts raw bytes, not UTF-16 units", async () => {
    // 600k "é" = 600k UTF-16 units but 1.2 MB of UTF-8.
    const r = await runAsync(nodeRecipe(`process.stdout.write("é".repeat(600000))`, { maxBuffer: MiB }), undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("output-too-large");
  });

  it("E16: a recipe without maxBuffer is unbounded (opt-in)", async () => {
    const size = 5 * 1000 * 1000;
    const r = await runAsync(nodeRecipe(`process.stdout.write("a".repeat(${size}))`), undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(size);
  });

  it("X1: runaway output settles well before the timeout and the child dies", async () => {
    const pidFile = tmpPidFile("x1");
    const started = Date.now();
    const r = await runAsync(nodeRecipe(withPidFile(pidFile, WRITE_FOREVER), { maxBuffer: MiB }), undefined);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("output-too-large");
    expect(await waitDead(readPid(pidFile), 4_000)).toBe(true);
  }, 20_000);

  it.skipIf(process.platform === "win32")("X2: a child ignoring SIGTERM is SIGKILLed after overflow", async () => {
    const pidFile = tmpPidFile("x2");
    const script = withPidFile(pidFile, `process.on("SIGTERM",()=>{});${WRITE_FOREVER}`);
    const r = await runAsync(nodeRecipe(script, { maxBuffer: MiB }), undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("output-too-large");
    // 3 s SIGTERM→SIGKILL escalation + 1 s slack.
    expect(await waitDead(readPid(pidFile), 4_000)).toBe(true);
  }, 20_000);

  it("X3: parse never runs on truncated output (close after overflow is a no-op)", async () => {
    const parse = vi.fn((s: string) => s);
    const recipe = nodeRecipe(WRITE_FOREVER, { maxBuffer: MiB, parse });
    const r = await runAsync(recipe, undefined);
    expect(r.ok).toBe(false);
    // Let the child's close event fire after the overflow settle.
    await new Promise((res) => setTimeout(res, 500));
    expect(parse).not.toHaveBeenCalled();
  }, 20_000);
});
