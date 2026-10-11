/**
 * `RunCtx.signal` / `RunCtx.onClose` — abortable `runAsync`.
 * Real child processes so SIGTERM→SIGKILL escalation is exercised end to end.
 * Covers test-plan X4. See change: harden-plugin-cwd-admission.
 */
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type Recipe, runAsync } from "../runner.js";

function nodeRecipe(script: string): Recipe<void, string> {
  return { argv: () => [process.execPath, "-e", script], parse: (s) => s, timeout: 30_000 };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

async function waitForFile(file: string, withinMs: number): Promise<number> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    try {
      const v = Number(readFileSync(file, "utf8"));
      if (v > 0) return v;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("pid file never appeared");
}

describe("runAsync — AbortSignal", () => {
  it("X4: abort settles non-ok within 500 ms and the child is gone after SIGKILL escalation", async () => {
    const pidFile = join(tmpdir(), `runner-abort-${process.pid}-${Date.now()}.pid`);
    // Ignores SIGTERM so the 3 s SIGKILL escalation is what ends it.
    const script = `require("fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on("SIGTERM",()=>{});setTimeout(()=>{},30000)`;
    const ac = new AbortController();
    const onClose = vi.fn();
    const started = Date.now();
    const pending = runAsync(nodeRecipe(script), undefined, { signal: ac.signal, onClose });
    const pid = await waitForFile(pidFile, 5_000);
    ac.abort();
    const r = await pending;
    rmSync(pidFile, { force: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("aborted");
    expect(Date.now() - started).toBeLessThan(5_000);
    // Settled before the child exited: the slot signal fires only on exit.
    expect(onClose).not.toHaveBeenCalled();
    expect(await waitDead(pid, 4_500)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("settles within 500 ms of the abort", async () => {
    const ac = new AbortController();
    const pending = runAsync(nodeRecipe("setTimeout(()=>{},30000)"), undefined, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    ac.abort();
    const r = await pending;
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.ok).toBe(false);
  });

  it("an already-aborted signal settles without spawning and still reports onClose once", async () => {
    const ac = new AbortController();
    ac.abort();
    const onClose = vi.fn();
    const r = await runAsync(nodeRecipe("process.exit(0)"), undefined, { signal: ac.signal, onClose });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("aborted");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a normal run is unaffected and onClose fires once", async () => {
    const ac = new AbortController();
    const onClose = vi.fn();
    const r = await runAsync(nodeRecipe(`process.stdout.write("ok")`), undefined, { signal: ac.signal, onClose });
    expect(r.ok).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    ac.abort(); // late abort after close: no throw, no second onClose
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
