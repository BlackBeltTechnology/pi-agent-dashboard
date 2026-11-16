/**
 * Device-key proof helpers shared by the server, the browser client, the
 * Electron main process and the mobile shell.
 *
 * Pure: string builders, validators, the companion fragment codec, the short
 * key id and the row-state derivation. No `node:crypto` import — the browser
 * bundles this file. Signing/verifying lives with each runtime (WebCrypto in
 * the browser, `node:crypto` on the server and in Electron).
 *
 * Signed texts are LF-joined with no trailing LF, version-prefixed, and
 * carry the server fingerprint, so a signature for one server or one purpose
 * never verifies as another (design D1).
 *
 * See change: device-key-mutual-check (D1, D3, D5, D9).
 */
import { INVISIBLE_OR_SEPARATOR } from "./terminal-safe.js";

export const DEVCHECK_PREFIX = "pi-devcheck/v2";
export const DEVBIND_PREFIX = "pi-devbind/v1";
export const COMPANION_PREFIX = "pi-companion/v1";

/** Server nonce lifetime and client re-challenge threshold. */
export const DEVICE_NONCE_TTL_MS = 60_000;
export const DEVICE_NONCE_REUSE_MS = 30_000;
export const COMPANION_TS_WINDOW_S = 300;
export const COMPANION_FRAGMENT_MAX = 512;
export const COMPANION_ORIGIN_MAX_BYTES = 255;
export const MAX_COMPANIONS = 4;

export function devcheckMessage(fingerprint: string, deviceNonce: string): string {
  return `${DEVCHECK_PREFIX}\n${fingerprint}\n${deviceNonce}`;
}
export function devbindMessage(fingerprint: string, deviceNonce: string): string {
  return `${DEVBIND_PREFIX}\n${fingerprint}\n${deviceNonce}`;
}
export function companionMessage(fingerprint: string, origin: string, ts: number): string {
  return `${COMPANION_PREFIX}\n${fingerprint}\n${origin}\n${ts}`;
}

// 32 bytes → 43 chars, last char carries 2 zero pad bits; 64 bytes → 86 chars, 4 zero bits.
const PUB_RE = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const SIG_RE = /^[A-Za-z0-9_-]{85}[AQgw]$/;

export function isDevicePub(v: unknown): v is string {
  return typeof v === "string" && PUB_RE.test(v);
}
export function isDeviceSig(v: unknown): v is string {
  return typeof v === "string" && SIG_RE.test(v);
}
/** Server-issued: 32 random bytes, base64url, 43 chars. */
export function isDeviceNonce(v: unknown): v is string {
  return typeof v === "string" && PUB_RE.test(v);
}

export interface DeviceProof {
  deviceNonce: string;
  pub: string;
  sig: string;
}

/** `{deviceNonce, pub, sig}` with every field shape-checked, else `null`. */
export function parseDeviceProof(v: unknown): DeviceProof | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isDeviceNonce(o.deviceNonce) || !isDevicePub(o.pub) || !isDeviceSig(o.sig)) return null;
  return { deviceNonce: o.deviceNonce, pub: o.pub, sig: o.sig };
}

/** Integer seconds, from a number or a decimal-digit string; else `null`. */
export function parseCompanionTs(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d{1,15}$/.test(v)) return Number(v);
  return null;
}

