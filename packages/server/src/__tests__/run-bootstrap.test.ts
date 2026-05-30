/**
 * Tests for `runBootstrap`. Drives real child_process.spawn via the
 * `pickCommand` override so we don't depend on `npm`/`pnpm`/etc being
 * installed on the test machine. We feed a tiny shell script that
 * exercises stdout streaming, exit codes, and throttling.
 *
 * See change: harden-worktree-spawn.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runBootstrap, type InstallCommand } from "../worktree-bootstrap.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-run-bootstrap-"));
});
afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
});

function shCommand(args: string[]): { pickCommand: (p: string) => InstallCommand | null } {
  return {
    pickCommand: () => ({ cmd: "sh", args, lockfile: "package-lock.json" }),
  };
}

describe("runBootstrap", () => {
  it("returns ok=true and durationMs on exit 0", async () => {
    const progress: string[] = [];
    const res = await runBootstrap(tmp, (p) => progress.push(p.line), {
      ...shCommand(["-c", "echo hello world; exit 0"]),
      throttleMs: 10,
    });
    expect(res.ok).toBe(true);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.code).toBeUndefined();
    expect(res.command).toBe("sh -c echo hello world; exit 0");
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress.join("")).toContain("hello world");
  });

  it("returns ok=false with install_nonzero_exit and stderr tail on exit 1", async () => {
    const res = await runBootstrap(tmp, () => {}, {
      ...shCommand(["-c", "echo OOPS >&2; exit 1"]),
      throttleMs: 10,
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("install_nonzero_exit");
    expect(res.stderr).toContain("OOPS");
  });

  it("returns ok=false with no_lockfile when picker returns null", async () => {
    const res = await runBootstrap(tmp, () => {}, {
      pickCommand: () => null,
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("no_lockfile");
  });

  it("throttles progress events under sustained flood (<= ~4 per sec)", async () => {
    const events: number[] = [];
    const start = Date.now();
    // 1000 lines with tiny sleep. On macOS `sleep 0.002` rounds up, so
    // the flood typically takes a few seconds. Bound emits relative to
    // observed elapsed time to keep the test portable.
    const res = await runBootstrap(tmp, () => { events.push(Date.now() - start); }, {
      ...shCommand(["-c", "for i in $(seq 1 1000); do echo line $i; sleep 0.002; done"]),
      throttleMs: 250,
    });
    expect(res.ok).toBe(true);
    const elapsedSec = (Date.now() - start) / 1000;
    // ~4 emits/sec under throttle + initial command-name event + final
    // flush + a small jitter buffer.
    expect(events.length).toBeLessThanOrEqual(Math.ceil(elapsedSec * 4) + 6);
    // More than just the initial event — should see several flushes.
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("flushes final tail on exit even if throttle window hasn't elapsed", async () => {
    const lastLine: string[] = [];
    const res = await runBootstrap(tmp, (p) => { lastLine[0] = p.line; }, {
      ...shCommand(["-c", "echo FINAL_MARKER"]),
      throttleMs: 5000, // long throttle: only the final flush emits the marker
    });
    expect(res.ok).toBe(true);
    expect(lastLine[0]).toContain("FINAL_MARKER");
  });

  it("tail respects tailBytes cap", async () => {
    const lastLine: string[] = [];
    const res = await runBootstrap(tmp, (p) => { lastLine[0] = p.line; }, {
      ...shCommand(["-c", "for i in $(seq 1 20); do echo aaaaaaaaaa; done"]),
      throttleMs: 5000,
      tailBytes: 32,
    });
    expect(res.ok).toBe(true);
    expect(lastLine[0]?.length).toBeLessThanOrEqual(32);
  });

  it("returns spawn_error when the command binary doesn't exist", async () => {
    const res = await runBootstrap(tmp, () => {}, {
      pickCommand: () => ({ cmd: "/no/such/binary/anywhere", args: [], lockfile: "x" }),
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("spawn_error");
  });
});
