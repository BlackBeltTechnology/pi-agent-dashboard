/**
 * Pairing payload ↔ QR/copy-string codecs (device-pairing).
 *
 * Two encodings of the SAME `{ v, id, code, urls[] }` payload:
 *   - **copy-string** — the bare `pi:pair:v1.<base64url>` string an Electron/
 *     native client pastes (`encodePayloadString`). Unchanged.
 *   - **QR deep link** — `https://<tls-endpoint>/pair#pi:pair:v1.<base64url>`
 *     (`encodePairingQrUrl`). A phone camera recognizes the `https` scheme and
 *     opens the browser `/pair` view; the one-time code rides the URL FRAGMENT
 *     (after `#`), so it never reaches the server in the landing request nor
 *     lands in access logs / `Referer`.
 *
 * `decodePayloadString` accepts every form — bare payload, `pi:pair:v1.` copy-
 * string, or the full `https://…/pair#…` deep link — so one QR serves both the
 * phone camera and Electron.
 *
 * See change: make-pairing-qr-camera-scannable.
 */
import type { PairingPayload } from "./pairing-api.js";

/** Opaque copy-string prefix identifying the pairing payload encoding + version. */
const PAYLOAD_PREFIX = "pi:pair:v1.";

// ── base64url ──────────────────────────────────────────────────────────────

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── encode ───────────────────────────────────────────────────────────────

/** Bare base64url copy-string the device/Electron accepts (`pi:pair:v1.<b64>`). */
export function encodePayloadString(payload: PairingPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return `${PAYLOAD_PREFIX}${bytesToB64url(bytes)}`;
}

/** Reduce any `https`/`wss` endpoint URL to its `https://<host>` origin. */
function httpsOrigin(baseUrl: string): string {
  const httpish = baseUrl.trim().replace(/^ws:\/\//i, "http://").replace(/^wss:\/\//i, "https://");
  const u = new URL(httpish);
  return `https://${u.host}`;
}

/**
 * Wrap the payload as a camera-scannable `https` deep link:
 *   `https://<host-of-baseUrl>/pair#pi:pair:v1.<base64url>`
 * The payload lives in the fragment, so the one-time code is never transmitted
 * to the server in the `/pair` landing request. `baseUrl` is the primary TLS
 * pairing endpoint (its scheme is normalized to `https`, path/query dropped).
 */
export function encodePairingQrUrl(payload: PairingPayload, baseUrl: string): string {
  return `${httpsOrigin(baseUrl)}/pair#${encodePayloadString(payload)}`;
}

// ── decode ───────────────────────────────────────────────────────────────

/**
 * Decode any accepted pairing form into a payload:
 *   - `https://…/pair#<payload>` deep link → take the URL fragment first
 *   - `pi:pair:v1.<base64url>` copy-string → strip the prefix
 *   - bare `<base64url>` or raw `{…}` JSON (legacy / defensive)
 * Throws on a malformed payload.
 */
export function decodePayloadString(raw: string): PairingPayload {
  let s = raw.trim();
  if (/^https?:\/\//i.test(s)) {
    const hash = new URL(s).hash;
    s = decodeURIComponent(hash.startsWith("#") ? hash.slice(1) : hash).trim();
  }
  if (s.startsWith(PAYLOAD_PREFIX)) s = s.slice(PAYLOAD_PREFIX.length);

  const json = s.startsWith("{") ? s : new TextDecoder().decode(b64urlToBytes(s));
  const obj = JSON.parse(json) as PairingPayload;
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof obj.id !== "string" ||
    typeof obj.code !== "string" ||
    !Array.isArray(obj.urls)
  ) {
    throw new Error("malformed pairing payload");
  }
  return obj;
}
