/**
 * Wire shape of the pairing-approval credential refusal (401) sent by
 * `POST /api/pair/approve`, `/approve-pending` and `/deny`. Pure types +
 * constants: the server builds the body, the dialog reads `remedies`.
 *
 * Disclosure rule: exactly four keys; `reason`/`remedies` carry only the caller's
 * own network position and whether a login method exists — never a pendingId,
 * host, address, device or label. `error` keeps the legacy string so older
 * clients degrade to the old prose.
 * See change: fix-pairing-approval-credential.
 */

/** What the refused operator can do about it. A later change MAY add values. */
export type PairingApprovalRemedy = "authorize-browser" | "approve-on-host" | "sign-in";

/** Canonical relative order of the remedies defined here. */
export const PAIRING_REMEDY_ORDER: readonly PairingApprovalRemedy[] = Object.freeze([
  "authorize-browser",
  "approve-on-host",
  "sign-in",
]);

/** Why the caller was refused. */
export type PairingRefusalReason = "device-credential" | "no-credential";

/** Body of a pairing-approval 401 whose `Host` was admitted. Exactly these keys. */
export interface PairingRefusalBody {
  success: false;
  error: "operator credential required";
  reason: PairingRefusalReason;
  remedies: PairingApprovalRemedy[];
}
