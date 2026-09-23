/**
 * The four access planes this change registers (design D5; tasks 5.2-5.4).
 *
 * Exactly the planes `add-access-grants-and-review` made grantable, each
 * delegating `grant` to THAT change's store, so there is nothing new to revoke
 * and nothing new to migrate:
 *
 *   filesystem  held      path-grant store       denied subject or an offered rung
 *   cwd         held      pinned directories     exactly the named directory
 *   network     deferred  config.trustedNetworks the source address, verbatim
 *   cors        deferred  cors.allowedOrigins    the origin, verbatim, no wildcard
 *
 * Store writers are injected so the planes are testable without a real config
 * file, and so the network and CORS planes write through the SAME
 * `writeConfigPartial` the Access surface's revoke routes use.
 *
 * See change: add-access-grant-dialog.
 */
import { isIP } from "node:net";
import path from "node:path";
import type {
  DeferredGrantPromptCopy,
  HeldGrantPromptCopy,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { normalizeGrantSubject } from "./access-grants.js";
import type { DeferredAccessPlane, HeldAccessPlane } from "./access-plane.js";
import { isUngrantableSubject } from "./forbidden-subjects.js";
import { grantNamedPathSubject } from "./named-grant.js";

/** Store writers the planes delegate to. */
export interface PlaneDeps {
  pinDirectory(dir: string): void;
  readTrustedNetworks(): string[];
  /** The RAW `cors` object: rebuilding it from the typed view drops unmodelled keys. */
  readRawCors(): Record<string, unknown>;
  writeConfigPartial(partial: Record<string, unknown>): { success: boolean; error?: string };
}

const HELD_VERDICTS = ["allow-once", "allow-always", "deny"] as const;
const DEFERRED_VERDICTS = ["allow-always", "deny"] as const;

const heldCopy = (store: string, ancestors: readonly string[]): HeldGrantPromptCopy => ({
  mode: "held",
  verdicts: HELD_VERDICTS,
  store,
  // No ladder control at all when the denial offered none (task 7.5).
  ...(ancestors.length > 0 ? { ladder: ancestors.map((subject) => ({ subject })) } : {}),
});

const deferredCopy = (store: string): DeferredGrantPromptCopy => ({
  mode: "deferred",
  verdicts: DEFERRED_VERDICTS,
  store,
});

const identity = (s: string): string => s;

/** Filesystem: the path-grant store, via the ONE named-subject helper. */
export function createFilesystemPlane(): HeldAccessPlane {
  const store = "access-grants.json";
  return {
    id: "filesystem",
    mode: "held",
    yoloEligible: true,
    store,
    // The store's own canonical form, so a verdict and the grant it produces
    // name the byte-identical subject.
    subjectOf: (raw) => (raw ? normalizeGrantSubject(raw) : null),
    keyOf: identity,
    describe: (_subject, ancestors) => heldCopy(store, ancestors),
    async grant(req) {
      const out = grantNamedPathSubject({
        deniedSubject: req.deniedSubject,
        ancestors: req.ancestors,
        subject: req.subject,
        scope: "project",
        origin: req.origin,
        via: "prompt",
      });
      if (!out.ok) return { ok: false, reason: out.reason, error: out.reason === "write-failed" ? out.error : undefined };
      return { ok: true, store, widenedFrom: out.grant.widenedFrom };
    },
  };
}

/** Unknown working directory: the pinned-directory store, exactly the named directory. */
export function createCwdPlane(deps: Pick<PlaneDeps, "pinDirectory">): HeldAccessPlane {
  const store = "pinned-directories";
  return {
    id: "cwd",
    mode: "held",
    yoloEligible: true,
    store,
    // A forbidden directory (`/`, `$HOME`, ...) is never promptable: no dialog
    // may offer to pin it, exactly as the filesystem site never offers it.
    subjectOf: (raw) => {
      if (!raw || !path.isAbsolute(raw)) return null;
      const dir = path.resolve(raw);
      return isUngrantableSubject(dir) ? null : dir;
    },
    keyOf: identity,
    describe: () => heldCopy(store, []),
    async grant(req) {
      // No ladder on this plane: only the directory the denial named is pinnable.
      if (req.subject !== req.deniedSubject) return { ok: false, reason: "unnamed" };
      // Same forbidden rule as every other grant: pinning `/` or `$HOME` would
      // admit a session anywhere beneath it.
      if (isUngrantableSubject(req.subject)) return { ok: false, reason: "forbidden" };
      try {
        deps.pinDirectory(req.subject);
      } catch (err) {
        return { ok: false, reason: "write-failed", error: String((err as Error)?.message ?? err) };
      }
      return { ok: true, store };
    },
  };
}

/** A bare IP literal, IPv4-mapped IPv6 collapsed to IPv4. Anything else is not promptable. */
function normalizeSource(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  const candidate = v4mapped ? v4mapped[1] : s;
  return isIP(candidate) === 0 ? null : candidate;
}

/** Network: `config.trustedNetworks`, the exact source address and nothing wider. */
export function createNetworkPlane(
  deps: Pick<PlaneDeps, "readTrustedNetworks" | "writeConfigPartial">,
): DeferredAccessPlane {
  const store = "config.trustedNetworks";
  return {
    id: "network",
    mode: "deferred",
    store,
    subjectOf: (raw) => (raw ? normalizeSource(raw) : null),
    keyOf: identity,
    describe: () => deferredCopy(store),
    async grant(req) {
      if (req.subject !== req.deniedSubject) return { ok: false, reason: "unnamed" };
      if (normalizeSource(req.subject) !== req.subject) return { ok: false, reason: "invalid-subject" };
      const current = deps.readTrustedNetworks();
      if (current.includes(req.subject)) return { ok: true, store };
      const result = deps.writeConfigPartial({ trustedNetworks: [...current, req.subject] });
      return result.success ? { ok: true, store } : { ok: false, reason: "write-failed", error: result.error };
    },
  };
}

/**
 * A browser origin in canonical form: http(s), no credentials, no path, query or
 * fragment, no wildcard. `null` for anything else, including the opaque `null`.
 */
function normalizeOrigin(raw: string): string | null {
  if (!raw || raw === "null" || raw.includes("*") || raw !== raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  return u.origin;
}

/** CORS: `cors.allowedOrigins`, the admitted origin verbatim, never a derived wildcard. */
export function createCorsPlane(deps: Pick<PlaneDeps, "readRawCors" | "writeConfigPartial">): DeferredAccessPlane {
  const store = "cors.allowedOrigins";
  return {
    id: "cors",
    mode: "deferred",
    store,
    subjectOf: (raw) => normalizeOrigin(raw),
    keyOf: identity,
    describe: () => deferredCopy(store),
    async grant(req) {
      if (req.subject !== req.deniedSubject) return { ok: false, reason: "unnamed" };
      if (normalizeOrigin(req.subject) !== req.subject) return { ok: false, reason: "invalid-subject" };
      const rawCors = deps.readRawCors();
      const origins = Array.isArray(rawCors.allowedOrigins) ? (rawCors.allowedOrigins as unknown[]) : [];
      if (origins.includes(req.subject)) return { ok: true, store };
      const result = deps.writeConfigPartial({ cors: { ...rawCors, allowedOrigins: [...origins, req.subject] } });
      return result.success ? { ok: true, store } : { ok: false, reason: "write-failed", error: result.error };
    },
  };
}
