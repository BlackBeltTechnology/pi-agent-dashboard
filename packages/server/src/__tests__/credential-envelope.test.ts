/**
 * Envelope format, classification, header tolerance and kid derivation
 * (test-plan E1–E7, E6b). Pure functions: no key module, no keychain.
 * See change: encrypt-credentials-at-rest (D2, D3).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classify, decodeEnvelope, deriveKid, encodeEnvelope } from "../auth/credential-envelope.js";

const KEY_A = Buffer.alloc(32, 0xa1);
const KEY_B = Buffer.alloc(32, 0xb2);
const MAGIC = "pi-dashboard-encrypted:v1";

/** Parse the envelope's JSON line (line 2). */
function headerOf(bytes: Buffer): Record<string, string> {
  return JSON.parse(bytes.toString("utf8").split("\n")[1]);
}

/** Rebuild an envelope file from magic + a (mutated) header. */
function withHeader(bytes: Buffer, mutate: (h: Record<string, unknown>) => void, magic = MAGIC): Buffer {
  const h = headerOf(bytes);
  mutate(h);
  return Buffer.from(`${magic}\n${JSON.stringify(h)}\n`);
}

const doc = { a: 1 };
const good = () => encodeEnvelope(doc, KEY_A, "vault");

describe("credential envelope — format (E1, E2, E3)", () => {
  it("E1: envelope format round-trips and has the documented layout", () => {
    const bytes = encodeEnvelope(doc, KEY_A, "vault");
    const lines = bytes.toString("utf8").split("\n");
    expect(lines[0]).toBe(MAGIC);
    const header = JSON.parse(lines[1]);
    expect(Object.keys(header).sort()).toEqual(["alg", "ct", "iv", "kid", "tag"]);
    expect(header.alg).toBe("A256GCM");
    expect(Buffer.from(header.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(header.tag, "base64")).toHaveLength(16);
    expect(header.kid).toMatch(/^[0-9a-f]{16}$/);
    const out = decodeEnvelope(bytes, KEY_A, "vault");
    expect(out).toMatchObject({ kind: "document", doc });
  });

  it("E2: a fresh nonce per write", () => {
    const ivs = new Set<string>();
    const cts = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const h = headerOf(encodeEnvelope(doc, KEY_A, "vault"));
      ivs.add(h.iv);
      cts.add(h.ct);
    }
    expect(ivs.size).toBe(1000);
    expect(cts.size).toBe(1000);
  });

  it("E3: AAD binds fileId", () => {
    const bytes = encodeEnvelope({ secret: "marker-xyz" }, KEY_A, "vault");
    const out = decodeEnvelope(bytes, KEY_A, "plugin-credentials");
    expect(out).toEqual({ kind: "locked", reason: "key_mismatch" });
    expect(JSON.stringify(out)).not.toContain("marker-xyz");
  });
});

describe("credential envelope — classify (E4, E5, E6)", () => {
  it("E4: classify", () => {
    expect(classify(null)).toBe("absent");
    expect(classify(undefined)).toBe("absent");
    expect(classify(Buffer.from("{}"))).toBe("plaintext");
    expect(classify(Buffer.from("[]"))).toBe("corrupt");
    expect(classify(Buffer.from("{not json"))).toBe("corrupt");
    expect(classify(Buffer.alloc(0))).toBe("corrupt");
    expect(classify(Buffer.from("null"))).toBe("corrupt");
  });

  it.each(["pi-dashboard-encrypted:v2", "pi-dashboard-encrypted:v10", "pi-dashboard-encrypted:", "pi-dashboard-encrypted:v1x"])(
    "E5: unsupported version %s is never corrupt",
    (line1) => {
      const bytes = Buffer.from(`${line1}\n{"alg":"A256GCM"}\n`);
      expect(classify(bytes)).toBe("unsupported");
      expect(decodeEnvelope(bytes, KEY_A, "vault")).toEqual({ kind: "locked", reason: "unsupported_format" });
    },
  );

  const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
  const damaged: Array<[string, (h: Record<string, unknown>) => void] | [string, Buffer]> = [
    ["line 2 missing", Buffer.from(`${MAGIC}\n`)],
    ["line 2 truncated", Buffer.from(`${MAGIC}\n{"alg":`)],
    ["no alg", (h) => delete h.alg],
    ["no kid", (h) => delete h.kid],
    ["no iv", (h) => delete h.iv],
    ["no tag", (h) => delete h.tag],
    ["no ct", (h) => delete h.ct],
    ["iv 11 B", (h) => { h.iv = b64(11); }],
    ["iv 13 B", (h) => { h.iv = b64(13); }],
    ["tag 15 B", (h) => { h.tag = b64(15); }],
    ["tag 17 B", (h) => { h.tag = b64(17); }],
    ["ct @@@", (h) => { h.ct = "@@@"; }],
  ];

  it.each(damaged)("E6: damaged v1 header — %s", (_name, how) => {
    const bytes = Buffer.isBuffer(how) ? how : withHeader(good(), how);
    expect(classify(bytes)).toBe("damaged");
    expect(decodeEnvelope(bytes, KEY_A, "vault")).toEqual({ kind: "locked", reason: "envelope_damaged" });
  });

  it("E6: controls — iv 12 B and tag 16 B decode", () => {
    // A well-formed header (iv 12 B, tag 16 B) is an envelope even when the ciphertext is foreign.
    const foreign = withHeader(good(), (h) => { h.iv = b64(12); h.tag = b64(16); });
    expect(classify(foreign)).toBe("envelope");
    expect(decodeEnvelope(foreign, KEY_A, "vault")).toEqual({ kind: "locked", reason: "key_mismatch" });
    expect(classify(good())).toBe("envelope");
    expect(decodeEnvelope(good(), KEY_A, "vault").kind).toBe("document");
  });
});

