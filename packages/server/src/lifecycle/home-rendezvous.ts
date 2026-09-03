/**
 * Establish this process's place in the per-HOME rendezvous, and keep it.
 *
 * `home-lock.ts` had no production caller: a running dashboard left no
 * `server.lock` and no record on disk, so the file a bridge is supposed to
 * resolve its dashboard through simply never existed (task 2.0a). This module
 * is that caller, and it also carries the two behaviours the lock module
 * deliberately does not:
 *
 *   - **attach semantics (2.0c).** `acquireOrAttach` returns metadata
 *     describing the *holder*; translating that into "I serve only pinned
 *     bridges and I do not write the record" is a server decision, so it is
 *     made here, explicitly, rather than inferred at each call site.
 *   - **promotion (2.0j).** `acquireOrAttach` is one-shot with no polling
 *     anywhere. Without a re-check, a crashed owner (which never runs its
 *     release) leaves unpinned bridges dialling a dead socket forever, and a
 *     clean shutdown leaves the HOME with no default even while a healthy
 *     attach instance is running. Promotion is the same compare-and-swap
 *     takeover, so a race between two attach instances still yields exactly
 *     one owner (2.0j-i).
 *
 * See change: add-pi-gateway-transport-identity (D16, defect B2).
 */

import {
  type AcquireHooks,
  acquireOrAttach,
  isLockDisabled,
  type LockMetadata,
} from "./home-lock.js";
import { installReleaseHandlers } from "./home-lock-release.js";

/** Default gap between attach-mode liveness re-checks. */
const DEFAULT_PROMOTION_INTERVAL_MS = 15_000;

export interface EstablishRendezvousConfig {
  httpPort: number;
  piPort: number;
  version: string;
  /** This instance's rendezvous id (see `instance-id.ts`). */
  identity: string;
  hooks?: AcquireHooks;
  /** Test seam: skip signal-handler installation. Default `true`. */
  installHandlers?: boolean;
  /** `0` disables the periodic re-check; `checkNow()` still works. */
  promotionIntervalMs?: number;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

export interface HomeRendezvous {
  /** `disabled` when the user opted out via `PI_DASHBOARD_ALLOW_MULTIPLE`. */
  readonly mode: "acquired" | "attach" | "disabled";
  /** This instance's rendezvous id. */
  readonly identity: string;
  /** The record's holder — us when `acquired`, the owner when `attach`. */
  readonly meta: LockMetadata | null;
  /**
   * Re-check the owner and promote if it is gone. Called periodically while in
   * attach mode, and on demand when a bridge reports the recorded endpoint
   * unreachable. No-op once we own the record.
   */
  checkNow(): Promise<void>;
  /** Release the record if we hold it, and stop the re-check timer. */
  stop(): Promise<void>;
  /** Present only while `mode === "acquired"`. */
  release?: () => Promise<void>;
}

export async function establishHomeRendezvous(
  config: EstablishRendezvousConfig,
): Promise<HomeRendezvous> {
  const log = config.log ?? ((m: string) => console.log(m));
  const intervalMs = config.promotionIntervalMs ?? DEFAULT_PROMOTION_INTERVAL_MS;

  if (isLockDisabled(config.env ?? process.env)) {
    log("[home-lock] PI_DASHBOARD_ALLOW_MULTIPLE is set — not claiming this HOME's rendezvous.");
    return {
      mode: "disabled",
      identity: config.identity,
      meta: null,
      checkNow: async () => {},
      stop: async () => {},
    };
  }

  const acquireConfig = {
    httpPort: config.httpPort,
    piPort: config.piPort,
    version: config.version,
    identity: config.identity,
    hooks: config.hooks,
  };

  let mode: "acquired" | "attach" = "attach";
  let meta: LockMetadata | null = null;
  let release: (() => Promise<void>) | undefined;
  let uninstall: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let checking = false;

  const adopt = (result: Awaited<ReturnType<typeof acquireOrAttach>>) => {
    mode = result.mode;
    meta = result.meta;
    if (result.mode !== "acquired") return;
    release = result.release;
    if (config.installHandlers !== false) {
      uninstall = installReleaseHandlers(result.release, { log });
    }
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  adopt(await acquireOrAttach(acquireConfig));

  const checkNow = async () => {
    if (mode === "acquired" || checking) return;
    checking = true;
    try {
      // Re-running the full decision is deliberate: it re-reads the record,
      // re-probes the owner, and \u2014 if the owner is gone \u2014 takes it over through
      // the same acquire-then-verify path, so two attach instances racing here
      // cannot both win (2.0h/2.0j-i).
      const result = await acquireOrAttach(acquireConfig);
      const promoted = result.mode === "acquired";
      adopt(result);
      if (promoted) {
        log(`[home-lock] promoted to rendezvous owner for this HOME (${config.identity}).`);
      }
    } catch (err) {
      // A mismatch means somebody else holds the HOME on our port; staying in
      // attach mode is the conservative answer, not crashing a running server.
      log(`[home-lock] promotion re-check failed: ${(err as Error).message ?? err}`);
    } finally {
      checking = false;
    }
  };

  if (mode === "attach" && intervalMs > 0) {
    timer = setInterval(() => void checkNow(), intervalMs);
    timer.unref?.();
  }

  return {
    get mode() {
      return mode;
    },
    identity: config.identity,
    get meta() {
      return meta;
    },
    get release() {
      return release;
    },
    checkNow,
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      uninstall?.();
      uninstall = undefined;
      await release?.();
      release = undefined;
    },
  };
}
