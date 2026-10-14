/**
 * knockServer — browser-side re-export of the shared native LAN-knock client,
 * proving identity with the WebCrypto `challengeIdentity`.
 *
 * The implementation moved to `packages/shared/src/pairing-knock-client.ts` so
 * Electron main can drive the same state machine with Node crypto.
 *
 * See change: add-lan-knock-pairing (D11); add-electron-server-windows (D2).
 */
import {
  type KnockHooks,
  type KnockOutcome,
  knockServerWith,
  type ProveFn,
} from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import { challengeIdentity } from "./pair-protocol.js";

export type { KnockHooks, KnockOutcome };

/** WebCrypto prover: an unverified signature is a refusal; transport failures throw (as before). */
const proveWithWebCrypto: ProveFn = async (baseUrl) => {
  const proof = await challengeIdentity(baseUrl);
  return proof.verified ? { proven: proof.fingerprint } : { refused: "signature invalid" };
};

export function knockServer(
  baseUrl: string,
  expectedFingerprint: string,
  name: string,
  hooks: KnockHooks = {},
): Promise<KnockOutcome> {
  return knockServerWith(proveWithWebCrypto, baseUrl, expectedFingerprint, name, hooks);
}
