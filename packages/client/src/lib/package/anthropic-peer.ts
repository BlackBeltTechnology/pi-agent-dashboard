/**
 * Shared constants + probe derivation for the `pi-anthropic-messages` peer.
 *
 * `derivePeerState` reads ONLY the legacy probe key `@pi/anthropic-messages`
 * (the only key the bridge emits; `probeAll` folds the scoped name into it).
 * Used by `useAnthropicPeerProbe` (hook) and `peer-auto-install-store` (the
 * install decision), so both read one shape identically.
 *
 * See change: streamline-first-run (design D2).
 */
import { PEER_AM_LEGACY } from "@blackbelt-technology/pi-dashboard-flows-anthropic-bridge-plugin/peer-probe";
import { RECOMMENDED_EXTENSIONS } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";

const BRIDGE_PLUGIN_ID = "flows-anthropic-bridge";

/** Install source for the peer — the shipped recommended-extensions entry. */
export const ANTHROPIC_PEER_SOURCE: string =
  RECOMMENDED_EXTENSIONS.find((e) => e.id === "pi-anthropic-messages")?.source ?? "";

/** The recommended-extensions entry id for the peer. */
export const ANTHROPIC_PEER_ENTRY_ID = "pi-anthropic-messages";

/** The bridge emits `import failed: …` when resolve succeeded but import threw. */
export const IMPORT_FAILURE_PREFIX = "import failed:";

export interface PeerProbeState {
  /** Strict `ok === false`. */
  missing: boolean;
  /** Strict `ok === true`. */
  resolving: boolean;
  /** `missing` with an `import failed:` reason (package installed, load threw). */
  importFailed: boolean;
  /** Probe `reason` verbatim (server-originated). */
  reason?: string;
}

/** Narrowing read of an unknown-shaped object property. */
function prop(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Every unknown shape (no plugins, no row, no probe, no key) is all-false: fail-open. */
export function derivePeerState(body: unknown): PeerProbeState {
  const none: PeerProbeState = { missing: false, resolving: false, importFailed: false };
  const plugins = prop(body, "plugins");
  if (!Array.isArray(plugins)) return none;
  const row = plugins.find((p) => prop(p, "id") === BRIDGE_PLUGIN_ID);
  const peer = prop(prop(prop(row, "lastProbe"), "peers"), PEER_AM_LEGACY);
  const ok = prop(peer, "ok");
  if (ok === true) return { ...none, resolving: true };
  if (ok !== false) return none;
  const reason = prop(peer, "reason");
  const reasonText = typeof reason === "string" ? reason : undefined;
  return {
    missing: true,
    resolving: false,
    importFailed: reasonText?.startsWith(IMPORT_FAILURE_PREFIX) === true,
    reason: reasonText,
  };
}
