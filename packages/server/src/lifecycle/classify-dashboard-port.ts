/**
 * One read-only answer to "what is on this dashboard port?" for `pi-dashboard
 * start` and `status`. Probes both IPv4/IPv6 loopbacks (and a specific bind
 * host) in parallel with bounded retries, then maps the answers onto a kind:
 *
 *   owned              an owned dashboard answers
 *   unowned-dashboard  a dashboard answers, ownership unproven
 *   conflict           a non-dashboard service answers
 *   unresponsive       held but silent (frozen / overloaded)
 *   starting           refused, and a live lock holder for this port started < 30 s ago
 *   free               refused, otherwise
 *
 * Ownership is the exact rule `stop` uses (`isOwnedHealth` in
 * `stop-ownership.ts`). `server.pid` is never read: a stale pid file naming an
 * unrelated live process must not block `free`. Never writes an instance-id,
 * lock, metadata or pid file.
 *
 * See change: harden-dashboard-start-detection (D2).
 */
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { type DashboardStatus, isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { getLockPath, getMetaPath, HOLDER_START_GRACE_MS, type LockMetadata, readMetadata } from "./home-lock.js";
import { peekInstanceId } from "./instance-id.js";
import { isOwnedHealth, lockOwnedPid } from "./stop-ownership.js";

/** Per-address probe budget: 3 attempts × 2 s + 2 × 0.5 s sleeps ≈ 7 s worst case, in parallel. */
export const CLASSIFY_PROBE_OPTS = { timeoutMs: 2000, retries: 2, retryDelayMs: 500 } as const;

export interface ClassifyConfig {
  port: number;
  piPort: number;
  host?: string | null;
}

export type PortClassification =
  | { kind: "owned"; pid: number; version?: string }
  | { kind: "unowned-dashboard"; pid: number | undefined }
  | { kind: "conflict" }
  | { kind: "unresponsive"; pid: number | undefined }
  | { kind: "starting"; pid: number }
  | { kind: "free" };

export interface ClassifyDeps {
  probe: (port: number, host: string, opts: typeof CLASSIFY_PROBE_OPTS & { _sleep?: (ms: number) => Promise<void> }) => Promise<DashboardStatus>;
  readLockMeta: () => LockMetadata | null;
  peekInstanceId: (piPort: number) => string | null;
  isProcessAlive: (pid: number) => boolean;
  now: () => number;
  /** Test seam forwarded to the probe's retry sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultDeps: ClassifyDeps = {
  probe: (port, host, opts) => isDashboardRunning(port, host, opts),
  readLockMeta: () => readMetadata(getMetaPath(getLockPath())),
  peekInstanceId: (piPort) => peekInstanceId(undefined, piPort),
  isProcessAlive,
  now: Date.now,
};

const NON_SPECIFIC = new Set(["", "0.0.0.0", "::", "[::]", "localhost", "127.0.0.1", "::1", "[::1]"]);

/** Addresses to probe: both loopbacks, plus the configured host when it is specific. */
export function classifyHosts(host: string | null | undefined): string[] {
  const hosts = ["127.0.0.1", "::1"];
  const h = (host ?? "").trim();
  if (!NON_SPECIFIC.has(h)) hosts.push(h);
  return hosts;
}

export async function classifyDashboardPort(
  config: ClassifyConfig,
  deps: Partial<ClassifyDeps> = {},
): Promise<PortClassification> {
  const d = { ...defaultDeps, ...deps };
  const results = await Promise.all(
    classifyHosts(config.host).map((host) =>
      d
        .probe(config.port, host, { ...CLASSIFY_PROBE_OPTS, ...(d.sleep ? { _sleep: d.sleep } : {}) })
        .catch((): DashboardStatus => ({ running: false, timedOut: true })),
    ),
  );

  const meta = safe(() => d.readLockMeta());

  const answers = results.filter((r) => r.running);
  if (answers.length > 0) {
    const localInstanceId = safe(() => d.peekInstanceId(config.piPort));
    const owned = answers.find((r) => isOwnedHealth(r, { meta, localInstanceId, port: config.port }));
    if (owned && typeof owned.pid === "number") return { kind: "owned", pid: owned.pid, version: owned.version };
    return { kind: "unowned-dashboard", pid: answers[0].pid };
  }

  if (results.some((r) => r.portConflict)) return { kind: "conflict" };

  const lockPid = lockOwnedPid(meta, config.port);
  const lockPidAlive = lockPid !== null && d.isProcessAlive(lockPid);

  if (results.some((r) => r.timedOut)) {
    return { kind: "unresponsive", pid: lockPidAlive ? (lockPid as number) : undefined };
  }

  // Every address refused. A live lock holder for this port that recorded
  // itself moments ago has not bound yet.
  if (meta && lockPidAlive && d.now() - meta.startedAt < HOLDER_START_GRACE_MS) {
    return { kind: "starting", pid: lockPid as number };
  }
  return { kind: "free" };
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
