/**
 * Where a bridge keeps the server identities it has pinned (D8, task 7.1).
 *
 * Keyed by FINGERPRINT, not by address: the whole point of pinning is that the
 * identity survives a URL change (task 7.4), so an address-keyed store would
 * force a re-pair every time the dashboard moved — and re-pairing on sight is
 * exactly the trust-anything behaviour being removed.
 *
 * The address is still recorded, but only as a hint for disambiguating between
 * several pins. It is never treated as proof of who answered.
 *
 * See change: add-pi-gateway-transport-identity (D8, tasks 7.1–7.5).
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import type { ServerPin } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";

export interface PinnedServer extends ServerPin {
  /** Operator-facing name, when pairing supplied one. */
  label?: string;
  /** The last address this identity was seen at — a hint, never an authority. */
  lastEndpoint?: string;
  pairedAt: string;
}

export interface ServerPinStore {
  servers: PinnedServer[];
}

/** `~/.pi/dashboard/pinned-servers.json`. */
export function serverPinsPath(env?: { homedir?: string }): string {
  return path.join(getDashboardConfigDir(env), "pinned-servers.json");
}

/** Read the store; a missing or corrupt file reads as "nothing pinned". */
export function loadServerPins(file: string): ServerPinStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<ServerPinStore>;
    return { servers: Array.isArray(parsed.servers) ? parsed.servers : [] };
  } catch {
    return { servers: [] };
  }
}

function writeStore(file: string, store: ServerPinStore): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Pin a server identity at pairing time, replacing any earlier pin of it. */
export function recordServerPin(
  file: string,
  input: ServerPin & { endpoint?: string; label?: string },
): void {
  const store = loadServerPins(file);
  const entry: PinnedServer = {
    fingerprint: input.fingerprint,
    publicKeyB64: input.publicKeyB64,
    label: input.label,
    lastEndpoint: input.endpoint,
    pairedAt: new Date().toISOString(),
  };
  const idx = store.servers.findIndex((s) => s.fingerprint === input.fingerprint);
  if (idx >= 0) store.servers[idx] = { ...store.servers[idx], ...entry };
  else store.servers.push(entry);
  writeStore(file, store);
}

/**
 * Find the pin to challenge an endpoint against.
 *
 * Exact-address match first; otherwise the sole pin, since one pinned identity
 * that has moved is the common case (7.4). With several pins and no address
 * match there is nothing to disambiguate on, so the answer is "no pin" — and a
 * missing pin is a refusal, not a pass.
 */
export function resolvePinForEndpoint(store: ServerPinStore, endpoint: string): PinnedServer | undefined {
  const exact = store.servers.find((s) => s.lastEndpoint === endpoint);
  if (exact) return exact;
  return store.servers.length === 1 ? store.servers[0] : undefined;
}

/** Remember where a VERIFIED identity answered. Unknown fingerprints are inert. */
export function notePinEndpoint(file: string, fingerprint: string, endpoint: string): void {
  const store = loadServerPins(file);
  const entry = store.servers.find((s) => s.fingerprint === fingerprint);
  if (!entry || entry.lastEndpoint === endpoint) return;
  entry.lastEndpoint = endpoint;
  writeStore(file, store);
}
