import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildHostSignedMessage,
  HOST_ID_PATTERN,
  hostIdFromPublicKey,
  verifyHostSignature,
} from "../browser-host-identity.js";

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: publicKey.export({ type: "spki", format: "der" }).toString("base64"), priv: privateKey };
}
const signMsg = (priv: ReturnType<typeof keyPair>["priv"], nonce: string, serverId: string) =>
  sign(null, Buffer.from(buildHostSignedMessage(nonce, serverId)), priv).toString("base64");

describe("browser-host-identity", () => {
  it("hostId is host- + 32 hex and stable per key", () => {
    const k = keyPair();
    const id = hostIdFromPublicKey(k.pub);
    expect(id).toMatch(HOST_ID_PATTERN);
    expect(hostIdFromPublicKey(k.pub)).toBe(id);
    expect(hostIdFromPublicKey(keyPair().pub)).not.toBe(id);
  });

  it("signed message has the exact domain-separated layout", () => {
    expect(buildHostSignedMessage("N", "S")).toBe("pi-browser-host-v1\nN\nS");
  });

  it("verifies a good signature and rejects wrong serverId / nonce / key / garbage", () => {
    const k = keyPair();
    const sig = signMsg(k.priv, "n1", "srv-I");
    expect(verifyHostSignature(k.pub, "n1", "srv-I", sig)).toBe(true);
    expect(verifyHostSignature(k.pub, "n1", "srv-J", sig)).toBe(false);
    expect(verifyHostSignature(k.pub, "n2", "srv-I", sig)).toBe(false);
    expect(verifyHostSignature(keyPair().pub, "n1", "srv-I", sig)).toBe(false);
    expect(verifyHostSignature("not-a-key", "n1", "srv-I", sig)).toBe(false);
    expect(verifyHostSignature(k.pub, "n1", "srv-I", "%%%")).toBe(false);
  });
});
