/**
 * Real server wiring of vault delivery: a hub-local bridge advertises the
 * `vault-delivery` feature, asks for its values with `vault_sync_request`, and
 * receives a rotation push without asking again.
 * See change: add-credential-vault (tasks 4.15, 4.16).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { _resetCredentialKeyForTests } from "../auth/credential-key.js";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";
import { createBinding } from "../vault/vault-bindings.js";
import { createGrant, dirSubject } from "../vault/vault-grants.js";
import { createVaultStore } from "../vault/vault-store.js";
import { b64, KEY_1, KEY_2, logSink, resetCredentialFiles, writeKeyFile } from "./helpers/credential-key-kit.js";
import { testVaultCodec } from "./helpers/vault-test-codec.js";

const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", gatewayTcp: true, dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};

/** `createServer`'s credential-key seam: the data key comes from a key file, never a keychain. */
const keyFileInit = (key: Buffer): NonNullable<ServerConfig["credentialKey"]> => ({
  env: { PI_DASHBOARD_DATA_KEY_FILE: writeKeyFile(b64(key)) },
  log: logSink().log,
});

describe("vault delivery wiring", () => {
  let server: DashboardServer;
  let tmp: string;
  let ws: WebSocket;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ew-vault-")));
    _resetCredentialKeyForTests();
    resetCredentialFiles(); // the default-path vault.json is shared by the tests of this file
  });
  afterEach(async () => {
    ws?.close();
    await server?.stop();
    _resetCredentialKeyForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("answers a sync request with the granted values, advertises the feature, and pushes a rotation", async () => {
    // Seed through a test codec over KEY_1; `createServer` resolves the same key itself, from a key file (no keychain).
    const store = createVaultStore({ codec: testVaultCodec(KEY_1) }); // default path: under the per-file tmp $HOME
    const acc = await store.addAccount({ provider: "gemini", label: "g", value: "gemini-key-001" });
    await createBinding(store, { name: "GEMINI_API_KEY", defaultAccountId: acc.id });
    await createGrant(store, { subject: dirSubject("hub", tmp), bindingName: "GEMINI_API_KEY" });

    server = await createServer({ ...baseConfig, credentialKey: keyFileInit(KEY_1) });
    await server.start();
    ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
    const frames: any[] = [];
    ws.on("message", (raw) => { try { frames.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "session_register", sessionId: "s1", cwd: tmp, source: "cli" }));
    // Registration is asynchronous; poll rather than guess a delay.
    await vi.waitFor(() => expect(frames.find((f) => f.type === "dashboard_identity")).toBeDefined(), { timeout: 5_000 });
    expect(frames.find((f) => f.type === "dashboard_identity")?.features).toContain("vault-delivery");

    ws.send(JSON.stringify({ type: "vault_sync_request", sessionId: "s1", cwd: tmp, tracked: [], reason: "connect" }));
    await vi.waitFor(() => expect(frames.some((f) => f.type === "vault_snapshot")).toBe(true), { timeout: 5_000 });
    const first = frames.filter((f) => f.type === "vault_snapshot").at(-1);
    expect(first).toMatchObject({ status: "ok", outcome: "delivered", entries: [{ name: "GEMINI_API_KEY", value: "gemini-key-001" }] });

    // Rotate through the management route (loopback = locally trusted): the
    // server's own store fires the push.
    const res = await proofFetch(`http://127.0.0.1:${server.httpPort()}/api/vault/accounts/${acc.id}/value`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "rotated-key-0001" }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(frames.filter((f) => f.type === "vault_snapshot").at(-1)?.entries?.[0]?.value).toBe("rotated-key-0001"), { timeout: 5_000 });
    const pushed = frames.filter((f) => f.type === "vault_snapshot").at(-1);
    expect(pushed.entries).toEqual([{ name: "GEMINI_API_KEY", value: "rotated-key-0001" }]);
  });
  it("X26: a locked vault delivers nothing: vault-unavailable, no value in the frame", async () => {
    // Seeded under key B, while the process holds key A: the server sees a locked (key_mismatch) vault.
    const seed = createVaultStore({ codec: testVaultCodec(KEY_2) });
    const acc = await seed.addAccount({ provider: "gemini", label: "g", value: "gemini-key-001" });
    await createBinding(seed, { name: "GEMINI_API_KEY", defaultAccountId: acc.id });
    await createGrant(seed, { subject: dirSubject("hub", tmp), bindingName: "GEMINI_API_KEY" });

    server = await createServer({ ...baseConfig, credentialKey: keyFileInit(KEY_1) });
    await server.start();
    ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
    const frames: any[] = [];
    ws.on("message", (raw) => { try { frames.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send(JSON.stringify({ type: "session_register", sessionId: "s1", cwd: tmp, source: "cli" }));
    await vi.waitFor(() => expect(frames.find((f) => f.type === "dashboard_identity")).toBeDefined(), { timeout: 5_000 });
    ws.send(JSON.stringify({ type: "vault_sync_request", sessionId: "s1", cwd: tmp, tracked: [], reason: "connect" }));
    await vi.waitFor(() => expect(frames.some((f) => f.type === "vault_snapshot")).toBe(true), { timeout: 5_000 });
    const snap = frames.filter((f) => f.type === "vault_snapshot").at(-1);
    expect(snap).toMatchObject({ status: "unavailable", outcome: "vault-unavailable" });
    expect(JSON.stringify(snap)).not.toContain("gemini-key-001");
    expect(snap.entries ?? []).toEqual([]);
  });
});
