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
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";
import { createBinding } from "../vault/vault-bindings.js";
import { createGrant, dirSubject } from "../vault/vault-grants.js";
import { createVaultStore } from "../vault/vault-store.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";

const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", gatewayTcp: true, dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};

describe("vault delivery wiring", () => {
  let server: DashboardServer;
  let tmp: string;
  let ws: WebSocket;

  beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ew-vault-"))); });
  afterEach(async () => {
    ws?.close();
    await server?.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("answers a sync request with the granted values, advertises the feature, and pushes a rotation", async () => {
    const store = createVaultStore(); // default path: under the per-file tmp $HOME
    const acc = await store.addAccount({ provider: "gemini", label: "g", value: "gemini-key-001" });
    await createBinding(store, { name: "GEMINI_API_KEY", defaultAccountId: acc.id });
    await createGrant(store, { subject: dirSubject("hub", tmp), bindingName: "GEMINI_API_KEY" });

    server = await createServer({ ...baseConfig });
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
});
