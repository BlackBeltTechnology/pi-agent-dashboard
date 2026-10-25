/**
 * Real-timer deadline tests for the keychain worker (test-plan P1, P2, P3, X4).
 * SLOW BY DESIGN: each case waits out up to 10 s of wall clock, so they live in
 * a file of their own. A stub worker entry scripts the delay; no real keychain.
 * See change: encrypt-credentials-at-rest (D4, G1; tasks 3.1, 14).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetCredentialKeyForTests,
  getCredentialCodec,
  getCredentialKeyState,
  initCredentialKey,
} from "../auth/credential-key.js";
import {
  b64,
  countingWorkerFactory,
  KEY_1,
  resetCredentialFiles,
  STUB_WORKER_ENTRY,
  writeEnvelopeFile,
  writePlain,
  writeVia,
} from "./helpers/credential-key-kit.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stub = (scripts: Record<string, unknown>) => ({ workerEntry: STUB_WORKER_ENTRY, workerData: { scripts } });
let workers: ReturnType<typeof countingWorkerFactory>;

beforeEach(() => {
  _resetCredentialKeyForTests();
  resetCredentialFiles();
  workers = countingWorkerFactory();
});
afterEach(async () => {
  _resetCredentialKeyForTests();
  await workers.reap();
});

describe("keychain deadline (real timers)", () => {
  it("P1: a hung keychain resolves keychain_timeout at 10 s while the event loop stays free", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    let ticks = 0;
    const interval = setInterval(() => { ticks++; }, 100);
    let resolved = false;
    let resolvedAt9900: boolean | undefined;
    const t0 = Date.now();
    const check = setTimeout(() => { resolvedAt9900 = resolved; }, 9900);
    const p = initCredentialKey({ env: {}, ...stub({ default: { mode: "hang" } }), workerFactory: workers.factory });
    void p.then(() => { resolved = true; });
    await p;
    const elapsed = Date.now() - t0;
    clearInterval(interval);
    clearTimeout(check);
    expect(elapsed).toBeGreaterThanOrEqual(10_000);
    expect(elapsed).toBeLessThanOrEqual(10_300);
    expect(resolvedAt9900).toBe(false);
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_timeout" });
    expect(ticks).toBeGreaterThanOrEqual(95);
  }, 30_000);

  it("P2: an answer just inside the deadline is accepted", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    const t0 = Date.now();
    await initCredentialKey({
      env: {},
      ...stub({ default: { mode: "answer", value: b64(KEY_1), delayMs: 9500 } }),
      workerFactory: workers.factory,
    });
    expect(Date.now() - t0).toBeLessThanOrEqual(9800);
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", source: "keychain" });
  }, 30_000);

  it.each([
    ["A: the read hangs", { read: { mode: "hang" } }],
    ["B: the read is empty and the creation hangs", { read: { mode: "answer", value: null }, create: { mode: "hang" } }],
  ])("P3: startup stays inside one 10 s total deadline — %s", async (_n, scripts) => {
    writePlain("vault", { accounts: [] });
    const t0 = Date.now();
    await initCredentialKey({ env: {}, ...stub(scripts), workerFactory: workers.factory });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(10_000);
    expect(elapsed).toBeLessThanOrEqual(10_300); // one total deadline, not 20 s
    expect(elapsed).toBeLessThan(30_000);
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_timeout" });
    expect(getCredentialCodec("vault").unavailableReason()).toBe("keychain_timeout");
  }, 30_000);

  it("X4: a late answer is ignored — no second keychain job, so no second prompt", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    await initCredentialKey({
      env: {},
      ...stub({ default: { mode: "answer", value: b64(KEY_1), delayMs: 10_500 } }),
      workerFactory: workers.factory,
    });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_timeout" });
    await sleep(1000); // the stub answers during this window
    await expect(writeVia("vault", { n: 1 })).rejects.toMatchObject({ reason: "keychain_timeout" });
    await expect(writeVia("plugin-credentials", { n: 2 })).rejects.toMatchObject({ reason: "keychain_timeout" });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_timeout" });
    expect(workers.count).toBe(1);
  }, 30_000);
});
