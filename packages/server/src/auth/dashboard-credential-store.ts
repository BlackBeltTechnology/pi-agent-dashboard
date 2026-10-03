/**
 * The credential store the server's single pi `ModelRuntime` writes through.
 *
 * Implements pi-ai's `CredentialStore` contract (`read` / `list` / `modify` /
 * `delete`) over the dashboard's hardened `auth.json` primitives, so every
 * write the runtime triggers keeps the dashboard's guarantees: atomic replace,
 * corrupt-file quarantine and no-clobber, no credential material in errors.
 *
 * `modify` deliberately differs from pi's own file store, which holds the
 * file lock across the OAuth network call:
 *   1. per-provider in-process mutex (shared with `delete`), every waiter
 *      honouring its own signal;
 *   2. locked snapshot of the credential, file lock released before `fn`;
 *   3. `fn` (pi's refresh callback) runs with NO file lock held;
 *   4. compare-and-swap persist against the snapshot (`writeRefreshedOAuth`).
 * A rejected `fn` takes one more locked read: a different, fresh credential
 * another writer stored meanwhile is returned instead of the error.
 *
 * A credential this store persisted < 30 s ago is returned as-is, so one
 * request's two auth resolutions never refresh a short-lived token twice.
 *
 * Refresh-only: the server never calls `runtime.login()`, so every `modify`
 * the runtime issues is an OAuth refresh. A non-refresh write (no stored OAuth
 * credential, or a non-OAuth result) is refused, never persisted.
 *
 * See change: collapse-model-proxy-onto-modelruntime (D1).
 */
import { isDeepStrictEqual } from "node:util";
import {
  type AuthCredential,
  type AuthData,
  AuthJsonCorruptError,
  type OAuthCredential,
  readAuthJsonLocked,
  readStoredCredentialLocked,
  removeCredential,
  tryReadAuthJson,
  writeRefreshedOAuth,
} from "./provider-auth-storage.js";

/** pi-ai's `AuthOperationOptions`. Structural: the server never imports pi-ai. */
export interface CredentialOperationOptions {
  signal?: AbortSignal;
}

/** pi-ai's `CredentialStore` contract (structural mirror). */
export interface RuntimeCredentialStore {
  read(providerId: string, options?: CredentialOperationOptions): Promise<AuthCredential | undefined>;
  list(options?: CredentialOperationOptions): Promise<readonly { providerId: string; type: AuthCredential["type"] }[]>;
  modify(
    providerId: string,
    fn: (current: AuthCredential | undefined) => Promise<AuthCredential | undefined>,
    options?: CredentialOperationOptions,
  ): Promise<AuthCredential | undefined>;
  delete(providerId: string, options?: CredentialOperationOptions): Promise<void>;
}

/**
 * pi's OAuth refresh window: a credential with less than five minutes left is
 * refreshed (`auth/resolve.js` `DEFAULT_OAUTH_MINIMUM_VALIDITY_MS`). ONE
 * predicate decides both "adopt what another writer stored" and "changed but
 * still expiring", so the store and pi cannot disagree.
 */
const OAUTH_REFRESH_WINDOW_MS = 5 * 60_000;

/**
 * A credential THIS store just persisted is not refreshed again within this
 * window. pi refreshes whenever < 5 min remain and accepts a refreshed token
 * that is itself inside that window, and one completion resolves auth twice
 * (facade `getAuth`, then `streamSimple`'s own) — without the debounce a
 * short-lived token would hit the refresh endpoint twice per request.
 */
const RECENT_REFRESH_MS = 30_000;

function isFreshOAuth(cred: AuthCredential | undefined): cred is OAuthCredential {
  return cred?.type === "oauth" && typeof cred.expires === "number" && cred.expires > Date.now() + OAUTH_REFRESH_WINDOW_MS;
}

