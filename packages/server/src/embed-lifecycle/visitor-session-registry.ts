/**
 * Idempotent, server-owned session acquire keyed by a visitor identity (D5, D6).
 *
 * `acquire(req)` runs the ladder: (a) reuse an existing live session for the
 * key; (b) resume the key's most recent resumable ended session; (c) validate
 * the cwd allowlist and spawn exactly one. Concurrent acquires for one key
 * COALESCE onto a single in-flight promise that resolves only when the
 * spawned/resumed session's `session_register` arrives (via `resolveByCwd`) —
 * closing the spawn→register window so a second acquire never starts a second
 * `pi` (E8, E9). The registry OWNS `identityKey → current live sessionId` and
 * re-points it across resume's fresh-sessionId renumber (E10); browser
 * `localStorage` is a stale-tolerant hint only (E7).
 *
 * The in-flight promise carries a bounded register timeout: a spawn that never
 * registers rejects the coalesced result and clears the entry so waiters never
 * hang (X2).
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import type { EmbedLifecycleConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { composeIdentityKey, type IdentityKeyParts } from "./identity-key.js";

export interface AcquireRequest extends IdentityKeyParts {}

export type AcquireReason = "live" | "resumed" | "spawned";

export interface AcquireResult {
  sessionId: string;
  reason: AcquireReason;
}

export interface RegistryDeps {
  config: () => EmbedLifecycleConfig;
  /** Canonicalize a cwd (realpath + case-normalize) — shared with the wiring. */
  canonicalizeCwd: (cwd: string) => string;
  /** Validate the requested cwd against the server-side allowlist (D11). */
  isCwdAllowed: (cwd: string) => boolean;
  /** Is this sessionId a currently live session? */
  isSessionLive: (sessionId: string) => boolean;
  /** Is this sessionId an ended-but-resumable session (policy permitting)? */
  isSessionResumable: (sessionId: string) => boolean;
  /** Fire a spawn for the request; `resolveByCwd` completes it on register. */
  spawn: (req: AcquireRequest, key: string) => void;
  /** Fire a resume of `sessionId`; `resolveByCwd` completes it on register. */
  resume: (sessionId: string, req: AcquireRequest, key: string) => void;
  /**
   * Caps admission gate (Section 5). Resolves when a slot is available
   * (possibly after reclaiming an idle session); throws `CapacityError` when
   * every candidate is busy. Default: no-op (caps disabled).
   */
  admit?: (key: string) => Promise<void>;
  /** Reuse observability: hit (reused live) vs miss (spawn/resume). */
  onReuse?: (hit: boolean) => void;
  now?: () => number;
}

interface InFlight {
  key: string;
  canonicalCwd: string;
  promise: Promise<AcquireResult>;
  resolve: (r: AcquireResult) => void;
  reject: (e: Error) => void;
  /** Set once the caps gate resolves + the spawn/resume fires (register-window). */
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface VisitorSessionRegistry {
  acquire: (req: AcquireRequest) => Promise<AcquireResult>;
  /** Wiring hook: a session registered in `canonicalCwd` with `sessionId`. */
  resolveByCwd: (canonicalCwd: string, sessionId: string) => void;
  /** Current live sessionId the registry maps a key to, if any. */
  mappedSessionId: (key: string) => string | undefined;
}

export function createVisitorSessionRegistry(deps: RegistryDeps): VisitorSessionRegistry {
  const keyToSessionId = new Map<string, string>();
  const inFlight = new Map<string, InFlight>();
  const admit = deps.admit ?? (async () => {});

  function keyFor(req: AcquireRequest): string {
    return composeIdentityKey(req.visitorId, deps.canonicalizeCwd(req.cwd), req.agentIdentity);
  }

  function beginInFlight(
    key: string,
    canonicalCwd: string,
    reason: Exclude<AcquireReason, "live">,
    fire: () => void,
  ): Promise<AcquireResult> {
    let resolve!: (r: AcquireResult) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<AcquireResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timeoutMs = deps.config().registerTimeoutSeconds * 1000;
    const entry: InFlight = {
      key,
      canonicalCwd,
      promise: promise.then((r) => ({ ...r, reason })),
      resolve,
      reject,
      timer: undefined,
    };
    // Register the in-flight entry SYNCHRONOUSLY (before the caps-admission
    // await) so a truly-concurrent acquire coalesces onto it and the register
    // callback can find it. The caps gate + the actual spawn/resume then run
    // asynchronously; a capacity rejection clears the entry and rejects.
    inFlight.set(key, entry);
    admit(key)
      .then(() => {
        // Start the register-timeout clock only once the spawn/resume actually
        // FIRES — the caps-admission gate may await a ~2 s graceful reclaim, and
        // that must not eat into the register window (else a slow reclaim spuriously
        // times out the acquire).
        entry.timer = setTimeout(() => {
          inFlight.delete(key);
          reject(new Error(`acquire register timeout for ${key}`));
        }, timeoutMs);
        entry.timer.unref?.();
        fire();
      })
      .catch((e: Error) => {
        if (entry.timer) clearTimeout(entry.timer);
        inFlight.delete(key);
        reject(e);
      });
    return entry.promise;
  }

  function acquire(req: AcquireRequest): Promise<AcquireResult> {
    const key = keyFor(req);

    // (0) Coalesce onto an in-flight spawn/resume for the same key (E8, E9).
    const pending = inFlight.get(key);
    if (pending) return pending.promise;

    // (a) Reuse an existing live session (E6, E7, E11).
    const mapped = keyToSessionId.get(key);
    if (mapped && deps.isSessionLive(mapped)) {
      deps.onReuse?.(true);
      return Promise.resolve({ sessionId: mapped, reason: "live" });
    }

    deps.onReuse?.(false);
    const canonicalCwd = deps.canonicalizeCwd(req.cwd);

    // (b) Resume the key's most recent resumable ended session (E10, E13).
    if (mapped && deps.isSessionResumable(mapped)) {
      return beginInFlight(key, canonicalCwd, "resumed", () => deps.resume(mapped, req, key));
    }

    // (c) Spawn exactly one — after the allowlist check (X1).
    if (!deps.isCwdAllowed(req.cwd)) {
      return Promise.reject(new Error(`cwd not allowed: ${req.cwd}`));
    }
    return beginInFlight(key, canonicalCwd, "spawned", () => deps.spawn(req, key));
  }

  function resolveByCwd(canonicalCwd: string, sessionId: string): void {
    // Resolve the oldest in-flight acquire whose canonical cwd matches (Map
    // iteration is insertion order = FIFO).
    for (const entry of inFlight.values()) {
      if (entry.canonicalCwd !== canonicalCwd) continue;
      if (entry.timer) clearTimeout(entry.timer);
      inFlight.delete(entry.key);
      keyToSessionId.set(entry.key, sessionId); // own the mapping / re-point (E10)
      entry.resolve({ sessionId, reason: "spawned" });
      return;
    }
  }

  return {
    acquire,
    resolveByCwd,
    mappedSessionId: (key) => keyToSessionId.get(key),
  };
}
