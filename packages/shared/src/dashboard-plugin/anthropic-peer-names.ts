/**
 * Peer-probe key for the `pi-anthropic-messages` peer. Lives in shared so core
 * (client) and the flows-anthropic-bridge plugin read one constant without a
 * core→plugin import. The plugin re-exports it.
 * See change: decouple-plugins-from-core (task 2.1).
 */

/** Legacy pre-rescope module name — also the only key the bridge's `probeAll` emits. */
export const PEER_AM_LEGACY = "@pi/anthropic-messages";