describe("credential envelope — header tolerance (E6b)", () => {
  it("E6b: BOM, CRLF and one trailing newline are tolerated", () => {
    const text = good().toString("utf8");
    const variants: Buffer[] = [
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
      Buffer.from(text.replace(/\n/g, "\r\n")),
      Buffer.from(`${text.trimEnd()}\n`),
      Buffer.from(text.trimEnd()), // no trailing newline at all
    ];
    for (const v of variants) {
      expect(classify(v)).toBe("envelope");
      expect(decodeEnvelope(v, KEY_A, "vault")).toMatchObject({ kind: "document", doc });
    }
  });

  it("E6b: a 3rd non-empty line and alg A128GCM are damaged", () => {
    const extra = Buffer.from(`${good().toString("utf8")}extra\n`);
    expect(classify(extra)).toBe("damaged");
    expect(decodeEnvelope(extra, KEY_A, "vault")).toEqual({ kind: "locked", reason: "envelope_damaged" });
    const alg = withHeader(good(), (h) => { h.alg = "A128GCM"; });
    expect(classify(alg)).toBe("damaged");
    expect(decodeEnvelope(alg, KEY_A, "vault")).toEqual({ kind: "locked", reason: "envelope_damaged" });
  });

  it("E6b: a case-variant magic is corrupt, not an envelope", () => {
    const bytes = Buffer.from(good().toString("utf8").replace(MAGIC, "PI-DASHBOARD-ENCRYPTED:v1"));
    expect(classify(bytes)).toBe("corrupt");
    expect(decodeEnvelope(bytes, KEY_A, "vault")).toMatchObject({ kind: "not-envelope", class: "corrupt" });
  });
});

describe("credential envelope — kid (E7)", () => {
  it("E7: kid is one-way, stable and distinguishes keys", () => {
    const kidA = deriveKid(KEY_A);
    expect(deriveKid(KEY_A)).toBe(kidA);
    expect(kidA).not.toBe(deriveKid(KEY_B));
    expect(kidA).toMatch(/^[0-9a-f]{16}$/);
    expect(KEY_A.toString("hex")).not.toContain(kidA);
    expect(KEY_A.toString("base64")).not.toContain(kidA);
    expect(kidA).toBe(
      createHash("sha256").update(Buffer.concat([Buffer.from("pi-dashboard-kid\0"), KEY_A])).digest("hex").slice(0, 16),
    );

    const bytes = good();
    expect(decodeEnvelope(bytes, KEY_B, "vault")).toEqual({ kind: "locked", reason: "key_mismatch" });

    const h = headerOf(bytes);
    const ct = Buffer.from(h.ct, "base64");
    ct[0] ^= 0x01;
    const tampered = withHeader(bytes, (x) => { x.ct = ct.toString("base64"); });
    expect(decodeEnvelope(tampered, KEY_A, "vault")).toEqual({ kind: "locked", reason: "key_mismatch" });
  });
});
