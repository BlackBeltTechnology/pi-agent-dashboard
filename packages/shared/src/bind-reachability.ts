/**
 * Bind-vs-trust reachability: can the interface the dashboard actually LISTENS
 * on serve the networks the operator has marked TRUSTED?
 *
 * Two settings on two different Settings pages govern whether a LAN device can
 * reach the dashboard — `bindHost` (Server page, restart-required) and
 * `auth.bypassHosts` / `trustedNetworks` (Security page, live). A loopback or
 * specific-NIC bind silently voids a trusted entry outside its range: the TCP
 * connection is refused before any request handler runs, so no block event is
 * ever recorded and the Trusted Networks section stays permanently blank.
 *
 * This module is the SINGLE home of that predicate and of the well-known-range
 * table, deliberately in `shared/` rather than duplicated per package (task
 * 1.4). Both the client advisory and the server's startup log / `reachability`
 * field import from here, so the two sides cannot drift — the truth table is
 * executed once, against one implementation.
 *
 * The predicate is ADVISORY. It never allows or denies a request; the runtime
 * guard (`localhost-guard.ts`) is untouched. It is also an ADDRESS test, not a
 * routing test: a trusted `10.0.0.0/8` scores reachable for a bind of
 * `10.0.0.5` even with no route to the wider network.
 *
 * See change: warn-unreachable-trusted-networks.
 */

/** A trust suggestion — an exact host / netmask-derived CIDR, or a wider range. */
export interface TrustSuggestion {
  value: string;
  label: string;
  /** True = grants unauthenticated access to a whole subnet (explicitly riskier). */
  wide: boolean;
}

// ── IPv4 primitives ──────────────────────────────────────────────────

