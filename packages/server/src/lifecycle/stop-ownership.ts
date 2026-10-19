/**
 * Ownership evidence for `pi-dashboard stop`'s port sweep: which listener pids
 * does the CURRENT HOME provably own? Read-only — never creates identity, lock
 * or PID state. Every failure means "not owned".
 * See change: fix-cli-stop-foreign-home-kill.
 */
import { getLockPath, getMetaPath, type LockMetadata, readMetadata } from "./home-lock.js";
import { peekInstanceId } from "./instance-id.js";

const HEALTH_PROBE_TIMEOUT_MS = 2000;

interface HealthReply {
  ok: boolean;
  json: () => Promise<unknown>;
}

export interface OwnershipDeps {
  readLockMeta: () => LockMetadata | null;
  peekInstanceId: (piPort: number) => string | null;
  fetchHealth: (url: string) => Promise<HealthReply>;
}

export interface OwnershipConfig {
  port: number;
  piPort: number;
  host?: string | null;
}

export interface Holder {
  pid: number;
  ports: number[];
}

const LOOPBACK_HOSTS = new Set(["", "0.0.0.0", "::", "[::]", "localhost", "127.0.0.1"]);

/** Host the health probe dials: loopback for wildcard/loopback binds, else as configured. */
export function healthHost(host: string | null | undefined): string {
  const h = (host ?? "").trim();
  if (LOOPBACK_HOSTS.has(h)) return "127.0.0.1";
  // A raw IPv6 literal (e.g. ::1) must be bracketed to form a valid URL host.
  return h.includes(":") && !h.startsWith("[") ? `[${h}]` : h;
}

const defaultDeps: OwnershipDeps = {
  readLockMeta: () => readMetadata(getMetaPath(getLockPath())),
  peekInstanceId: (piPort) => peekInstanceId(undefined, piPort),
  fetchHealth: (url) => fetch(url, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) }),
};

/** Raw `/api/health` fields the stop path reads. */
type HealthBody = {
  pid?: unknown;
  instanceId?: unknown;
  launchSource?: unknown;
  bootParentAlive?: unknown;
  bootParentPid?: unknown;
};

/** Owner facts copied from a health reply (typed, optional). */
export interface OwnerFacts {
  launchSource?: string;
  bootParentAlive?: boolean;
  bootParentPid?: number;
}

async function probeHealth(
  url: string,
  fetchHealth: OwnershipDeps["fetchHealth"],
): Promise<HealthBody | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), HEALTH_PROBE_TIMEOUT_MS);
    });
    const attempt = (async () => {
      const res = await fetchHealth(url);
      if (!res.ok) return null;
      const body = await res.json();
      return body && typeof body === "object" ? (body as HealthBody) : null;
    })();
    attempt.catch(() => {}); // a late rejection after the timeout must not be unhandled
    return await Promise.race([attempt, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The lock-metadata half of ownership proof: the recorded pid, when the record
 * is for `port`. Shared by `stop` (port sweep) and the `start` / `status` port
 * classifier, so the three can never disagree about the same process.
 * See change: harden-dashboard-start-detection (D2).
 */
export function lockOwnedPid(meta: LockMetadata | null, port: number): number | null {
  return meta && Number.isInteger(meta.pid) && meta.httpPort === port ? meta.pid : null;
}

/** The instance-id half of ownership proof: the health reply carries this HOME's id. */
export function healthMatchesInstance(
  health: { pid?: unknown; instanceId?: unknown } | null,
  localInstanceId: string | null,
): health is { pid: number; instanceId: string } {
  return (
    !!localInstanceId &&
    !!health &&
    health.instanceId === localInstanceId &&
    typeof health.pid === "number" &&
    Number.isInteger(health.pid)
  );
}

/**
 * Does the current HOME provably own the dashboard that just answered with
 * `health`? Owned iff the health reply carries this HOME's instance id, OR the
 * lock metadata records the replying pid for this port. `server.pid` is never
 * proof (PIDs are reused across HOMEs). Pure.
 */
export function isOwnedHealth(
  health: { pid?: unknown; instanceId?: unknown },
  evidence: { meta: LockMetadata | null; localInstanceId: string | null; port: number },
): boolean {
  if (healthMatchesInstance(health, evidence.localInstanceId)) return true;
  const lockPid = lockOwnedPid(evidence.meta, evidence.port);
  return lockPid !== null && health.pid === lockPid;
}

/**
 * What the current HOME can prove it owns, plus the one pid whose ownership
 * rests on a health reply (instance-id match) with that reply's owner facts.
 * `healthProven` is null whenever no health proof exists (no local instance
 * id, unreachable, or lock-metadata-only ownership). The probe runs only when a
 * local instance id exists, so there is no added latency otherwise.
 * See change: fix-cli-control-electron-server (design D3).
 */
export interface Ownership {
  owned: Set<number>;
  healthProven: { pid: number; health: OwnerFacts } | null;
}

function ownerFacts(body: HealthBody): OwnerFacts {
  return {
    ...(typeof body.launchSource === "string" ? { launchSource: body.launchSource } : {}),
    ...(typeof body.bootParentAlive === "boolean" ? { bootParentAlive: body.bootParentAlive } : {}),
    ...(typeof body.bootParentPid === "number" ? { bootParentPid: body.bootParentPid } : {}),
  };
}

/** Owned pids (lock metadata + instance-id match) and the health-proven pid. Empty when `config.port <= 0`. */
export async function collectOwnership(
  config: OwnershipConfig,
  deps: Partial<OwnershipDeps> = {},
): Promise<Ownership> {
  const d = { ...defaultDeps, ...deps };
  const owned = new Set<number>();
  let healthProven: Ownership["healthProven"] = null;
  if (!(config.port > 0)) return { owned, healthProven };

  try {
    const lockPid = lockOwnedPid(d.readLockMeta(), config.port);
    if (lockPid !== null) owned.add(lockPid);
  } catch {
    /* unreadable sidecar → no proof */
  }

  try {
    const localId = d.peekInstanceId(config.piPort);
    if (localId) {
      const health = await probeHealth(
        `http://${healthHost(config.host)}:${config.port}/api/health`,
        d.fetchHealth,
      );
      if (healthMatchesInstance(health, localId)) {
        owned.add(health.pid);
        healthProven = { pid: health.pid, health: ownerFacts(health) };
      }
    }
  } catch {
    /* no proof */
  }
  return { owned, healthProven };
}

/** Pids the current HOME can prove it owns. Empty when `config.port <= 0`. */
export async function collectOwnedPids(
  config: OwnershipConfig,
  deps: Partial<OwnershipDeps> = {},
): Promise<Set<number>> {
  return (await collectOwnership(config, deps)).owned;
}

/** Split holders (pid → ports) into owned vs foreign. Pure. */
export function partitionHolders(
  holders: Map<number, number[]>,
  owned: Set<number>,
): { owned: Holder[]; foreign: Holder[] } {
  const out = { owned: [] as Holder[], foreign: [] as Holder[] };
  for (const [pid, ports] of holders) (owned.has(pid) ? out.owned : out.foreign).push({ pid, ports });
  return out;
}
