/**
 * Electron shell decode-tolerance tests (change: make-pairing-qr-camera-scannable).
 * Task 1.5: `decodePayloadString("https://ep/pair#pi:pair:v1.<b64>")` returns the
 * same payload as `decodePayloadString("pi:pair:v1.<b64>")` so ONE QR serves both
 * the phone camera and an Electron "Scan QR"/paste.
 */
import { describe, expect, it } from "vitest";
import { decodePayloadString, type PairingPayload } from "./protocol.js";

const PAYLOAD: PairingPayload = {
  v: 1,
  id: "sha256:server-fp",
  code: "482913",
  urls: ["https://relay.example.io", "wss://relay.example.io/ws"],
};

/** base64url of the payload JSON (matches the client `encodePayloadString`). */
function b64url(payload: PairingPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("decodePayloadString tolerance", () => {
  const b64 = b64url(PAYLOAD);
  const copyString = `pi:pair:v1.${b64}`;
  const deepLink = `https://relay.example.io/pair#${copyString}`;

  it("1.5 decodes the https deep link identically to the bare copy-string", () => {
    expect(decodePayloadString(deepLink)).toEqual(PAYLOAD);
    expect(decodePayloadString(copyString)).toEqual(PAYLOAD);
    expect(decodePayloadString(deepLink)).toEqual(decodePayloadString(copyString));
  });

  it("still accepts the bare base64url and raw JSON forms (regression)", () => {
    expect(decodePayloadString(b64)).toEqual(PAYLOAD);
    expect(decodePayloadString(JSON.stringify(PAYLOAD))).toEqual(PAYLOAD);
  });

  it("tolerates surrounding whitespace and a trailing-slash-free wrapper", () => {
    expect(decodePayloadString(`  ${deepLink}  `)).toEqual(PAYLOAD);
  });
});
