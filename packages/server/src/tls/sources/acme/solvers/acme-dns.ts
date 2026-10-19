import { challengeOwner, type Dns01Solver, type SolverCheck, type SolverDeps } from "../types.js";

/**
 * acme-dns solver (CNAME delegation): the operator points `_acme-challenge.<domain>` at `fulldomain` once;
 * each order writes its TXT through `POST <server>/update` (design D2). An acme-dns subdomain holds only two
 * TXT values, so a registration runs one order at a time via a module-level FIFO lock keyed by
 * `(server, subdomain)` — it outlives solver instances (reconcile rebuilds them) and is shared by sources
 * using one registration. See change: add-acme-dns01-certs.
 */

const FETCH_TIMEOUT_MS = 30_000;
/** Fixed 43-char value (acme-dns requires exactly 43 base64url chars) used by the credential check. */
const PLACEHOLDER_TXT = "A".repeat(43);
const BUSY_MESSAGE = "acme-dns registration busy";

interface Waiter {
  grant(): void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface LockState {
  waiters: Waiter[];
}

/** Keys present = held. Waiters queue FIFO behind the holder. */
const locks = new Map<string, LockState>();

/** Test-only: drops every lock (module state outlives a test). */
export function __resetAcmeDnsLocks(): void {
  for (const state of locks.values()) for (const w of state.waiters) if (w.timer) clearTimeout(w.timer);
  locks.clear();
}

function makeHandle(key: string): { release(): void } {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const state = locks.get(key);
      if (!state) return;
      const next = state.waiters.shift();
      if (next) {
        if (next.timer) clearTimeout(next.timer);
        next.grant(); // ownership passes straight to the waiter; the key stays held
      } else {
        locks.delete(key);
      }
    },
  };
}

function tryAcquire(key: string): { release(): void } | null {
  if (locks.has(key)) return null;
  locks.set(key, { waiters: [] });
  return makeHandle(key);
}

function acquire(key: string, maxWaitMs: number): Promise<{ release(): void }> {
  const free = tryAcquire(key);
  if (free) return Promise.resolve(free);
  if (maxWaitMs <= 0) return Promise.reject(new Error(BUSY_MESSAGE));
  const state = locks.get(key) as LockState;
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      timer: undefined,
      grant: () => resolve(makeHandle(key)),
    };
    waiter.timer = setTimeout(() => {
      const i = state.waiters.indexOf(waiter);
      if (i >= 0) state.waiters.splice(i, 1);
      reject(new Error(BUSY_MESSAGE));
    }, maxWaitMs);
    state.waiters.push(waiter);
  });
}

const normHost = (s: string): string => s.trim().toLowerCase().replace(/\.$/, "");

export function createAcmeDnsSolver(config: { server: string; subdomain: string; fulldomain: string }, deps: SolverDeps): Dns01Solver {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const server = config.server.replace(/\/+$/, "");
  const lockKey = `${server}|${config.subdomain}`;

  const fail = (message: string): Error => new Error(deps.redact(message));

  async function credentials(): Promise<{ user: string; key: string } | null> {
    const [user, key] = await Promise.all([deps.readSecret("acmeDnsUser"), deps.readSecret("acmeDnsKey")]);
    return user && key ? { user, key } : null;
  }

  /** POST /update; resolves with the HTTP status (network errors throw a redacted plain Error). */
  async function update(creds: { user: string; key: string }, txt: string): Promise<number> {
    try {
      const res = await fetchImpl(`${server}/update`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-user": creds.user, "x-api-key": creds.key },
        body: JSON.stringify({ subdomain: config.subdomain, txt }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return res.status;
    } catch (err) {
      throw fail(`acme-dns POST /update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    type: "acme-dns",

    async publish(_domain, value) {
      const creds = await credentials();
      if (!creds) throw fail("acme-dns credentials are not configured");
      const status = await update(creds, value);
      if (status === 401 || status === 403) {
        deps.onCredentialFailure?.();
        throw fail(`acme-dns POST /update rejected the credentials: HTTP ${status}`);
      }
      if (status < 200 || status >= 300) throw fail(`acme-dns POST /update failed: HTTP ${status}`);
      return { ref: config.subdomain };
    },

    async cleanup() {
      // acme-dns keeps two rolling values; nothing to delete.
    },

    async check(domain): Promise<SolverCheck> {
      const owner = challengeOwner(domain);
      const want = normHost(config.fulldomain);
      const { perServer } = await deps.dns.resolveCnameAtAuthoritative(owner);
      const answered = perServer.filter((s) => s.error === undefined);
      if (answered.length > 0 && answered.every((s) => s.target !== null && normHost(s.target) === want)) return { ok: true };
      return { ok: false, gate: "dns-cname", hint: `${owner} CNAME ${config.fulldomain}` };
    },

    async checkCredentials() {
      const creds = await credentials();
      if (!creds) return { ok: false, gate: "credentials", hint: "acme-dns credentials are not saved" };
      const lock = tryAcquire(lockKey);
      if (!lock) return { ok: true, skipped: true }; // an order is running: keep the last result
      try {
        const status = await update(creds, PLACEHOLDER_TXT);
        if (status === 401 || status === 403) return { ok: false, gate: "credentials", hint: `acme-dns rejected the credentials (HTTP ${status})` };
        if (status < 200 || status >= 300) throw fail(`acme-dns POST /update failed: HTTP ${status}`);
        return { ok: true };
      } finally {
        lock.release();
      }
    },

    acquireOrderLock({ maxWaitMs }) {
      return acquire(lockKey, maxWaitMs);
    },
  };
}
