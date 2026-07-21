/**
 * Pairing QR codec tests (change: make-pairing-qr-camera-scannable).
 * Covers tasks 1.1 (round-trip https deep link), 1.2 (fragment not query),
 * 1.3 (copy-string distinct + unchanged), 1.6 (copy-string is not a URL).
 */
import { describe, expect, it } from "vitest";
import type { PairingPayload } from "../pairing/pairing-api.js";
import { decodePayloadString, encodePairingQrUrl, encodePayloadString } from "../pairing/pairing-qr.js";

const PAYLOAD: PairingPayload = {
  v: 1,
  id: "sha256:abc123",
  code: "482913",
  urls: ["wss://relay.example.io/ws", "https://lan.example.io"],
};

describe("encodePairingQrUrl", () => {
  it("1.1 produces an https://<host>/pair#pi:pair:v1.<b64> URL whose fragment decodes to the payload", () => {
    const url = encodePairingQrUrl(PAYLOAD, "wss://relay.example.io/ws");
    expect(url.startsWith("https://relay.example.io/pair#pi:pair:v1.")).toBe(true);

    const parsed = new URL(url);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.pathname).toBe("/pair");

    const fromFragment = parsed.hash.replace(/^#/, "");
    expect(decodePayloadString(fromFragment)).toEqual(PAYLOAD);
    // Whole URL is also decodable (Electron scan tolerance).
    expect(decodePayloadString(url)).toEqual(PAYLOAD);
  });

  it("1.1 normalizes an https base URL (drops path/query, keeps host)", () => {
    const url = encodePairingQrUrl(PAYLOAD, "https://lan.example.io:8443/some/path?x=1");
    expect(url.startsWith("https://lan.example.io:8443/pair#")).toBe(true);
  });

  it("1.2 carries the payload in the fragment — nothing after '?', everything after '#'", () => {
    const url = encodePairingQrUrl(PAYLOAD, "wss://relay.example.io/ws");
    const parsed = new URL(url);
    expect(parsed.search).toBe("");
    expect(parsed.hash.length).toBeGreaterThan(1);
    // The one-time code appears only after '#', never in the query.
    expect(parsed.search.includes(PAYLOAD.code)).toBe(false);
    expect(url.split("#")[1]).toContain(encodePayloadString(PAYLOAD).slice(0, 8));
  });
});

describe("encodePayloadString (copy-string)", () => {
  it("1.3 stays the bare pi:pair:v1.<b64> string, distinct from the QR URL", () => {
    const copy = encodePayloadString(PAYLOAD);
    const qr = encodePairingQrUrl(PAYLOAD, "wss://relay.example.io/ws");
    expect(copy.startsWith("pi:pair:v1.")).toBe(true);
    expect(copy).not.toEqual(qr);
    expect(qr.endsWith(copy)).toBe(true); // QR fragment == copy-string
    expect(decodePayloadString(copy)).toEqual(PAYLOAD);
  });

  it("1.6 the copy-string is NOT a camera-actionable https/tel/mailto URL", () => {
    const copy = encodePayloadString(PAYLOAD);
    // The `pi:` scheme is exactly what a phone camera refuses to act on — the
    // whole reason the QR must wrap it in https. Assert it is neither an https
    // URL nor any other actionable scheme a camera would open.
    expect(/^(https?|tel|mailto|wifi|geo):/i.test(copy)).toBe(false);
    expect(copy.startsWith("pi:pair:v1.")).toBe(true);
  });
});