export function isCompanionTsFresh(ts: number, nowMs: number): boolean {
  return Math.abs(nowMs / 1000 - ts) <= COMPANION_TS_WINDOW_S;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * `http(s)://host[:port]` only — no userinfo, path, query or fragment,
 * at most 255 UTF-8 bytes. Parsed as sent; control/format characters are
 * allowed here (the signature covers them) and stripped only for storage.
 */
export function validCompanionOrigin(v: unknown): v is string {
  if (typeof v !== "string" || utf8Bytes(v) > COMPANION_ORIGIN_MAX_BYTES) return false;
  const m = /^https?:\/\/(\[[0-9A-Fa-f:.]+\]|[^\s/?#@\\:[\]]+)(?::(\d{1,5}))?$/.exec(v);
  if (!m) return false;
  if (m[2] !== undefined) {
    const port = Number(m[2]);
    if (port < 1 || port > 65535) return false;
  }
  return true;
}

/** Stored / displayed form: control and format characters removed. */
export function storedCompanionOrigin(origin: string): string {
  return origin.replace(INVISIBLE_OR_SEPARATOR, "").replace(/\p{Cc}/gu, "");
}

export interface CompanionClaim {
  pub: string;
  ts: number;
  sig: string;
  origin: string;
}

export function encodeCompanionFragment(c: CompanionClaim): string {
  return `companion=${c.pub}.${c.ts}.${c.sig}&from=${encodeURIComponent(c.origin)}`;
}

/**
 * Structural parse of a `companion=` fragment (leading `#` optional): at most
 * 512 chars, exactly three dot parts of the right shapes, a `from` value.
 * Origin validity is the receiving server's call (`validCompanionOrigin`).
 */
export function parseCompanionFragment(hash: string): CompanionClaim | null {
  const frag = hash.startsWith("#") ? hash.slice(1) : hash;
  if (frag.length > COMPANION_FRAGMENT_MAX) return null;
  const m = /^companion=([^&]*)&from=([^&]*)$/.exec(frag);
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 3) return null;
  const [pub, tsRaw, sig] = parts;
  const ts = parseCompanionTs(tsRaw);
  if (!isDevicePub(pub) || !isDeviceSig(sig) || ts === null) return null;
  let origin: string;
  try {
    origin = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (origin.length === 0) return null;
  return { pub, ts, sig, origin };
}

/** Raw 32-byte Ed25519 key → SPKI DER (fixed 12-byte prefix). */
const SPKI_ED25519_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
export function rawEd25519PubToSpki(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(SPKI_ED25519_PREFIX.length + raw.length);
  out.set(SPKI_ED25519_PREFIX, 0);
  out.set(raw, SPKI_ED25519_PREFIX.length);
  return out;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function bytesToBase64url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
  }
  return out;
}
export function base64urlToBytes(s: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64URL.indexOf(ch);
    if (v < 0) throw new Error("bad base64url");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** `dk:` + first 12 base64url chars of SHA-256 over the raw public key. */
export function shortKeyIdFromDigest(digest: Uint8Array): string {
  return `dk:${bytesToBase64url(digest).slice(0, 12)}`;
}
export async function shortKeyId(pub: string): Promise<string> {
  const raw = base64urlToBytes(pub);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", raw as BufferSource);
  return shortKeyIdFromDigest(new Uint8Array(digest));
}

// ── Device-status reply + row state (D9) ─────────────────────────────

export type DeviceTier = "observe" | "control" | "operate";
export type DeviceStatus = "paired" | "expired" | "unknown" | "revoked" | "unverified";

/** Wire body of `POST /api/pair/device-status`. */
export interface DeviceStatusReply {
  status: DeviceStatus;
  tier?: DeviceTier;
  scope?: "full" | "status-only";
}

/** Narrow an untrusted reply body; anything unrecognised is `unverified`. */
export function parseDeviceStatusReply(v: unknown): DeviceStatusReply {
  if (!v || typeof v !== "object") return { status: "unverified" };
  const o = v as Record<string, unknown>;
  switch (o.status) {
    case "paired": {
      if (o.scope === "status-only") return { status: "paired", scope: "status-only" };
      const tier = o.tier === "observe" || o.tier === "control" || o.tier === "operate" ? o.tier : undefined;
      return tier ? { status: "paired", scope: "full", tier } : { status: "unverified" };
    }
    case "expired":
    case "unknown":
    case "revoked":
      return { status: o.status };
    default:
      return { status: "unverified" };
  }
}

/** What the client learnt from the two-step check. */
export type DeviceCheckReply =
  | ({ kind: "answer" } & DeviceStatusReply)
  /** The challenge reply carried no `deviceNonce` (older server). */
  | { kind: "no-nonce" }
  /** Timeout, transport error, or no check was run. */
  | { kind: "no-answer" };

/** `unknowable`: a browser tab cannot see another origin's credential. */
export type DeviceRowCredential = "held" | "none" | "unknowable";

export type DeviceRowStateId =
  | "paired"
  | "paired-status-only"
  | "access-removed"
  | "access-expired"
  | "not-paired"
  | "key-pending"
  | "status-unknown";

export interface DeviceRowState {
  state: DeviceRowStateId;
  tier?: DeviceTier;
  label: string;
  action?: "pair" | "pair-again";
}

export const TIER_LABELS: Record<DeviceTier, string> = {
  observe: "Observe",
  control: "Control",
  operate: "Operate",
};

export const DEVICE_ROW_LABELS: Record<Exclude<DeviceRowStateId, "paired">, string> = {
  "paired-status-only": "Paired · status only",
  "access-removed": "Access removed",
  "access-expired": "Access expired",
  "not-paired": "Not paired",
  "key-pending": "Paired · key pending",
  "status-unknown": "Status unknown",
};

function row(state: Exclude<DeviceRowStateId, "paired">, action?: DeviceRowState["action"]): DeviceRowState {
  return action ? { state, label: DEVICE_ROW_LABELS[state], action } : { state, label: DEVICE_ROW_LABELS[state] };
}

/**
 * Pure `(credential, keyHeld, reply) → row state`. Never returns a discard
 * instruction: only a refused credential at a proven route discards (D9).
 * `credentialAccepted` is the outcome of the verifying authenticated call
 * after an `unknown` answer (undefined while it is in flight).
 */
export function deviceRowState(input: {
  credential: DeviceRowCredential;
  keyHeld: boolean;
  reply: DeviceCheckReply;
  credentialAccepted?: boolean;
}): DeviceRowState {
  const { credential, keyHeld, reply, credentialAccepted } = input;
  if (!keyHeld) {
    if (credential === "held") return row("key-pending");
    if (credential === "none") return row("not-paired", "pair");
    return row("status-unknown");
  }
  if (reply.kind !== "answer") return row("status-unknown");
  switch (reply.status) {
    case "paired":
      if (reply.scope === "status-only") return row("paired-status-only");
      if (reply.tier) return { state: "paired", tier: reply.tier, label: `Paired · ${TIER_LABELS[reply.tier]}` };
      return row("status-unknown");
    case "revoked":
      return row("access-removed", "pair-again");
    case "expired":
      return row("access-expired", "pair-again");
    case "unknown":
      if (credential === "none") return row("not-paired", "pair");
      if (credential === "held") {
        if (credentialAccepted === true) return row("key-pending");
        if (credentialAccepted === false) return row("not-paired", "pair");
      }
      return row("status-unknown");
    default:
      return row("status-unknown");
  }
}
