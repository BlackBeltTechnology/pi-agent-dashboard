/**
 * Boot-parent liveness + live parent-PID reader for `/api/health`.
 *
 * `bootParentPid` is captured ONCE at module load — the parent PID the server
 * was spawned under (e.g. the Electron process). `computeBootParentAlive()`
 * answers "is that exact process still alive?" — the load-bearing signal for
 * Windows zombie detection (Windows never reparents an orphan, so the POSIX
 * `ppid !== bootParentPid` signal is unavailable there).
 *
 * Two-tier computation:
 *   Tier 1 (all platforms, zero-dep): `isProcessAlive(bootParentPid)` via
 *     `process.kill` with signal 0. PID-reuse-vulnerable — a recycled parent PID
 *     reads "alive" and hides a zombie (safe direction: only under-detects).
 *   Tier 2 (win32 only, identity-safe): hold a `SYNCHRONIZE` handle to the
 *     specific parent process object via koffi `OpenProcess`, then per request
 *     `WaitForSingleObject(handle, 0) === WAIT_OBJECT_0` ⇒ that exact process
 *     exited. Immune to PID reuse (kernel pins the object while the handle is
 *     held). Falls back to Tier 1 on any failure (koffi load, null handle,
 *     denied access). Never throws.
 *
 * `readLivePpid()` returns the server's LIVE parent PID (reparenting-aware) —
 * NOT `process.ppid`, which Node caches on first access and would stay pinned
 * to the original (now-dead) parent forever.
 *
 * Supported-Node floor: koffi 3.x targets N-API 8 (Node >= 16). The bundled
 * server runtime (Node 24, see repo `.nvmrc`) and the package `engines` floor
 * (>= 22.19.0) are both comfortably within koffi's supported N-API range, so
 * no Node/koffi pin mismatch. See change: electron-attach-ownership-fixes
 * (task 1b.3).
 *
 * See change: electron-attach-ownership-fixes.
 */

import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

/** Parent PID captured once at boot. The process the server was spawned under. */
export const bootParentPid: number = process.ppid;

// ── Tier 2 (win32) koffi handle ──────────────────────────────────────────────

const SYNCHRONIZE = 0x0010_0000;
const WAIT_OBJECT_0 = 0x0;

/** Once true, `computeBootParentAlive()` permanently routes to Tier 1. */
let tier2Disabled = false;
let waitForSingleObject: ((handle: unknown, ms: number) => number) | null = null;
let bootParentHandle: unknown = null;

if (process.platform === "win32") {
  try {
    // jiti-safe load: createRequire bypasses jiti ESM-interop wrapping and
    // resolves koffi from the bundled server tree (resources/server/node_modules).
    const req = createRequire(import.meta.url);
    const mod = req("koffi") as any;
    const koffi = mod.default ?? mod;
    const kernel32 = koffi.load("kernel32.dll");
    // OpenProcess(uint32 access, bool inherit, uint32 pid) -> void*
    const OpenProcess = kernel32.func(
      "void* __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)",
    );
    // WaitForSingleObject(void* h, uint32 ms) -> uint32
    const WaitForSingleObject = kernel32.func(
      "uint32 __stdcall WaitForSingleObject(void* hHandle, uint32 dwMilliseconds)",
    );
    const handle = OpenProcess(SYNCHRONIZE, false, bootParentPid);
    if (handle) {
      bootParentHandle = handle;
      waitForSingleObject = (h, ms) => WaitForSingleObject(h, ms) as number;
    } else {
      tier2Disabled = true;
    }
  } catch {
    // koffi unavailable / OpenProcess denied → permanent Tier 1.
    tier2Disabled = true;
  }
}

/**
 * Whether the recorded boot parent (`bootParentPid`) is still the same live
 * process it was at boot. Never throws; degrades to Tier 1 on any Tier-2
 * failure.
 */
export function computeBootParentAlive(): boolean {
  if (waitForSingleObject && bootParentHandle && !tier2Disabled) {
    try {
      // WAIT_OBJECT_0 means the process signalled (exited) → not alive.
      return waitForSingleObject(bootParentHandle, 0) !== WAIT_OBJECT_0;
    } catch {
      tier2Disabled = true;
      // fall through to Tier 1
    }
  }
  return isProcessAlive(bootParentPid);
}

/**
 * Diagnostic: which liveness tier is ACTIVE. `"tier2"` when the koffi
 * `SYNCHRONIZE` handle loaded and `OpenProcess` succeeded (identity-safe,
 * win32 only); `"tier1"` otherwise (the `process.kill` signal-0 fallback — every
 * non-win32 platform, and win32 when koffi/OpenProcess is unavailable). Used by
 * the Windows liveness smoke to assert the koffi path loaded rather than
 * silently degrading. See change: electron-attach-ownership-fixes (task 1b.4).
 */
export function bootParentLivenessTier(): "tier1" | "tier2" {
  return waitForSingleObject && bootParentHandle && !tier2Disabled ? "tier2" : "tier1";
}

// ── Live parent-PID reader (reparenting-aware) ───────────────────────────────

// Cache the platform branch (NOT the value): the reader function is chosen
// once, but it re-reads the live ppid on every call.
const readLivePpidImpl: () => number = (() => {
  if (process.platform === "linux") {
    return () => {
      try {
        // Direct file read — no subprocess. /api/health is polled frequently
        // (tray 3s, Doctor, zombie detection), so avoid a per-request fork.
        const stat = readFileSync("/proc/self/stat", "utf-8");
        // Format: pid (comm) state ppid ... — comm may contain spaces/parens,
        // so slice after the LAST ')' then split on whitespace.
        const rparen = stat.lastIndexOf(")");
        const rest = stat.slice(rparen + 1).trim().split(/\s+/);
        // rest[0] = state, rest[1] = ppid
        const ppid = Number.parseInt(rest[1], 10);
        return Number.isFinite(ppid) ? ppid : process.ppid;
      } catch {
        return process.ppid;
      }
    };
  }
  if (process.platform === "darwin") {
    return () => {
      try {
        // macOS has no /proc; `ps` is the live-ppid source. execFileSync (no
        // shell) + a hard timeout so a stalled `ps` can never block the
        // single-threaded Fastify event loop on the health hot path.
        const out = execFileSync("ps", ["-o", "ppid=", "-p", String(process.pid)], {
          encoding: "utf-8",
          timeout: 1000,
        });
        const ppid = Number.parseInt(out.trim(), 10);
        return Number.isFinite(ppid) ? ppid : process.ppid;
      } catch {
        return process.ppid;
      }
    };
  }
  // Windows (and any other platform): Windows never reparents, so the cached
  // getter is correct; zombie detection uses bootParentAlive there.
  return () => process.ppid;
})();

/** The server's LIVE parent PID, read fresh per call. */
export function readLivePpid(): number {
  return readLivePpidImpl();
}
