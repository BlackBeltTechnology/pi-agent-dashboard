/**
 * Keychain worker failure modes and the real worker entry (test-plan X1, X2,
 * X3, X5, E98). Stub worker entries script answer/throw/exit/error; the REAL
 * `credential-key-worker.mjs` runs against a fake `@napi-rs/keyring` package,
 * so no real keychain or binding is ever loaded (D9).
 * See change: encrypt-credentials-at-rest (D4, D5; tasks 3.1, 14).
 */

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCredentialKeyForTests,
  getCredentialKeyState,
  initCredentialKey,
} from "../auth/credential-key.js";
import {
  b64,
  countingWorkerFactory,
  createKeyringSandbox,
  filePath,
  KEY_1,
  type KeyringSandbox,
  logSink,
  resetCredentialFiles,
  STUB_WORKER_ENTRY,
  writeEnvelopeFile,
  writePlain,
  writeVia,
} from "./helpers/credential-key-kit.js";

const bindingLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@napi-rs/keyring", () => {
  bindingLoads.count++;
  return { Entry: class {} };
});

let sandbox: KeyringSandbox | undefined;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
}

beforeEach(() => {
  _resetCredentialKeyForTests();
  resetCredentialFiles();
});
afterEach(() => {
  _resetCredentialKeyForTests();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  sandbox?.cleanup();
  sandbox = undefined;
});

const stub = (scripts: Record<string, unknown>) => ({ workerEntry: STUB_WORKER_ENTRY, workerData: { scripts } });

describe("worker failures give keychain_unavailable (X1–X3, X5)", () => {
  it("X1: a Worker constructor that throws → keychain_unavailable; the binding is never loaded on the main thread", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    const sink = logSink();
    await initCredentialKey({
      env: {},
      workerFactory: () => { throw new Error("EAGAIN: cannot spawn worker"); },
      log: sink.log,
    });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
    expect(bindingLoads.count).toBe(0);
    expect(sink.lines.join("\n")).toContain("worker start failed");
  });

  it.each([
    ["throws on import", { default: { mode: "throw" } }],
    ["exits code 1 before posting", { default: { mode: "exit", code: 1 } }],
  ])("X2: a worker that %s → keychain_unavailable; the add is refused; no file is created", async (_n, scripts) => {
    writePlain("plugin-credentials", { seed: 1 }); // forces a keychain job; the vault file does not exist
    await initCredentialKey({ env: {}, ...stub(scripts) });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
    await expect(writeVia("vault", { accounts: [{ label: "lbl-K5dF9sJ2qW7e" }] })).rejects.toMatchObject({
      code: "credential_locked",
      reason: "keychain_unavailable",
    });
    expect(fs.existsSync(filePath("vault"))).toBe(false);
    expect(fs.existsSync(`${filePath("vault")}.tmp`)).toBe(false);
    expect(bindingLoads.count).toBe(0);
  });

  it("X3: a worker that exits silently (code 0) resolves keychain_unavailable well before the deadline", async () => {
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    const t0 = Date.now();
    await initCredentialKey({ env: {}, ...stub({ default: { mode: "exit", code: 0 } }) });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
  });

  it("X5: a binding refused in a signed bundle → keychain_unavailable; both writes refused; no plaintext anywhere", async () => {
    writePlain("plugin-credentials", { old: { seed: "seed-A1" } });
    const sink = logSink();
    await initCredentialKey({
      env: {},
      ...stub({ default: { mode: "error", detail: "dlopen(/x/keyring.node): code signature not valid: different Team IDs" } }),
      log: sink.log,
    });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
    await expect(writeVia("plugin-credentials", { gmail: { tok: "tok-Q7vX2mR9pL4k" } })).rejects.toMatchObject({ reason: "keychain_unavailable" });
    await expect(writeVia("vault", { label: "lbl-K5dF9sJ2qW7e" })).rejects.toMatchObject({ reason: "keychain_unavailable" });
    const all = [filePath("plugin-credentials"), filePath("vault")].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    expect(all).not.toContain("tok-Q7vX2mR9pL4k");
    expect(all).not.toContain("lbl-K5dF9sJ2qW7e");
    expect(sink.lines.join("\n")).toContain("different Team IDs");
  });

  it("X5: a loader-shaped error (nested cause array) logs the nested dlopen reason, not the misleading npm text", async () => {
    sandbox = createKeyringSandbox();
    setEnv({ ...sandbox.env, FAKE_KEYRING_LOAD_ERROR: "dlopen" });
    writePlain("vault", { a: 1 });
    const sink = logSink();
    await initCredentialKey({ env: {}, workerEntry: sandbox.workerEntry, log: sink.log });
    expect(getCredentialKeyState()).toMatchObject({ state: "unavailable", reason: "keychain_unavailable" });
    const detail = sink.lines.find((l) => l.includes("detail")) ?? "";
    expect(detail).toContain("different Team IDs");
    expect(detail).not.toContain("npm has a bug");
    expect(detail.length).toBeLessThan(400);
  });
});

describe("real worker entry (E98 and round trip)", () => {
  it("E98: Linux store pinned — every Entry is constructed with { linux: { store: 'secret-service' } }", async () => {
    sandbox = createKeyringSandbox();
    setEnv(sandbox.env);
    writePlain("plugin-credentials", { seed: 1 });
    const workers = countingWorkerFactory();
    // job 1 (read) finds nothing, job 2 (creation) sets and reads back
    await initCredentialKey({ env: {}, workerEntry: sandbox.workerEntry, workerFactory: workers.factory });
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", created: true });
    // a later process resolves the same key with a read
    _resetCredentialKeyForTests();
    await initCredentialKey({ env: {}, workerEntry: sandbox.workerEntry });
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", created: false });

    const log = sandbox.log();
    const news = log.filter((e) => e.op === "new");
    expect(news.length).toBeGreaterThanOrEqual(3);
    for (const e of news) {
      expect(e.service).toBe("pi-dashboard-credential-key");
      expect(e.account).toBe("data-key-v1");
      expect(e.options).toEqual({ linux: { store: "secret-service" } });
    }
    expect(log.filter((e) => e.op === "set")).toHaveLength(1);
    expect(workers.count).toBe(2); // read job, creation job; one Worker per job
    await workers.reap();
    // the stored value is a valid 32-byte base64 key
    const stored = Object.values(JSON.parse(fs.readFileSync(sandbox.storeFile, "utf8")))[0] as string;
    expect(Buffer.from(stored, "base64")).toHaveLength(32);
    expect(stored).toBe(b64(Buffer.from(stored, "base64")));
  });

  it("round trip: an existing key written by the fake keychain is read back by the real worker", async () => {
    sandbox = createKeyringSandbox();
    setEnv(sandbox.env);
    fs.writeFileSync(sandbox.storeFile, JSON.stringify({ "pi-dashboard-credential-key/data-key-v1": b64(KEY_1) }));
    writeEnvelopeFile("vault", { a: 1 }, KEY_1);
    await initCredentialKey({ env: {}, workerEntry: sandbox.workerEntry });
    expect(getCredentialKeyState()).toMatchObject({ state: "ready", created: false });
    expect(sandbox.log().filter((e) => e.op === "set")).toHaveLength(0);
  });
});
