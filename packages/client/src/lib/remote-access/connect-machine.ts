/**
 * Connect to another machine — address handling, known-server add semantics and
 * the desktop knock identity decision. No React.
 *
 * Add → probe → ask (design D7): the reachability probe accepts only PERSISTED
 * known servers, so an unknown address is added first; the add itself verifies
 * and pins identity server-side. A typed address that already matches a known
 * server (same normalised host + port) is used as-is and NEVER re-posted — a
 * re-POST would overwrite that entry's label.
 *
 * See change: add-remote-access-wizard.
 */
import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "../api/api-context.js";
import { fetchJsonResponse } from "../api/fetch-json.js";

export interface Address {
  host: string;
  port: number;
}

const DEFAULT_PORT = 8000;

/** `host`, `host:port`, `http(s)://host[:port][/…]`. `null` when it is not an address. */
export function parseAddress(input: string): Address | null {
  const raw = input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!raw) return null;
  const m = /^(\[[^\]]+\]|[^:\s]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return null;
  const port = m[2] ? Number.parseInt(m[2], 10) : DEFAULT_PORT;
  if (port < 1 || port > 65535) return null;
  return { host: m[1], port };
}

/** Same normalisation the server applies: case-insensitive host, exact port. */
export const sameAddress = (a: Address, b: Address): boolean =>
  a.host.trim().toLowerCase() === b.host.trim().toLowerCase() && a.port === b.port;

/** An entry matches when the address is its primary address OR any of its routes (any scheme). */
export const findKnown = (list: readonly KnownServerListEntry[], addr: Address): KnownServerListEntry | undefined =>
  list.find((e) => sameAddress(e, addr) || (e.routes ?? []).some((r) => sameAddress(r, addr)));

export type AddOutcome =
  /**
   * Already a known server — used as-is. Nothing posted, or the add attached the typed
   * address as a NEW route of an identity that was already listed (`data.updated`):
   * either way the typed address is the target and the wizard created no entry.
   */
  | { kind: "known"; address: Address }
  /** Added by this run — offer Remove if the probe fails. */
  | { kind: "created"; address: Address }
  /** The server at the address is not the one pinned — the task stops. */
  | { kind: "identity-changed" }
  /** The address reaches this dashboard itself (a shared virtual-bridge address), not another machine. */
  | { kind: "self-address" }
  | { kind: "refused" }
  | { kind: "failed"; message: string };

/** Look the address up, else add it. Never re-posts a match. */
export async function ensureKnown(addr: Address, known: readonly KnownServerListEntry[]): Promise<AddOutcome> {
  if (findKnown(known, addr)) return { kind: "known", address: addr };
  try {
    const { res, json } = await fetchJsonResponse<{ success?: boolean; error?: string; data?: { updated?: boolean } }>(
      `${getApiBase()}/api/known-servers`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(addr) },
    );
    if (res.ok && json.success !== false) {
      // `updated`: the add attached this address to an identity already listed (no `already_known` any more).
      return json.data?.updated === true ? { kind: "known", address: addr } : { kind: "created", address: addr };
    }
    if (res.status === 401 || res.status === 403) return { kind: "refused" };
    if (json.error === "identity_changed") return { kind: "identity-changed" };
    if (json.error === "self_address") return { kind: "self-address" };
    return { kind: "failed", message: json.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { kind: "failed", message: e instanceof Error ? e.message : "request failed" };
  }
}

export type KnockDecision =
  /** Every fingerprint present equals the proven one → knock. */
  | { kind: "knock"; fingerprint: string }
  /** A pinned or advertised fingerprint differs from the proven one → never knock. */
  | { kind: "mismatch"; against: "pin" | "advert"; expected: string; proven: string }
  /** Nothing to compare against → show the proven fingerprint, knock only after the operator confirms. */
  | { kind: "confirm"; fingerprint: string };

/**
 * The desktop app proves the server's identity first. It knocks only when the
 * proven fingerprint equals the entry's pin AND the advertised one, where
 * present; with neither, the operator must confirm the proven fingerprint.
 */
export function knockDecision(opts: { pin?: string; advert?: string; proven: string }): KnockDecision {
  const { pin, advert, proven } = opts;
  if (pin && pin !== proven) return { kind: "mismatch", against: "pin", expected: pin, proven };
  if (advert && advert !== proven) return { kind: "mismatch", against: "advert", expected: advert, proven };
  return pin || advert ? { kind: "knock", fingerprint: proven } : { kind: "confirm", fingerprint: proven };
}

/** Where the remote's own request-access page lives. `http:` — LAN servers have no TLS; 443 is https. */
export function remoteOrigin(addr: Address): string {
  const host = addr.host.includes(":") && !addr.host.startsWith("[") ? `[${addr.host}]` : addr.host;
  return addr.port === 443 ? `https://${host}` : `http://${host}:${addr.port}`;
}

export const remoteRequestUrl = (addr: Address): string => `${remoteOrigin(addr)}/pair?request`;
