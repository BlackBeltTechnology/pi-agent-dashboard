/**
 * The device-key step of a browser pairing request: turn an identity challenge into a signed `deviceKey`
 * body member, creating a NEW key for the proven fingerprint (design D3: pair again always rotates).
 *
 * Never throws and never blocks pairing: an unsupported page (plain http, no Ed25519) returns `null`
 * WITHOUT a challenge or any `crypto.subtle` access; an older server (no `deviceNonce`), an unverified or
 * failed challenge, or a store error also return `null` — the request then goes out keyless.
 *
 * See change: device-key-mutual-check (tasks 4.3, 4.4, D3, D4).
 */
import type { DeviceProof } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { detectDeviceKeySupport, discardKey, markPending, rotateKey, settlePending, signDevbind } from "./device-key.js";
import { challengeIdentity, type IdentityProof } from "./pair-protocol.js";

export interface PreparedDeviceKey {
  /** The proven server fingerprint the key is stored under. */
  fingerprint: string;
  deviceKey: DeviceProof;
}

/** Sign a bind proof from an already-run, verified challenge (the QR flow reuses the one that proved the pin). */
export async function deviceKeyFromChallenge(proof: Pick<IdentityProof, "fingerprint" | "verified" | "deviceNonce">): Promise<PreparedDeviceKey | null> {
  if (!proof.verified || !proof.deviceNonce) return null;
  if (!(await detectDeviceKeySupport())) return null;
  try {
    await rotateKey(proof.fingerprint);
    const deviceKey = await signDevbind(proof.fingerprint, proof.deviceNonce);
    return deviceKey ? { fingerprint: proof.fingerprint, deviceKey } : null;
  } catch {
    await discardKey(proof.fingerprint);
    return null;
  }
}

/** The `deviceKey` member of a pairing request body: absent for a keyless request. */
export function deviceKeyBody(prepared: PreparedDeviceKey | null): { deviceKey?: DeviceProof } {
  return prepared ? { deviceKey: prepared.deviceKey } : {};
}

/** Run exactly one identity challenge at `base` (none when the page cannot hold a key) and sign over it. */
export async function prepareDeviceKey(base: string): Promise<PreparedDeviceKey | null> {
  if (!(await detectDeviceKeySupport())) return null;
  try {
    return await deviceKeyFromChallenge(await challengeIdentity(base));
  } catch {
    return null;
  }
}

/** Map a request outcome to the key's fate: `approved` keeps it, everything else deletes the pending key. */
export function settleRequestKey(fingerprint: string, outcome: "approved" | "rejected" | "expired" | "missed"): Promise<void> {
  return settlePending(fingerprint, outcome === "approved" ? "approved" : outcome === "rejected" ? "rejected" : "expired");
}

/** What happens to a request's key at each step of the request; every step is a no-op for a keyless request. */
export interface RequestKeyLife {
  /** The request was admitted: keep the key (marked pending) so a reload resumes it. */
  admitted(pendingId: string): Promise<void>;
  /** The request ended: `approved` keeps the key, anything else deletes it. */
  settled(outcome: "approved" | "rejected" | "expired" | "missed"): void;
  /** The request never got admitted (refused / transport failure): the new key has no use. */
  failed(): void;
}

const NO_KEY_LIFE: RequestKeyLife = { admitted: async () => {}, settled: () => {}, failed: () => {} };

export function requestKeyLife(key: { fingerprint: string } | null): RequestKeyLife {
  if (!key) return NO_KEY_LIFE;
  const { fingerprint } = key;
  return {
    admitted: (pendingId) => markPending(fingerprint, pendingId),
    settled: (outcome) => void settleRequestKey(fingerprint, outcome),
    failed: () => void discardKey(fingerprint),
  };
}
