/**
 * Intake of the device key and companion key that ride a knock or a QR redeem.
 *
 * Verified when the request ARRIVES (the single-use nonce is consumed then,
 * valid or not); the result is held on the pending device and only bound to a
 * device row at operator approval. An invalid, replayed or already-held key is
 * silently dropped — the response never changes — and leaves one throttled
 * `key_ignored` audit line.
 *
 * See change: device-key-mutual-check (D3, D5, D10).
 */
import {
  companionMessage,
  devbindMessage,
  isCompanionTsFresh,
  isDevicePub,
  isDeviceSig,
  parseCompanionTs,
  validCompanionOrigin,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { auditKeyEvent } from "../auth/audit-log.js";
import { type DeviceNonceStore, verifyDeviceSignature, verifyNonceProof } from "../auth/device-proof.js";
import { keyIdOf, type PairedDeviceRegistry } from "./paired-devices.js";

/** What a knock or redeem may carry that survived verification. */
export interface VerifiedDeviceKeys {
  /** Verified primary device key (raw base64url). */
  deviceKey?: string;
  /** Verified companion; `origin` exactly as sent (stripping is for storage/display only). */
  companion?: { pub: string; origin: string };
}

/** One `key_ignored` line per key id per window, bounded map. */
const IGNORED_LOG_WINDOW_MS = 10 * 60_000;
const IGNORED_LOG_MAX_KEYS = 1024;

export interface DeviceKeyIntakeDeps {
  nonces: DeviceNonceStore;
  registry: Pick<PairedDeviceRegistry, "isKeyHeld">;
  fingerprint: () => string;
  now?: () => number;
}

export function createDeviceKeyIntake(deps: DeviceKeyIntakeDeps) {
  const now = deps.now ?? Date.now;
  const lastIgnored = new Map<string, number>();

  function noteIgnored(pub: unknown): void {
    if (!isDevicePub(pub)) return; // no key id to name
    const id = keyIdOf(pub);
    const t = now();
    const prev = lastIgnored.get(id);
    if (prev !== undefined && t - prev < IGNORED_LOG_WINDOW_MS) return;
    lastIgnored.delete(id);
    lastIgnored.set(id, t);
    while (lastIgnored.size > IGNORED_LOG_MAX_KEYS) {
      const oldest = lastIgnored.keys().next().value;
      if (oldest === undefined) break;
      lastIgnored.delete(oldest);
    }
    auditKeyEvent("key_ignored", undefined, id);
  }

  function rawPub(raw: unknown): unknown {
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>).pub : undefined;
  }

  /** `deviceKey: {deviceNonce, pub, sig}` → the verified, not-yet-held public key, else undefined. */
  function acceptDeviceKey(raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    // `verifyNonceProof` consumes the nonce on first presentation even when the rest is malformed.
    const fields = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (!verifyNonceProof(deps.nonces, fields, (n) => devbindMessage(deps.fingerprint(), n))) {
      noteIgnored(rawPub(raw));
      return undefined;
    }
    const pub = fields.pub as string;
    if (deps.registry.isKeyHeld(pub)) {
      noteIgnored(pub);
      return undefined;
    }
    return pub;
  }

  /** `companion: {pub, ts, sig, origin}` → the verified, fresh, not-yet-held companion, else undefined. */
  function acceptCompanion(raw: unknown): { pub: string; origin: string } | undefined {
    if (raw === undefined || raw === null) return undefined;
    const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const ts = parseCompanionTs(c.ts);
    if (
      !isDevicePub(c.pub) ||
      !isDeviceSig(c.sig) ||
      ts === null ||
      !isCompanionTsFresh(ts, now()) ||
      !validCompanionOrigin(c.origin) ||
      !verifyDeviceSignature(c.pub, companionMessage(deps.fingerprint(), c.origin, ts), c.sig)
    ) {
      noteIgnored(c.pub);
      return undefined;
    }
    if (deps.registry.isKeyHeld(c.pub)) {
      noteIgnored(c.pub);
      return undefined;
    }
    return { pub: c.pub, origin: c.origin };
  }

  /** Verify both; a companion equal to the device key is dropped (the key alone is kept). */
  function accept(body: { deviceKey?: unknown; companion?: unknown } | null | undefined): VerifiedDeviceKeys {
    const deviceKey = acceptDeviceKey(body?.deviceKey);
    const companion = acceptCompanion(body?.companion);
    return {
      ...(deviceKey ? { deviceKey } : {}),
      ...(companion && companion.pub !== deviceKey ? { companion } : {}),
    };
  }

  return { accept, acceptDeviceKey, acceptCompanion };
}

export type DeviceKeyIntake = ReturnType<typeof createDeviceKeyIntake>;
