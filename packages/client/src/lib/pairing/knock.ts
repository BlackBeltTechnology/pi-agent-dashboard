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
  type DeviceKeyProvider,
  type KnockHooks,
  type KnockOutcome,
  knockServerWith,
  type ProveFn,
} from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import { detectDeviceKeySupport, rotateKey, signDevbind } from "./device-key.js";
import { challengeIdentity } from "./pair-protocol.js";

export type { KnockHooks, KnockOutcome };

/** WebCrypto prover: an unverified signature is a refusal; transport failures throw (as before). */
const proveWithWebCrypto: ProveFn = async (baseUrl) => {
  const proof = await challengeIdentity(baseUrl);
  return proof.verified
    ? { proven: proof.fingerprint, ...(proof.deviceNonce ? { deviceNonce: proof.deviceNonce } : {}) }
    : { refused: "signature invalid" };
};

/**
 * Device-key provider backed by this origin's IndexedDB store, or `undefined` where the page cannot hold a key
 * (plain http, no Ed25519): pass it as `hooks.deviceKey`. A pairing request always gets a NEW key (the old one,
 * if any, is still held by the old record — design D3 "Key rotation on re-pairing").
 */
export async function webCryptoDeviceKeyProvider(): Promise<DeviceKeyProvider | undefined> {
  if (!(await detectDeviceKeySupport())) return undefined;
  return {
    prove: proveWithWebCrypto,
    sign: async (fingerprint, deviceNonce) => {
      await rotateKey(fingerprint);
      return signDevbind(fingerprint, deviceNonce);
    },
  };
}

export function knockServer(
  baseUrl: string,
  expectedFingerprint: string,
  name: string,
  hooks: KnockHooks = {},
): Promise<KnockOutcome> {
  return knockServerWith(proveWithWebCrypto, baseUrl, expectedFingerprint, name, hooks);
}
