/**
 * Device-key proof helpers: signed texts, validators, companion fragment,
 * short key id, and the pure row-state derivation.
 *
 * See change: device-key-mutual-check (tasks 1.1, 1.2, 1.4; test-plan E1, E2, E6, E7, E11).
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  COMPANION_FRAGMENT_MAX,
  COMPANION_ORIGIN_MAX_BYTES,
  COMPANION_TS_WINDOW_S,
  type DeviceCheckReply,
  type DeviceRowCredential,
  companionMessage,
  deviceRowState,
  devbindMessage,
  devcheckMessage,
  encodeCompanionFragment,
  isCompanionTsFresh,
  isDeviceNonce,
  isDevicePub,
  isDeviceSig,
  parseCompanionFragment,
  parseCompanionTs,
  parseDeviceProof,
  rawEd25519PubToSpki,
  shortKeyId,
  shortKeyIdFromDigest,
  storedCompanionOrigin,
  validCompanionOrigin,
} from "../device-key-proof.js";

const fpA = `sha256:${"A".repeat(43)}`;
const fpB = `sha256:${"B".repeat(43)}`;
const N = crypto.randomBytes(32).toString("base64url");

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = (publicKey.export({ format: "jwk" }) as { x: string }).x;
  return { pub, privateKey };
}
function sign(privateKey: crypto.KeyObject, text: string): string {
  return crypto.sign(null, Buffer.from(text, "utf-8"), privateKey).toString("base64url");
}
function verify(pub: string, text: string, sig: string): boolean {
  const key = crypto.createPublicKey({
    key: Buffer.from(rawEd25519PubToSpki(Buffer.from(pub, "base64url"))),
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, Buffer.from(text, "utf-8"), key, Buffer.from(sig, "base64url"));
}

describe("signed texts (E1)", () => {
  it("lays out each kind LF-joined with no trailing LF", () => {
    expect(devcheckMessage(fpA, N)).toBe(`pi-devcheck/v2\n${fpA}\n${N}`);
    expect(devbindMessage(fpA, N)).toBe(`pi-devbind/v1\n${fpA}\n${N}`);
    expect(companionMessage(fpA, "http://192.168.16.31:8000", 1700000000)).toBe(
      `pi-companion/v1\n${fpA}\nhttp://192.168.16.31:8000\n1700000000`,
    );
    expect(devcheckMessage(fpA, N).endsWith("\n")).toBe(false);
  });

  it("never verifies across kinds or fingerprints", () => {
    const { pub, privateKey } = keyPair();
    const check = sign(privateKey, devcheckMessage(fpA, N));
    expect(verify(pub, devcheckMessage(fpA, N), check)).toBe(true);
    expect(verify(pub, devcheckMessage(fpB, N), check)).toBe(false);
    expect(verify(pub, devbindMessage(fpA, N), check)).toBe(false);
    const bind = sign(privateKey, devbindMessage(fpA, N));
    expect(verify(pub, devcheckMessage(fpA, N), bind)).toBe(false);
    const comp = sign(privateKey, companionMessage(fpA, "http://h:1", 5));
    expect(verify(pub, devcheckMessage(fpA, N), comp)).toBe(false);
    expect(verify(pub, devbindMessage(fpA, N), comp)).toBe(false);
  });

  it("short id of 32 zero bytes is dk:Zmh6rfhivXds", async () => {
    const zero = Buffer.alloc(32).toString("base64url");
    const id = await shortKeyId(zero);
    expect(id).toBe("dk:Zmh6rfhivXds");
    expect(id).toHaveLength(15);
    const digest = crypto.createHash("sha256").update(Buffer.alloc(32)).digest();
    expect(shortKeyIdFromDigest(digest)).toBe(id);
  });
});

describe("validators (E2)", () => {
  const b64 = (n: number) => crypto.randomBytes(n).toString("base64url");
  it("pub is exactly 32 raw bytes, unpadded base64url", () => {
    expect(isDevicePub(b64(32))).toBe(true);
    expect(isDevicePub(b64(31))).toBe(false);
    expect(isDevicePub(b64(33))).toBe(false);
    expect(isDevicePub(`${b64(32)}=`)).toBe(false);
    expect(isDevicePub(crypto.randomBytes(32).toString("base64").replace(/=/g, "").replace(/[A-Za-z0-9]/, "+"))).toBe(false);
    expect(isDevicePub(`${"A".repeat(42)}/`)).toBe(false);
    expect(isDevicePub(`${"A".repeat(42)}B`)).toBe(false); // non-canonical trailing bits
    expect(isDevicePub(42 as unknown as string)).toBe(false);
  });
  it("sig is exactly 64 bytes", () => {
    expect(isDeviceSig(b64(64))).toBe(true);
    expect(isDeviceSig(b64(63))).toBe(false);
    expect(isDeviceSig(b64(65))).toBe(false);
  });
  it("deviceNonce is exactly 43 chars", () => {
    expect(isDeviceNonce(b64(32))).toBe(true);
    expect(isDeviceNonce(b64(32).slice(0, 42))).toBe(false);
    expect(isDeviceNonce(`${b64(32)}A`)).toBe(false);
  });
  it("ts must be an integer", () => {
    expect(parseCompanionTs("12.5")).toBeNull();
    expect(parseCompanionTs("abc")).toBeNull();
    expect(parseCompanionTs("1700000000")).toBe(1700000000);
    expect(parseCompanionTs(1700000000)).toBe(1700000000);
    expect(parseCompanionTs(1.5)).toBeNull();
  });
  it("parseDeviceProof accepts only well-formed objects", () => {
    const ok = { deviceNonce: b64(32), pub: b64(32), sig: b64(64) };
    expect(parseDeviceProof(ok)).toEqual(ok);
    expect(parseDeviceProof({ ...ok, pub: b64(31) })).toBeNull();
    expect(parseDeviceProof(null)).toBeNull();
    expect(parseDeviceProof("x")).toBeNull();
  });
});

describe("companion fragment (E6)", () => {
  const pub = crypto.randomBytes(32).toString("base64url");
  const sig = crypto.randomBytes(64).toString("base64url");
  const origin = "http://192.168.16.31:8000";

  it("round-trips encode/parse with or without #", () => {
    const frag = encodeCompanionFragment({ pub, ts: 1700000000, sig, origin });
    expect(frag).toBe(`companion=${pub}.1700000000.${sig}&from=${encodeURIComponent(origin)}`);
    expect(parseCompanionFragment(frag)).toEqual({ pub, ts: 1700000000, sig, origin });
    expect(parseCompanionFragment(`#${frag}`)).toEqual({ pub, ts: 1700000000, sig, origin });
  });

  it("accepts a 511 and 512 char fragment with a valid origin and refuses 513", () => {
    const mk = (len: number) => {
      const prefix = `companion=${pub}.1700000000.${sig}&from=`;
      const enc = encodeURIComponent("http://");
      const hostLen = len - prefix.length - enc.length;
      return `${prefix}${enc}${"a".repeat(hostLen)}`;
    };
    expect(mk(511)).toHaveLength(511);
    expect(parseCompanionFragment(mk(511))).not.toBeNull();
    expect(parseCompanionFragment(mk(512))).not.toBeNull();
    expect(parseCompanionFragment(mk(513))).toBeNull();
    expect(COMPANION_FRAGMENT_MAX).toBe(512);
  });

  it("needs exactly three dot parts", () => {
    expect(parseCompanionFragment(`companion=${pub}.1&from=${encodeURIComponent(origin)}`)).toBeNull();
    expect(parseCompanionFragment(`companion=${pub}.1.${sig}.x&from=${encodeURIComponent(origin)}`)).toBeNull();
  });

  it("refuses other fragments", () => {
    expect(parseCompanionFragment("something-else")).toBeNull();
    expect(parseCompanionFragment("#")).toBeNull();
    expect(parseCompanionFragment(`Companion=${pub}.1.${sig}&from=x`)).toBeNull();
  });

  it("ts window is ±300 s inclusive", () => {
    const now = 1_700_000_000_000;
    const s = now / 1000;
    expect(COMPANION_TS_WINDOW_S).toBe(300);
    expect(isCompanionTsFresh(s - 300, now)).toBe(true);
    expect(isCompanionTsFresh(s + 300, now)).toBe(true);
    expect(isCompanionTsFresh(s - 301, now)).toBe(false);
    expect(isCompanionTsFresh(s + 301, now)).toBe(false);
  });
});

describe("companion origin (E7)", () => {
  it.each([
    ["http://192.168.16.31:8000", true],
    ["https://h.example", true],
    ["http://[fd12::4]:8000", true],
    ["http://user:pw@host", false],
    ["http://host/path", false],
    ["http://host/", false],
    ["http://host?x=1", false],
    ["http://host#f", false],
    ["javascript:alert(1)", false],
    ["ftp://h", false],
    ["http://host:99999", false],
    ["http://", false],
  ])("%s → %s", (o, ok) => {
    expect(validCompanionOrigin(o)).toBe(ok);
  });

  it("counts bytes, not chars", () => {
    const at = (n: number) => `http://${"a".repeat(n - 7)}`;
    expect(validCompanionOrigin(at(255))).toBe(true);
    expect(validCompanionOrigin(at(256))).toBe(false);
    expect(COMPANION_ORIGIN_MAX_BYTES).toBe(255);
    const twoByte = `http://${"é".repeat(124)}a`; // 7 + 248 + 1 = 256 bytes, 132 chars
    expect(Buffer.byteLength(twoByte)).toBe(256);
    expect(validCompanionOrigin(twoByte)).toBe(false);
  });

  it("accepts control/format characters as sent but strips them for storage", () => {
    for (const ch of ["\u202E", "\u200B", "\u0000"]) {
      const raw = `http://ho${ch}st:8000`;
      expect(validCompanionOrigin(raw)).toBe(true);
      expect(storedCompanionOrigin(raw)).toBe("http://host:8000");
    }
  });
});

describe("deviceRowState (E11)", () => {
  const replies: DeviceCheckReply[] = [
    { kind: "answer", status: "paired", scope: "full", tier: "operate" },
    { kind: "answer", status: "paired", scope: "full", tier: "control" },
    { kind: "answer", status: "paired", scope: "full", tier: "observe" },
    { kind: "answer", status: "paired", scope: "status-only" },
    { kind: "answer", status: "revoked" },
    { kind: "answer", status: "expired" },
    { kind: "answer", status: "unknown" },
    { kind: "answer", status: "unverified" },
    { kind: "no-nonce" },
    { kind: "no-answer" },
  ];
  const creds: DeviceRowCredential[] = ["held", "none", "unknowable"];

  it("maps each reply", () => {
    const s = (reply: DeviceCheckReply, credential: DeviceRowCredential = "held", keyHeld = true) =>
      deviceRowState({ credential, keyHeld, reply });
    expect(s(replies[1])).toEqual({ state: "paired", tier: "control", label: "Paired · Control" });
    expect(s(replies[0]).label).toBe("Paired · Operate");
    expect(s(replies[2]).label).toBe("Paired · Observe");
    expect(s(replies[3])).toMatchObject({ state: "paired-status-only", label: "Paired · status only" });
    expect(s(replies[4])).toMatchObject({ state: "access-removed", label: "Access removed", action: "pair-again" });
    expect(s(replies[5])).toMatchObject({ state: "access-expired", label: "Access expired", action: "pair-again" });
    expect(s(replies[6], "none")).toMatchObject({ state: "not-paired", label: "Not paired", action: "pair" });
    expect(s(replies[6], "held")).toMatchObject({ state: "status-unknown" });
    expect(s(replies[6], "held", true)).toMatchObject({ state: "status-unknown" });
    expect(deviceRowState({ credential: "held", keyHeld: true, reply: replies[6], credentialAccepted: true }).state).toBe(
      "key-pending",
    );
    expect(deviceRowState({ credential: "held", keyHeld: true, reply: replies[6], credentialAccepted: false }).state).toBe(
      "not-paired",
    );
    for (const r of replies.slice(7)) expect(s(r).state).toBe("status-unknown");
  });

  it("without a key: no proof, credential decides", () => {
    for (const r of replies) {
      expect(deviceRowState({ credential: "held", keyHeld: false, reply: r }).state).toBe("key-pending");
      expect(deviceRowState({ credential: "none", keyHeld: false, reply: r }).state).toBe("not-paired");
      expect(deviceRowState({ credential: "unknowable", keyHeld: false, reply: r }).state).toBe("status-unknown");
    }
  });

  it("a browser tab never reads Not paired for another origin", () => {
    for (const r of replies) {
      for (const keyHeld of [true, false]) {
        expect(deviceRowState({ credential: "unknowable", keyHeld, reply: r }).state).not.toBe("not-paired");
      }
    }
  });

  it("never instructs a discard (property)", () => {
    for (const credential of creds) {
      for (const keyHeld of [true, false]) {
        for (const reply of replies) {
          const out = deviceRowState({ credential, keyHeld, reply }) as unknown as Record<string, unknown>;
          expect(Object.keys(out).some((k) => /discard/i.test(k))).toBe(false);
        }
      }
    }
  });
});
