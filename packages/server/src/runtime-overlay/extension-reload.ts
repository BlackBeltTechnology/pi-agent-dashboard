/**
 * D8 convergent bridge reload. On every bridge (re-)register the server
 * compares the bridge's reported extension identity (realpath'd dir +
 * version) with the ACTIVE runtime's extension (`PI_DASHBOARD_EXTENSION_DIR`,
 * set by Electron at spawn). A mismatch schedules ONE `/reload` for that
 * session per active runtime id, so a failed re-point cannot loop. A mismatch
 * that persists after the reload is recorded (`extension_mismatch`) for the
 * Doctor row.
 *
 * Timing: the reload is never sent at register time — it waits `settleMs`
 * (replay restores the real streaming status) and then until the session is
 * idle (`isBusy`), retrying a refused/failed dispatch, bounded by `maxWaitMs`.
 * Only a dispatch that lands consumes the one reload. A later register
 * (converged or not) supersedes a pending attempt.
 *
 * See change: electron-runtime-overlay-updates.
 */
import fs from "node:fs";
import type { BridgeExtensionIdentity } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

export interface ActiveExtension {
  runtimeId: string;
  dir: string;
  version?: string;
}

interface ExtensionMismatch {
  sessionId: string;
  runtimeId: string;
  expected: string;
  reported: string | null;
  at: number;
}

type RegisterOutcome = "skipped" | "match" | "scheduled" | "mismatch";

export interface ExtensionReloadGuard {
  onRegister(sessionId: string, identity: BridgeExtensionIdentity | undefined): RegisterOutcome;
  /** Persisting mismatches (after the one reload). */
  mismatches(): ExtensionMismatch[];
}

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

const EXTENSION_PACKAGE = "@blackbelt-technology/pi-dashboard-extension";

/**
 * The active runtime's extension from the Electron spawn env, validated:
 * Electron owner token (`PI_DASHBOARD_ELECTRON_INSTANCE`) set, `PI_DASHBOARD_EXTENSION_DIR` is a real dir whose
 * package.json names the dashboard extension. Anything else → null (fail
 * closed: no override, no convergence), so a stale / inherited env var can
 * never be written into settings.json.
 */
export function activeExtensionFromEnv(env: NodeJS.ProcessEnv = process.env): ActiveExtension | null {
  const dir = env.PI_DASHBOARD_EXTENSION_DIR;
  const runtimeId = env.PI_DASHBOARD_RUNTIME_ID;
  if (!env.PI_DASHBOARD_ELECTRON_INSTANCE || !dir || !runtimeId) return null;
  try {
    const real = fs.realpathSync(dir);
    const pkg = JSON.parse(fs.readFileSync(`${real}/package.json`, "utf8")) as { name?: unknown; version?: unknown };
    if (pkg.name !== EXTENSION_PACKAGE) return null;
    return { runtimeId, dir: real, ...(typeof pkg.version === "string" ? { version: pkg.version } : {}) };
  } catch {
    return null;
  }
}

const FAILED_OUTCOMES = new Set<unknown>(["refused", "error"]);

export function createExtensionReloadGuard(opts: {
  active: () => ActiveExtension | null;
  /** Dispatch `/reload`; a `"refused"`/`"error"` outcome (or a throw) is retried. */
  reload: (sessionId: string) => void | Promise<unknown>;
  /** Mid-turn / compacting → wait. */
  isBusy?: (sessionId: string) => boolean;
  onMismatch?: (sessionId: string, detail: string) => void;
  realpath?: (p: string) => string;
  settleMs?: number;
  retryMs?: number;
  maxWaitMs?: number;
}): ExtensionReloadGuard {
  const realpath = opts.realpath ?? safeRealpath;
  const settleMs = opts.settleMs ?? 6_000;
  const retryMs = opts.retryMs ?? 2_000;
  const maxWaitMs = opts.maxWaitMs ?? 10 * 60_000;
  /** sessionId → runtime id whose one reload has landed. */
  const reloadedFor = new Map<string, string>();
  /** sessionId → pending attempt timer. */
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const mismatched = new Map<string, ExtensionMismatch>();

  const cancel = (sessionId: string) => {
    const t = pending.get(sessionId);
    if (t) clearTimeout(t);
    pending.delete(sessionId);
  };

  const schedule = (sessionId: string, runtimeId: string, delay: number, deadline: number) => {
    cancel(sessionId);
    const timer = setTimeout(() => {
      pending.delete(sessionId);
      if (opts.active()?.runtimeId !== runtimeId) return; // superseded runtime
      const retry = () => {
        if (Date.now() + retryMs <= deadline) schedule(sessionId, runtimeId, retryMs, deadline);
      };
      if (opts.isBusy?.(sessionId)) return retry();
      Promise.resolve()
        .then(() => opts.reload(sessionId))
        .then((outcome) => {
          if (FAILED_OUTCOMES.has(outcome)) retry();
          else reloadedFor.set(sessionId, runtimeId);
        })
        .catch((err: unknown) => {
          console.warn(`[runtime-overlay] extension reload failed session=${sessionId}: ${String(err)}`);
          retry();
        });
    }, delay);
    timer.unref?.();
    pending.set(sessionId, timer);
  };

  return {
    onRegister(sessionId, identity) {
      const active = opts.active();
      if (!active) return "skipped";
      const expected = realpath(active.dir);
      const reported = identity?.dir ? realpath(identity.dir) : null;
      const versionDiffers = !!active.version && !!identity?.version && identity.version !== active.version;
      if (reported === expected && !versionDiffers) {
        cancel(sessionId);
        mismatched.delete(sessionId);
        return "match";
      }
      if (reloadedFor.get(sessionId) === active.runtimeId) {
        cancel(sessionId);
        mismatched.set(sessionId, { sessionId, runtimeId: active.runtimeId, expected, reported, at: Date.now() });
        opts.onMismatch?.(
          sessionId,
          `extension_mismatch runtime=${active.runtimeId} expected=${expected}@${active.version ?? "?"} reported=${reported ?? "(none)"}@${identity?.version ?? "?"}`,
        );
        return "mismatch";
      }
      schedule(sessionId, active.runtimeId, settleMs, Date.now() + maxWaitMs);
      return "scheduled";
    },
    mismatches: () => [...mismatched.values()],
  };
}
