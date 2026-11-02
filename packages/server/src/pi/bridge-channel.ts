/**
 * What the hub itself observed about how one bridge socket was admitted. Bound per socket by the gateway
 * and answered by `channelOf(sessionId)` from the socket the session is currently ROUTED to, so the record
 * follows the routing entry at register and at move-commit. The vault trust gate reads it; nothing here is
 * a claim by the bridge.
 *
 * See change: prove-vault-bridge-tls (D3).
 */

/** How the connection was admitted. */
export type BridgeAdmission =
  | "unix"
  | "local-proof"
  | "in-process"
  | "device-ticket"
  | "local-ticket"
  | "legacy-token"
  | "grace";

export interface BridgeChannel {
  admission: BridgeAdmission;
  /** The upgrade arrived on the hub's own TLS socket with no forwarding header. */
  provenTls: boolean;
  /** The consumed ticket was minted on a proven-TLS request. */
  ticketTls: boolean;
  /** Device the consumed ticket was minted for (`device-ticket` admissions). */
  ticketDeviceId?: string;
}

/** Admissions that prove the peer is on this host (unix socket, local credential proof, in-process). */
export function isLocallyAdmitted(admission: BridgeAdmission): boolean {
  return admission === "unix" || admission === "local-proof" || admission === "in-process";
}
