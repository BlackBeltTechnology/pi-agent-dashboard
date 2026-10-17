/**
 * Local pairing-token store: safeStorage only, memory-only fallback.
 * See change: add-operator-browser-relay (test-plan #E50 store half, #E51).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTokenStore } from "../tokens.js";
import { fakeCrypto, noCrypto, tempDir } from "./fixtures.js";

let tmp: ReturnType<typeof tempDir>;
beforeEach(() => {
  tmp = tempDir();
});
afterEach(() => tmp.cleanup());
const open = (crypto = fakeCrypto()) => createTokenStore({ dir: tmp.dir, crypto, log: () => {} });
const file = () => path.join(tmp.dir, "browser-host-tokens.json");

describe("token store", () => {
  it("stores per profile, encrypted on disk, restored after a restart", () => {
    open().set("Default", "T0KEN-xyz");
    expect(open().get("Default")).toBe("T0KEN-xyz");
    expect(open().get("Profile 1")).toBeNull();
    expect(fs.readFileSync(file(), "utf8")).not.toContain("T0KEN-xyz");
  });

  it("set(profile, null) removes the token everywhere", () => {
    const s = open();
    s.set("Default", "T0KEN-xyz");
    s.set("Default", null);
    expect(s.get("Default")).toBeNull();
    expect(open().get("Default")).toBeNull();
  });

  it("E51: without encryption the token lives in memory only (absent after restart, nothing on disk)", () => {
    const s = open(noCrypto());
    s.set("Default", "T0KEN-xyz");
    expect(s.get("Default")).toBe("T0KEN-xyz");
    expect(open(noCrypto()).get("Default")).toBeNull();
    expect(fs.readdirSync(tmp.dir)).toEqual([]);
  });

  it("does not clobber an encrypted file when encryption is unavailable this run", () => {
    open().set("Default", "T0KEN-xyz");
    const before = fs.readFileSync(file(), "utf8");
    open(noCrypto()).set("Other", "memory-only");
    expect(fs.readFileSync(file(), "utf8")).toBe(before);
  });

  it("drops an undecryptable token and ignores a corrupt file", () => {
    fs.writeFileSync(file(), "{not json");
    expect(open().get("Default")).toBeNull();
    fs.writeFileSync(file(), JSON.stringify({ version: 1, tokens: { Default: { enc: "safeStorage", data: "AAAA" } } }));
    expect(open().get("Default")).toBeNull();
  });

  it("writes the file owner-only on POSIX", () => {
    if (process.platform === "win32") return;
    open().set("Default", "T");
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });

  it("rejects absurd inputs", () => {
    const s = open();
    expect(() => s.set("", "t")).toThrow();
    expect(() => s.set("Default", "t".repeat(5000))).toThrow();
  });
});
