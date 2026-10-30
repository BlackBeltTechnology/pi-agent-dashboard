/**
 * Whole-file AES-256-GCM envelope for the two credential files, plus the
 * `JsonFileCodec` that plugs it into `locked-json-file` (opt-in `codec`).
 *
 * Format (D2): a magic first line, then ONE JSON line:
 *
 *   pi-dashboard-encrypted:v1
 *   {"alg":"A256GCM","kid":"<16 hex>","iv":"<b64 12 B>","tag":"<b64 16 B>","ct":"<b64>"}
 *
 * Pure module: no key resolution, no keychain, no logging. Key material never
 * appears in a return value, an error or a message here.
 *
 * Classification contract (D3): any file whose first line starts with
 * `pi-dashboard-encrypted:` is an envelope and is NEVER `corrupt`: an unknown
 * version is `unsupported`, a bad v1 header is `damaged`.
 *
 * See change: encrypt-credentials-at-rest (D1, D2, D3).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  type CredentialFileId,
  type CredentialKeyFailureReason,
  type CredentialLockReason,
  credentialRemedy,
  ENVELOPE_MAGIC_PREFIX,
  ENVELOPE_MAGIC_V1,
} from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import type { JsonFileCodec } from "./locked-json-file.js";

export type EnvelopeClass = "absent" | "envelope" | "plaintext" | "unsupported" | "damaged" | "corrupt";

export type EnvelopeDecodeResult =
  | { kind: "document"; doc: Record<string, unknown>; kid: string }
  | { kind: "locked"; reason: Extract<CredentialLockReason, "key_mismatch" | "unsupported_format" | "envelope_damaged"> }
  | { kind: "not-envelope"; class: "absent" | "plaintext" | "corrupt"; doc?: Record<string, unknown> };

export type KeyAvailability = { ok: true; key: Buffer } | { ok: false; reason: CredentialKeyFailureReason };

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALG = "A256GCM";
const KID_PREFIX = Buffer.from("pi-dashboard-kid\0");
const KID_RE = /^[0-9a-f]{16}$/;

/** First 8 bytes of SHA-256("pi-dashboard-kid\0" ‖ key), hex. One-way: tells keys apart without revealing one. */
export function deriveKid(key: Buffer): string {
  return createHash("sha256").update(KID_PREFIX).update(key).digest("hex").slice(0, 16);
}

const aadFor = (fileId: CredentialFileId) => Buffer.from(`pi-dashboard:v1:${fileId}`);

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new TypeError("credential key must be 32 bytes");
}

/** Strict standard base64: canonical padding, canonical round trip. Returns undefined when invalid. */
function strictBase64(value: unknown): Buffer | undefined {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined;
  const buf = Buffer.from(value, "base64");
  return buf.toString("base64") === value ? buf : undefined;
}

interface ParsedHeader {
  kid: string;
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

type Analysis =
  | { kind: "absent" }
  | { kind: "plaintext"; doc: Record<string, unknown> }
  | { kind: "corrupt" }
  | { kind: "unsupported" }
  | { kind: "damaged" }
  | { kind: "envelope"; header: ParsedHeader };

type BytesLike = Buffer | Uint8Array | string | null | undefined;

function parseEnvelopeFile(text: string): Analysis {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== ENVELOPE_MAGIC_V1) return { kind: "unsupported" };
  // Anything but whitespace after the envelope line is damage; a trailing newline is not.
  if (lines.slice(2).some((l) => l.trim().length > 0)) return { kind: "damaged" };
  let raw: unknown;
  try {
    raw = JSON.parse(lines[1] ?? "");
  } catch {
    return { kind: "damaged" };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { kind: "damaged" };
  const h = raw as Record<string, unknown>;
  if (h.alg !== ALG || typeof h.kid !== "string" || !KID_RE.test(h.kid)) return { kind: "damaged" };
  const iv = strictBase64(h.iv);
  const tag = strictBase64(h.tag);
  const ct = strictBase64(h.ct);
  if (!iv || iv.length !== IV_BYTES || !tag || tag.length !== TAG_BYTES || !ct || ct.length === 0) {
    return { kind: "damaged" };
  }
  return { kind: "envelope", header: { kid: h.kid, iv, tag, ct } };
}

function parsePlainFile(text: string): Analysis {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { kind: "plaintext", doc: parsed as Record<string, unknown> };
    }
  } catch {
    /* corrupt below */
  }
  return { kind: "corrupt" };
}

function analyze(bytes: BytesLike): Analysis {
  if (bytes === null || bytes === undefined) return { kind: "absent" };
  let text = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // one leading BOM
  // The magic prefix decides: such a file is never "corrupt".
  return text.startsWith(ENVELOPE_MAGIC_PREFIX) ? parseEnvelopeFile(text) : parsePlainFile(text);
}

