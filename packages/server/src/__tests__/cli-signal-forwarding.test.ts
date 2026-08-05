/**
 * `bin/pi-dashboard.mjs` runs the real server as a CHILD process, so the wrapper
 * is the process every external supervisor signals (it owns `argv[1]`). If it
 * does not forward SIGTERM/SIGINT, the wrapper dies and the server child is
 * orphaned — and the server's own signal handler (records `exitIntent:"signal"`,
 * flushes `.meta.json`) never runs. Found live while verifying this change
 * manually: `kill <wrapper-pid>` left the server still answering /api/health
 * with no exit intent recorded.
 *
 * End-to-end: real wrapper → real jiti-loaded server → SIGTERM the wrapper →
 * the boot record must carry `"signal"` and both processes must be gone.
 *
 * See change: fix-recovery-exit-intent (task 3.5).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WRAPPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bin/pi-dashboard.mjs",
);
const BOOT_STATE = path.join(os.homedir(), ".pi", "dashboard", "boot-state.json");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ephemeral-ish ports; the wrapper CLI needs concrete numbers. */
const HTTP_PORT = 8300 + Math.floor(Math.random() * 400);
const PI_PORT = 9300 + Math.floor(Math.random() * 400);

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await delay(250);
  }
  return false;
}

describe("pi-dashboard wrapper signal forwarding", () => {
  it("SIGTERM to the wrapper reaches the server, which records exitIntent:signal", async () => {
    mkdirSync(path.dirname(BOOT_STATE), { recursive: true });
    writeFileSync(
      path.join(path.dirname(BOOT_STATE), "config.json"),
      JSON.stringify({ port: HTTP_PORT, piPort: PI_PORT, autoShutdown: false, tunnel: false }),
    );

    const proc = spawn(
      process.execPath,
      [WRAPPER, "--port", String(HTTP_PORT), "--pi-port", String(PI_PORT)],
      { stdio: "ignore", env: { ...process.env } },
    );

    const up = await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`, {
          signal: AbortSignal.timeout(1500),
        });
        return res.ok;
      } catch {
        return false;
      }
    }, 60_000);
    if (!up) {
      proc.kill("SIGKILL");
      // A boot failure here is environmental (port taken / install skew), not a
      // regression in the forwarding contract — the source assertion below still
      // guards it. Fail loudly rather than silently passing.
      throw new Error(`server did not boot on :${HTTP_PORT}`);
    }

    // The boot record exists with no intent yet.
    expect(JSON.parse(readFileSync(BOOT_STATE, "utf-8")).exitIntent).toBeNull();

    proc.kill("SIGTERM");

    // The wrapper must exit (not hang) …
    const exited = await waitFor(() => proc.exitCode !== null || proc.signalCode !== null, 20_000);
    expect(exited).toBe(true);
    // … the server must be gone …
    const down = await waitFor(async () => {
      try {
        await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
        return false;
      } catch {
        return true;
      }
    }, 20_000);
    expect(down).toBe(true);
    // … and it recorded WHY it left, so the next boot offers those sessions.
    expect(existsSync(BOOT_STATE)).toBe(true);
    expect(JSON.parse(readFileSync(BOOT_STATE, "utf-8")).exitIntent).toBe("signal");
  }, 120_000);
});