/** Coordination outcome → error. Names the provider and the outcome only, never token material. */
function coordinationError(provider: string, outcome: "removed" | "replaced" | "changed" | "corrupt"): Error {
  switch (outcome) {
    case "removed":
      return new Error(`OAuth credential for "${provider}" was removed from auth.json during refresh`);
    case "replaced":
      return new Error(`OAuth credential for "${provider}" was replaced by a non-OAuth credential`);
    case "changed":
      return new Error(
        `OAuth credential for "${provider}" changed during refresh and is not valid beyond the refresh window; retry the request`,
      );
    case "corrupt":
      return new AuthJsonCorruptError(provider);
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

/** Settle with `operation`, or reject as soon as `signal` aborts. `operation` keeps running. */
function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    operation.catch(() => {});
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/** Checked (quarantining) read under the bounded refresh-path lock; tolerant `{}` on lock failure. */
async function withLockedAuthRead(signal: AbortSignal | undefined): Promise<AuthData> {
  try {
    return await readAuthJsonLocked(signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return {};
  }
}

export class DashboardCredentialStore implements RuntimeCredentialStore {
  /** Per-provider tail of the in-process mutex. Never rejects. */
  private readonly chains = new Map<string, Promise<void>>();
  /** Last credential this store persisted per provider, and when. */
  private readonly recentlyWritten = new Map<string, { credential: AuthCredential; at: number }>();

  /**
   * Serialize `task` after every earlier `modify`/`delete` of `providerId`.
   * A waiter whose signal aborts rejects immediately and its task never runs;
   * an aborted RUNNING task releases the mutex only when it settles.
   */
  private enqueue<T>(providerId: string, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    let tail: Promise<void> | undefined;
    const run = (async () => {
      try {
        await previous;
        signal?.throwIfAborted();
        return await task();
      } finally {
        if (this.chains.get(providerId) === tail) this.chains.delete(providerId);
      }
    })();
    tail = run.then(
      () => {},
      () => {},
    );
    this.chains.set(providerId, tail);
    return raceAbort(run, signal);
  }

  /**
   * Any credential type. Unlocked, non-quarantining read on the request path;
   * unparseable content (possibly a torn in-place pi write) is retried once
   * under the bounded lock, and stays tolerant (`undefined`) after that.
   */
  async read(providerId: string, options: CredentialOperationOptions = {}): Promise<AuthCredential | undefined> {
    options.signal?.throwIfAborted();
    const data = tryReadAuthJson();
    if (data) return data[providerId];
    try {
      const again = await readStoredCredentialLocked(providerId, options.signal);
      return again.outcome === "ok" ? again.credential : undefined;
    } catch (err) {
      if (options.signal?.aborted) throw err;
      return undefined;
    }
  }

  async list(options: CredentialOperationOptions = {}): Promise<readonly { providerId: string; type: AuthCredential["type"] }[]> {
    options.signal?.throwIfAborted();
    // Same torn-read discipline as `read`: never quarantine what may be a
    // half-written pi file; the locked checked read decides.
    const data = tryReadAuthJson() ?? (await withLockedAuthRead(options.signal));
    return Object.entries(data)
      .filter(([, cred]) => cred?.type === "api_key" || cred?.type === "oauth")
      .map(([providerId, cred]) => ({ providerId, type: cred.type }));
  }

  modify(
    providerId: string,
    fn: (current: AuthCredential | undefined) => Promise<AuthCredential | undefined>,
    options: CredentialOperationOptions = {},
  ): Promise<AuthCredential | undefined> {
    const { signal } = options;
    return this.enqueue(providerId, signal, async () => {
      // Freshest value obtainable without holding the lock across the network;
      // CAS validates it at persist.
      const snap = await readStoredCredentialLocked(providerId, signal);
      if (snap.outcome === "corrupt") throw coordinationError(providerId, "corrupt");
      const current = snap.outcome === "ok" ? snap.credential : undefined;
      if (current && this.justRefreshed(providerId, current)) return current;

      let next: AuthCredential | undefined;
      try {
        next = await raceAbort(fn(current), signal);
      } catch (err) {
        return this.recoverFailedRefresh(providerId, current, err, signal);
      }
      if (next === undefined) return current;
      // An abandoned refresh is authoritative: never persist what the caller discarded.
      if (signal?.aborted) throw abortReason(signal);
      return this.persistRefresh(providerId, current, next, signal);
    });
  }

  /** Refresh-only CAS persist of `next` against the snapshot `current`. */
  private async persistRefresh(
    providerId: string,
    current: AuthCredential | undefined,
    next: AuthCredential,
    signal: AbortSignal | undefined,
  ): Promise<AuthCredential> {
    if (!current) throw coordinationError(providerId, "removed");
    if (current.type !== "oauth") throw coordinationError(providerId, "replaced");
    if (next.type !== "oauth") {
      throw new Error(`Refusing to persist a non-OAuth credential for "${providerId}" through the runtime credential store`);
    }
    if (typeof next.access !== "string" || !next.access) {
      throw new Error(
        `OAuth refresh for "${providerId}" returned no access token; refusing to persist an unrefreshed credential`,
      );
    }
    // Lock exhaustion propagates: the minted credential is DISCARDED, never
    // served unpersisted.
    const result = await writeRefreshedOAuth(providerId, next, current, signal);
    switch (result.outcome) {
      case "written":
        this.recentlyWritten.set(providerId, { credential: result.credential, at: Date.now() });
        return result.credential;
      case "changed":
        if (isFreshOAuth(result.credential)) return result.credential;
        throw coordinationError(providerId, "changed");
      default:
        throw coordinationError(providerId, result.outcome);
    }
  }

  /** `current` is exactly what this store persisted for `providerId` within {@link RECENT_REFRESH_MS}. */
  private justRefreshed(providerId: string, current: AuthCredential): boolean {
    const recent = this.recentlyWritten.get(providerId);
    if (!recent) return false;
    if (Date.now() - recent.at >= RECENT_REFRESH_MS) {
      this.recentlyWritten.delete(providerId);
      return false;
    }
    return isDeepStrictEqual(current, recent.credential);
  }

  /**
   * After `fn` rejected: adopt a DIFFERENT fresh credential another writer
   * stored; surface removed/replaced/corrupt (they explain the rejection);
   * otherwise rethrow the original. Best-effort: a lock or I/O failure on the
   * re-read rethrows the original error.
   */
  private async recoverFailedRefresh(
    providerId: string,
    snapshot: AuthCredential | undefined,
    original: unknown,
    signal: AbortSignal | undefined,
  ): Promise<AuthCredential> {
    if (signal?.aborted) throw original;
    let again: Awaited<ReturnType<typeof readStoredCredentialLocked>>;
    try {
      again = await readStoredCredentialLocked(providerId, signal);
    } catch {
      throw original;
    }
    if (again.outcome === "corrupt") throw coordinationError(providerId, "corrupt");
    if (snapshot?.type !== "oauth") throw original;
    if (again.outcome === "absent") throw coordinationError(providerId, "removed");
    if (again.credential.type !== "oauth") throw coordinationError(providerId, "replaced");
    if (!isDeepStrictEqual(again.credential, snapshot) && isFreshOAuth(again.credential)) return again.credential;
    throw original;
  }

  delete(providerId: string, options: CredentialOperationOptions = {}): Promise<void> {
    const { signal } = options;
    return this.enqueue(providerId, signal, async () => {
      this.recentlyWritten.delete(providerId);
      await removeCredential(providerId, undefined, { createIfMissing: false, ...(signal ? { signal } : {}) });
    });
  }
}