/** Classify raw file bytes (`null`/`undefined` = the file is absent). */
export function classify(bytes: BytesLike): EnvelopeClass {
  return analyze(bytes).kind;
}

/** Encrypt `doc` as a v1 envelope file for `fileId`. A fresh random IV per call. */
export function encodeEnvelope(doc: unknown, key: Buffer, fileId: CredentialFileId): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(fileId));
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(doc), "utf8")), cipher.final()]);
  const header = { alg: ALG, kid: deriveKid(key), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
  return Buffer.from(`${ENVELOPE_MAGIC_V1}\n${JSON.stringify(header)}\n`, "utf8");
}

/** Authenticate and decrypt a well-formed header. Any failure is `locked`, never a partial document. */
function decryptHeader(header: ParsedHeader, key: Buffer, fileId: CredentialFileId): EnvelopeDecodeResult {
  if (header.kid !== deriveKid(key)) return { kind: "locked", reason: "key_mismatch" };
  let plain: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, header.iv);
    decipher.setAAD(aadFor(fileId));
    decipher.setAuthTag(header.tag);
    plain = Buffer.concat([decipher.update(header.ct), decipher.final()]);
  } catch {
    return { kind: "locked", reason: "key_mismatch" };
  }
  try {
    const doc: unknown = JSON.parse(plain.toString("utf8"));
    if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
      return { kind: "document", doc: doc as Record<string, unknown>, kid: header.kid };
    }
  } catch {
    /* authenticated but not a JSON object: damaged */
  }
  return { kind: "locked", reason: "envelope_damaged" };
}

/** The result for analyses that need no key. */
function withoutKey(a: Exclude<Analysis, { kind: "envelope" }>): EnvelopeDecodeResult {
  if (a.kind === "unsupported") return { kind: "locked", reason: "unsupported_format" };
  if (a.kind === "damaged") return { kind: "locked", reason: "envelope_damaged" };
  if (a.kind === "plaintext") return { kind: "not-envelope", class: "plaintext", doc: a.doc };
  return { kind: "not-envelope", class: a.kind };
}

/**
 * Decode an envelope. Never returns a partial document: any failure is a
 * `locked` result with exactly one reason. Non-envelope bytes are reported as
 * `not-envelope` (plaintext carries its parsed document).
 */
export function decodeEnvelope(bytes: BytesLike, key: Buffer, fileId: CredentialFileId): EnvelopeDecodeResult {
  assertKey(key);
  const a = analyze(bytes);
  return a.kind === "envelope" ? decryptHeader(a.header, key, fileId) : withoutKey(a);
}

/** Thrown when a credential write is refused. Carries a non-secret reason and the fixed remedy text. */
export class CredentialLockedError extends Error {
  readonly code = "credential_locked";
  readonly reason: CredentialLockReason;
  constructor(reason: CredentialLockReason) {
    super(`Credential write refused (${reason}). ${credentialRemedy(reason)}`);
    this.name = "CredentialLockedError";
    this.reason = reason;
  }
}

/**
 * Codec over a key getter. `getKey` is called on every decode/encode, so a
 * singleton can answer "not ready" until the key has been resolved.
 */
export function createEnvelopeCodec(fileId: CredentialFileId, getKey: () => KeyAvailability): JsonFileCodec {
  const decode: JsonFileCodec["decode"] = (bytes) => {
    const a = analyze(bytes);
    let out: EnvelopeDecodeResult;
    if (a.kind === "envelope") {
      const k = getKey();
      if (!k.ok) return { kind: "locked", reason: k.reason };
      out = decryptHeader(a.header, k.key, fileId);
    } else {
      if (a.kind === "absent") return { kind: "absent" };
      out = withoutKey(a);
    }
    if (out.kind === "document") return { kind: "document", data: out.doc, encrypted: true };
    if (out.kind === "locked") return { kind: "locked", reason: out.reason };
    if (out.class === "plaintext" && out.doc) return { kind: "document", data: out.doc, encrypted: false };
    return { kind: "corrupt" };
  };
  return {
    fileId,
    decode,
    unavailableReason: () => {
      const k = getKey();
      return k.ok ? undefined : k.reason;
    },
    encode: (data, existing) => {
      // Never overwrite an envelope this process cannot read.
      if (existing) {
        const cur = decode(existing);
        if (cur.kind === "locked") throw new CredentialLockedError(cur.reason);
      }
      const k = getKey();
      if (!k.ok) throw new CredentialLockedError(k.reason);
      return encodeEnvelope(data, k.key, fileId);
    },
  };
}
