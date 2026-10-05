/**
 * Ownership evidence for `pi-dashboard stop`'s port sweep: which listener pids
 * does the CURRENT HOME provably own? Read-only — never creates identity, lock
 * or PID state. Every failure means "not owned".
 * See change: fix-cli-stop-foreign-home-kill.
 */
import { readMetadata, getMetaPath, getLockPath, type LockMetadata } from "./home-lock.js";
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
  return LOOPBACK_HOSTS.has(h) ? "127.0.0.1" : h;
}

const defaultDeps: OwnershipDeps = {
  readLockMeta: () => readMetadata(getMetaPath(getLockPath())),
  peekInstanceId: (piPort) => peekInstanceId(undefined, piPort),
  fetchHealth: (url) => fetch(url, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) }),
};

async function probeHealth(
  url: string,
  fetchHealth: OwnershipDeps["fetchHealth"],
): Promise<{ pid?: unknown; instanceId?: unknown } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), HEALTH_PROBE_TIMEOUT_MS);
    });
    const attempt = (async () => {
      const res = await fetchHealth(url);
      if (!res.ok) return null;
      const body = await res.json();
      return body && typeof body === "object" ? (body as { pid?: unknown; instanceId?: unknown }) : null;
    })();
    attempt.catch(() => {}); // a late rejection after the timeout must not be unhandled
    return await Promise.race([attempt, timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pids the current HOME can prove it owns. Empty when `config.port <= 0`. */
export async function collectOwnedPids(
  config: OwnershipConfig,
  deps: Partial<OwnershipDeps> = {},
): Promise<Set<number>> {
  const d = { ...defaultDeps, ...deps };
  const owned = new Set<number>();
  if (!(config.port > 0)) return owned;

  try {
    const meta = d.readLockMeta();
    if (meta && Number.isInteger(meta.pid) && meta.httpPort === config.port) owned.add(meta.pid);
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
      if (health && health.instanceId === localId && typeof health.pid === "number" && Number.isInteger(health.pid)) {
        owned.add(health.pid);
      }
    }
  } catch {
    /* no proof */
  }
  return owned;
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