/** Parse a dotted-quad into a uint32, or `null` when it is not a valid IPv4 literal. */
export function ipv4ToNum(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number.parseInt(p, 10);
    if (n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

/** True when `ip` is a syntactically valid IPv4 literal. */
export function isIpv4Literal(ip: string): boolean {
  return ipv4ToNum(ip) !== null;
}

/** True when `ip` is inside `127.0.0.0/8`. */
export function isLoopbackIpv4(ip: string): boolean {
  const n = ipv4ToNum(ip);
  return n !== null && n >>> 24 === 127;
}

// ── Trusted-entry model ──────────────────────────────────────────────

type EntryKind = "cidr" | "wildcard" | "exact";

function entryKind(entry: string): EntryKind {
  if (entry.includes("/")) return "cidr";
  if (entry.includes("*")) return "wildcard";
  return "exact";
}

/**
 * True when `entry` is one of the three documented Trusted Networks formats and
 * is syntactically well-formed. Malformed entries are SKIPPED by the predicate
 * — never reported as unreachable, because "unreachable" would imply the entry
 * otherwise works.
 */
export function isValidTrustEntry(entry: string): boolean {
  switch (entryKind(entry)) {
    case "cidr": {
      const [base, bitsStr, ...rest] = entry.split("/");
      if (rest.length > 0) return false;
      if (!/^\d{1,2}$/.test(bitsStr ?? "")) return false;
      const bits = Number.parseInt(bitsStr, 10);
      return bits >= 0 && bits <= 32 && isIpv4Literal(base);
    }
    case "wildcard": {
      const parts = entry.split(".");
      if (parts.length !== 4) return false;
      return parts.every((p) => p === "*" || (/^\d{1,3}$/.test(p) && Number.parseInt(p, 10) <= 255));
    }
    default:
      return isIpv4Literal(entry);
  }
}

/** True when `entry` covers `ip`. Mirrors the runtime guard's matching rules. */
export function trustEntryCovers(entry: string, ip: string): boolean {
  if (!isValidTrustEntry(entry)) return false;
  const ipNum = ipv4ToNum(ip);
  if (ipNum === null) return false;
  switch (entryKind(entry)) {
    case "cidr": {
      const [base, bitsStr] = entry.split("/");
      const bits = Number.parseInt(bitsStr, 10);
      const baseNum = ipv4ToNum(base);
      if (baseNum === null) return false;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (ipNum & mask) === (baseNum & mask);
    }
    case "wildcard": {
      const pattern = new RegExp(`^${entry.replace(/\./g, "\\.").replace(/\*/g, "\\d+")}$`);
      return pattern.test(ip);
    }
    default:
      return ipv4ToNum(entry) === ipNum;
  }
}

/**
 * True when EVERY address `entry` covers lies inside `127.0.0.0/8`.
 *
 * Such an entry is always reachable: a loopback peer is exempted by the guard
 * before trust is consulted, and no bind host can make loopback unreachable to
 * itself. Note `127.0.0.0/7` is NOT loopback-only — it also covers `126.x`.
 */
export function isLoopbackOnlyEntry(entry: string): boolean {
  if (!isValidTrustEntry(entry)) return false;
  switch (entryKind(entry)) {
    case "cidr": {
      const [base, bitsStr] = entry.split("/");
      const bits = Number.parseInt(bitsStr, 10);
      return bits >= 8 && isLoopbackIpv4(base);
    }
    case "wildcard":
      return entry.split(".")[0] === "127";
    default:
      return isLoopbackIpv4(entry);
  }
}

// ── The predicate ────────────────────────────────────────────────────

/**
 * The trusted entries the resolved bind host CANNOT serve.
 *
 * Evaluated in the documented order, per entry:
 *   1. loopback-only entry            → reachable (guard exempts loopback anyway)
 *   2. bind host is not an IPv4 literal (`::`, a hostname) → FAIL OPEN, reachable
 *   3. bind host is `0.0.0.0`         → reachable (every interface is listening)
 *   4. malformed entry                → skipped (never reported)
 *   5. bind host is loopback          → unreachable (only loopback peers connect)
 *   6. otherwise                      → reachable iff the entry covers the bind host
 *
 * Returns the offending ENTRIES, not a boolean, so the advisory and the log
 * line can name them. Order and duplicates of the input are preserved apart
 * from de-duplication across the two config sources.
 */
export function unreachableTrustedEntries(
  bindHost: string | null | undefined,
  entries: readonly string[] | null | undefined,
): string[] {
  const list = entries ?? [];
  const host = (bindHost ?? "").trim();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const entry = typeof raw === "string" ? raw.trim() : "";
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    if (isLoopbackOnlyEntry(entry)) continue;          // 1
    if (!isIpv4Literal(host)) continue;                 // 2 — fail open
    if (host === "0.0.0.0") continue;                   // 3
    if (!isValidTrustEntry(entry)) continue;            // 4
    if (isLoopbackIpv4(host)) { out.push(entry); continue; } // 5
    if (!trustEntryCovers(entry, host)) out.push(entry);     // 6
  }
  return out;
}

/** The config slice the predicate reads its trusted entries from. */
export interface TrustedEntriesConfigShape {
  trustedNetworks?: string[] | null;
  auth?: { bypassHosts?: string[] | null } | null;
}

/**
 * The union of `auth.bypassHosts` and the legacy top-level `trustedNetworks`,
 * mirroring `hasGuardConfig()` and `resolvedTrustedNetworks` — both sources are
 * honoured by the runtime guard, so both must be scored.
 */
export function collectTrustedEntries(config: TrustedEntriesConfigShape | null | undefined): string[] {
  return [...(config?.trustedNetworks ?? []), ...(config?.auth?.bypassHosts ?? [])];
}

// ── Bind-host resolution ─────────────────────────────────────────────

/** The shipped default when nothing else supplies a bind host. */
export const DEFAULT_BIND_HOST = "127.0.0.1";

/**
 * The bind host a start would resolve to, following the same chain as
 * `buildConfig()`: `--host` → `PI_DASHBOARD_HOST` → `config.bindHost` →
 * `127.0.0.1`. Evaluated against the CURRENT config it yields `pendingBindHost`
 * — what the NEXT restart will bind; evaluated at boot and frozen it yields
 * `resolvedBindHost` — what this process actually bound.
 */
export function resolveBindHost(opts: {
  hostFlag?: string | null;
  envHost?: string | null;
  configBindHost?: string | null;
}): string {
  return opts.hostFlag || opts.envHost || opts.configBindHost || DEFAULT_BIND_HOST;
}

/**
 * The bind host the advisory must score against: an UNSAVED listen-interface
 * edit wins over the server's `pendingBindHost`, because that draft is what the
 * next restart applies and the user is reasoning about it right now.
 */
export function pendingEffectiveHost(opts: {
  draftBindHost?: string | null;
  pendingBindHost?: string | null;
  resolvedBindHost?: string | null;
}): string {
  return opts.draftBindHost || opts.pendingBindHost || opts.resolvedBindHost || DEFAULT_BIND_HOST;
}

/** The `reachability` object published on the guarded `GET /api/config` surface. */
export interface BindReachability {
  /** What THIS process bound, frozen at boot. */
  resolvedBindHost: string;
  /** What the next restart would bind, re-resolved against the current config. */
  pendingBindHost: string;
  /** Trusted entries `pendingBindHost` cannot serve. */
  unreachable: string[];
}

// ── Well-known ranges (shared by the dropdown AND the block-event banner) ──

interface WellKnownRange {
  /** True when this range contains the address. */
  match: (octets: [number, number, number, number]) => boolean;
  /** The containing range, rendered for the given address. */
  value: (octets: [number, number, number, number]) => string;
  label: string;
  /**
   * Friendly interface label when a point-to-point NIC sits in this range.
   * Absent → the interface keeps its device name (`en0`, `utun4`).
   */
  interfaceLabel?: string;
}

/**
 * The one range table. `suggestTrustEntries` (block-event path) and the
 * `/api/network-interfaces` suggestion derivation (interface path) both read it,
 * so the two routes to the same decision can never give contradictory advice.
 */
const WELL_KNOWN_RANGES: WellKnownRange[] = [
  {
    match: ([a, b]) => a === 100 && b >= 64 && b <= 127,
    value: () => "100.64.0.0/10",
    label: "tailnet CGNAT range",
    interfaceLabel: "tailnet",
  },
  { match: ([a]) => a === 10, value: () => "10.0.0.0/8", label: "mesh /8 subnet" },
  {
    match: ([a, b]) => a === 172 && b >= 16 && b <= 31,
    value: ([, b]) => `172.${b}.0.0/16`,
    label: "private /16 subnet",
  },
  {
    match: ([a, b]) => a === 192 && b === 168,
    value: ([, , c]) => `192.168.${c}.0/24`,
    label: "home LAN /24",
  },
];

function octetsOf(ip: string): [number, number, number, number] | null {
  if (!isIpv4Literal(ip)) return null;
  const o = ip.split(".").map((p) => Number.parseInt(p, 10));
  return [o[0], o[1], o[2], o[3]];
}

function matchRange(ip: string): { range: WellKnownRange; octets: [number, number, number, number] } | null {
  const octets = octetsOf(ip);
  if (!octets) return null;
  const range = WELL_KNOWN_RANGES.find((r) => r.match(octets));
  return range ? { range, octets } : null;
}

/**
 * The well-known range containing `ip`, or `null` when none is recognised.
 * Inventing a range for an unrecognised address would be a guess, and a wrong
 * trust entry is worse than no entry.
 */
export function wellKnownContainingRange(ip: string): { value: string; label: string } | null {
  const hit = matchRange(ip);
  if (!hit) return null;
  return { value: hit.range.value(hit.octets), label: hit.range.label };
}

/**
 * A human-meaningful name for a network interface. `utun4` does not say
 * "Tailscale" to the person deciding whom to trust. Falls back to the device
 * name whenever the address matches no range that carries a friendly label.
 */
export function interfaceLabel(name: string, address: string): string {
  return matchRange(address)?.range.interfaceLabel ?? name;
}

// ── Interface suggestion derivation ──────────────────────────────────

/** Netmask → prefix length. `"255.255.255.0"` → `24`. */
export function netmaskBits(netmask: string): number {
  const num = ipv4ToNum(netmask);
  if (num === null) return 0;
  let bits = 0;
  let n = num;
  while (n & 0x80000000) {
    bits++;
    n = (n << 1) >>> 0;
  }
  return bits;
}

/** Network address of `ip` under `netmask`. `("192.168.1.42", "255.255.255.0")` → `"192.168.1.0"`. */
export function networkAddressOf(ip: string, netmask: string): string {
  const ipNum = ipv4ToNum(ip);
  const maskNum = ipv4ToNum(netmask);
  if (ipNum === null || maskNum === null) return ip;
  const net = (ipNum & maskNum) >>> 0;
  return [(net >>> 24) & 0xff, (net >>> 16) & 0xff, (net >>> 8) & 0xff, net & 0xff].join(".");
}

/**
 * The trust offers an interface can honestly make.
 *
 * `suggestTrustEntries` is written for a REMOTE peer IP, so its first entry is
 * always the exact host. Here the address is OUR OWN, making an exact-host
 * offer meaningless — a Tailscale node's `/32` trusts nobody new, since the
 * host is already loopback-exempt. The mapping is therefore:
 *
 * | interface kind                     | offer                          |
 * |------------------------------------|--------------------------------|
 * | broadcast (`/24`, `/16`, …)        | its netmask-derived CIDR, narrow |
 * | point-to-point (`/32`), known range| the containing range, wide     |
 * | point-to-point, unknown range      | none — shown unofferable       |
 *
 * Tiering is contextual: an interface supplies no truthful narrower option than
 * its own network, so its `/24` is narrow here while the same `/24` derived
 * from a single block-event peer is wide. Every offer states its range in the
 * label — colour is a hint, the range is the fact.
 */
export function deriveInterfaceSuggestions(iface: { address: string; netmask: string }): {
  pointToPoint: boolean;
  suggestions: TrustSuggestion[];
} {
  const bits = netmaskBits(iface.netmask);
  if (bits === 32) {
    const wk = wellKnownContainingRange(iface.address);
    return {
      pointToPoint: true,
      suggestions: wk ? [{ value: wk.value, label: wk.label, wide: true }] : [],
    };
  }
  const value = `${networkAddressOf(iface.address, iface.netmask)}/${bits}`;
  return { pointToPoint: false, suggestions: [{ value, label: `interface subnet ${value}`, wide: false }] };
}

/**
 * Collapse per-address interface entries into one dropdown row per OFFER.
 *
 * Deduplication belongs here, not in the endpoint: `/api/network-interfaces`
 * has a second consumer — the listen-interface picker renders one option per
 * ADDRESS, so dropping `en7` server-side would make that bind address
 * unselectable. Keyed on the suggestion `value` rather than the interface
 * `cidr`, because two point-to-point NICs (two tailnets, or Tailscale plus
 * WireGuard) have different `/32` cidrs yet both offer `100.64.0.0/10`.
 * The first entry in response order supplies the row's label.
 */
export function dedupeInterfaceOffers(
  entries: readonly { name: string; label?: string; pointToPoint?: boolean; suggestions?: TrustSuggestion[] }[],
): { value: string; label: string; suggestionLabel: string; wide: boolean }[] {
  const rows: { value: string; label: string; suggestionLabel: string; wide: boolean }[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const s of entry.suggestions ?? []) {
      if (seen.has(s.value)) continue;
      seen.add(s.value);
      rows.push({ value: s.value, label: entry.label ?? entry.name, suggestionLabel: s.label, wide: s.wide });
    }
  }
  return rows;
}
