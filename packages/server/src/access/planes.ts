/**
 * The access planes (design D5; tasks 5.2-5.4; plus `preview-egress`, see the end of the file).
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
import dns from "node:dns";
import { isIP } from "node:net";
import path from "node:path";
import type {
  DeferredGrantPromptCopy,
  HeldGrantPromptCopy,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  canonicalHttpsOrigin,
  isUngrantableEgressOrigin,
} from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import { normalizeGrantSubject } from "./access-grants.js";
import type { DeferredAccessPlane, HeldAccessPlane } from "./access-plane.js";
import { isUngrantableSubject } from "./forbidden-subjects.js";
import { grantNamedPathSubject } from "./named-grant.js";
import { addPreviewEgressGrant } from "./preview-egress-store.js";

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
    // name the byte-identical subject. An ungrantable subject is never
    // promptable: the resume path would refuse any allow (mirrors the cwd plane;
    // see change: surface-denial-remedy-in-previews, design D7).
    subjectOf: (raw) => {
      if (!raw) return null;
      const normalized = normalizeGrantSubject(raw);
      return isUngrantableSubject(normalized) ? null : normalized;
    },
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
  deps: Pick<PlaneDeps, "readTrustedNetworks" | "writeConfigPartial"> & {
    /**
     * Does a network match authenticate right now (`legacy` trust mode)? Absent ⇒
     * yes. In `pair` an allow-always would add an address that grants nothing, so
     * the verdict is refused and nothing is written.
     * See change: retire-trusted-networks-bypass (D6).
     */
    networkTrustActive?: () => boolean;
  },
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
      if (deps.networkTrustActive && !deps.networkTrustActive()) return { ok: false, reason: "forbidden" };
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

/** Grant-time DNS budget (design D7). */
export const EGRESS_DNS_TIMEOUT_MS = 3000;
/** The dialog text when a name cannot be resolved in time (decision C3). */
export const EGRESS_UNVERIFIABLE_MESSAGE = "Could not verify this origin; try again";

/** Resolve a host to its addresses; throws on failure. Injectable so tests need no network. */
export type EgressResolver = (host: string) => Promise<readonly string[]>;

const defaultEgressResolver: EgressResolver = async (host) =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Does this resolved address fall in loopback / private / link-local / shared / ULA space? */
function isPrivateAddress(address: string): boolean {
  const literal = isIP(address) === 6 ? `https://[${address}]` : `https://${address}`;
  return isIP(address) === 0 || isUngrantableEgressOrigin(literal);
}

/**
 * Resolve `origin`'s host within the 3 s budget and classify. `"ok"` = every
 * address public; `"private"` = at least one is not; `"unverifiable"` = it failed,
 * timed out or resolved to nothing.
 */
async function verifyEgressHost(
  origin: string,
  resolve: EgressResolver,
  timeoutMs: number,
): Promise<"ok" | "private" | "unverifiable"> {
  const host = new URL(origin).hostname;
  // A public IP literal passed `subjectOf` (private ones are ungrantable there): nothing to resolve.
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return "ok";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      resolve(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("dns timeout")), timeoutMs);
      }),
    ]);
    if (addresses.length === 0) return "unverifiable";
    return addresses.some(isPrivateAddress) ? "private" : "ok";
  } catch {
    return "unverifiable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PreviewEgressPlaneDeps {
  /** The dashboard's own origins (tunnels, public base URLs, …): ungrantable. */
  ownOrigins?: () => readonly string[];
  resolve?: EgressResolver;
  dnsTimeoutMs?: number;
  /** Persist the grant (default: the locked `preview-egress.json` store). */
  addGrant?: (project: string, origin: string) => Promise<unknown>;
}

/**
 * Preview egress: an external https origin a restricted live preview may load, granted
 * per PROJECT. Deferred (the preview's own request is never held) and never YOLO-eligible.
 * The subject is the canonical https origin; an ungrantable one (private / loopback /
 * own / single-label / …) is not promptable. The project key rides in the request's
 * `origin` (the audit origin of the denial). `grant` re-checks ungrantability, resolves
 * the host (3 s) and refuses a private or unverifiable one before writing.
 *
 * See change: improve-canvas-html-and-url-ux (design D7).
 */
export function createPreviewEgressPlane(deps: PreviewEgressPlaneDeps = {}): DeferredAccessPlane {
  const store = "preview-egress.json";
  const own = () => deps.ownOrigins?.() ?? [];
  const resolve = deps.resolve ?? defaultEgressResolver;
  const addGrant = deps.addGrant ?? addPreviewEgressGrant;
  const subjectOf = (raw: string): string | null => {
    const canon = raw ? canonicalHttpsOrigin(raw) : null;
    return canon && !isUngrantableEgressOrigin(canon, own()) ? canon : null;
  };
  return {
    id: "preview-egress",
    mode: "deferred",
    store,
    subjectOf,
    keyOf: identity,
    describe: () => deferredCopy(store),
    async grant(req) {
      if (req.subject !== req.deniedSubject) return { ok: false, reason: "unnamed" };
      if (subjectOf(req.subject) !== req.subject) return { ok: false, reason: "forbidden" };
      if (!path.isAbsolute(req.origin)) return { ok: false, reason: "invalid-subject" };
      const verdict = await verifyEgressHost(req.subject, resolve, deps.dnsTimeoutMs ?? EGRESS_DNS_TIMEOUT_MS);
      if (verdict === "private") return { ok: false, reason: "forbidden" };
      if (verdict === "unverifiable") return { ok: false, reason: "unverifiable", error: EGRESS_UNVERIFIABLE_MESSAGE };
      try {
        await addGrant(req.origin, req.subject);
      } catch (err) {
        return { ok: false, reason: "write-failed", error: String((err as Error)?.message ?? err) };
      }
      return { ok: true, store };
    },
  };
}
