/**
 * Creation-lock contention (test-plan X6b, decision G7): a live holder past
 * the 2 s retry budget and an unwritable lock directory refuse ONE write with
 * keychain_unavailable and are NOT cached; a stale lock is taken over.
 * Stub in-process provider: no real keychain.
 * See change: encrypt-credentials-at-rest (D4; tasks 3.1, 14).
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeEnvelope } from "../auth/credential-envelope.js";
import { _resetCredentialKeyForTests, getCredentialKeyState, initCredentialKey } from "../auth/credential-key.js";
import { LOCK_OPTIONS } from "../auth/locked-json-file.js";
import { filePath, lockTarget, resetCredentialFiles, stubKeychain, writeVia } from "./helpers/credential-key-kit.js";

const require = createRequire(import.meta.url);
const lockfile = require("proper-lockfile") as typeof import("proper-lockfile");
const isWin = process.platform === "win32"; // platform-branch-ok: EACCES via chmod is POSIX only
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

beforeEach(() => {
  _resetCredentialKeyForTests();
  resetCredentialFiles();
});
afterEach(() => {
  _resetCredentialKeyForTests();
  try { fs.chmodSync(path.dirname(lockTarget()), 0o700); } catch { /* ignore */ }
});

describe("creation lock contention (G7)", () => {
  it("X6b: a stale lock (mtime −31 s) is taken over and the key is created", async () => {
    const kc = stubKeychain(null);
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    const lockDir = `${lockTarget()}.lock`;
    fs.mkdirSync(lockDir, { recursive: true });
    const old = new Date(Date.now() - 31_000);
    fs.utimesSync(lockDir, old, old);
    await writeVia("vault", { a: 1 });
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", created: true });
    expect(kc.calls.set).toBe(1);
    expect(decodeEnvelope(fs.readFileSync(filePath("vault")), Buffer.from(kc.lastSet as string, "base64"), "vault").kind).toBe("document");
  });

  it("X6b: a live holder past the 2 s budget refuses that write only; it is not cached", async () => {
    const kc = stubKeychain(null);
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    fs.mkdirSync(path.dirname(lockTarget()), { recursive: true });
    const release = await lockfile.lock(lockTarget(), { ...LOCK_OPTIONS });
    const t0 = Date.now();
    await expect(writeVia("vault", { a: 1 })).rejects.toMatchObject({ code: "credential_locked", reason: "keychain_unavailable" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
    expect(kc.calls.ctor).toHaveLength(0);
    expect(fs.existsSync(filePath("vault"))).toBe(false);
    expect(getCredentialKeyState().state).toBe("deferred"); // not cached

    await release();
    await writeVia("vault", { a: 2 }); // retries the lock and proceeds
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", created: true });
    expect(kc.calls.set).toBe(1);
  }, 20_000);

  it.skipIf(isWin || isRoot)("X6b: an unwritable lock directory refuses that write only; it is not cached", async () => {
    const kc = stubKeychain(null);
    await initCredentialKey({ env: {}, entryFactory: kc.factory });
    fs.mkdirSync(path.dirname(lockTarget()), { recursive: true });
    fs.chmodSync(path.dirname(lockTarget()), 0o500);
    await expect(writeVia("vault", { a: 1 })).rejects.toMatchObject({ reason: "keychain_unavailable" });
    expect(kc.calls.ctor).toHaveLength(0);
    expect(getCredentialKeyState().state).toBe("deferred");
    fs.chmodSync(path.dirname(lockTarget()), 0o700);
    await writeVia("vault", { a: 2 });
    expect(getCredentialKeyState()).toMatchObject({ state: "ready" });
    expect(kc.calls.set).toBe(1);
  });
});
