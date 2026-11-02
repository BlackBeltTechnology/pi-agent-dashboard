/**
 * Server startup wiring of the credential data key (design D4, D7, D11): the key
 * is resolved and the plaintext files are migrated inside `createServer`, before
 * the vault store, the ACME runtime and the plugin load, and before `listen`.
 * Real `createServer`; the key comes from a key file (no keychain, D9).
 * See change: encrypt-credentials-at-rest (tasks 7.1, 7.3; test-plan X17, X19).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { deriveKid } from "../auth/credential-envelope.js";
import { _resetCredentialKeyForTests, getCredentialCodec, getCredentialKeyState } from "../auth/credential-key.js";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";
import {
  b64,
  filePath,
  KEY_1,
  KEY_2,
  logSink,
  resetCredentialFiles,
  writeEnvelopeFile,
  writeKeyFile,
  writePlain,
} from "./helpers/credential-key-kit.js";

const MAGIC = "pi-dashboard-encrypted:v1";
const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", gatewayTcp: true, dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};
const VAULT_DOC = (marker: string) => ({
  accounts: [{ id: "a1", provider: "gemini", kind: "key", namespace: "user", label: "startup", value: marker }],
  bindings: [{ name: "GEMINI_API_KEY", defaultAccountId: "a1" }],
});

describe("credential key startup wiring", () => {
  let server: DashboardServer | undefined;
  let ws: WebSocket | undefined;

  beforeEach(() => {
    _resetCredentialKeyForTests();
    resetCredentialFiles();
  });
  afterEach(async () => {
    ws?.close();
    ws = undefined;
    await server?.stop();
    server = undefined;
    _resetCredentialKeyForTests();
    vi.restoreAllMocks();
  });

  it("7.1/7.3: createServer resolves the key, then migrates both plaintext files, before it returns", async () => {
    writePlain("vault", VAULT_DOC("val-startup-0001"));
    writePlain("plugin-credentials", { demo: { k: { token: "tok-startup-0001" } } });
    const sink = logSink();
    server = await createServer({ ...baseConfig, credentialKey: { env: { PI_DASHBOARD_DATA_KEY_FILE: writeKeyFile(b64(KEY_1)) }, log: sink.log } });

    expect(getCredentialKeyState()).toMatchObject({ state: "ready", source: "key-file", kid: deriveKid(KEY_1) });
    for (const id of ["vault", "plugin-credentials"] as const) {
      expect(fs.readFileSync(filePath(id), "utf-8").startsWith(`${MAGIC}\n`)).toBe(true);
    }
    expect(getCredentialCodec("vault").decode(fs.readFileSync(filePath("vault")))).toMatchObject({ kind: "document", encrypted: true });
    expect(sink.lines).toEqual([
      `[credential-key] source=key-file state=ready kid=${deriveKid(KEY_1)} created=false`,
      "[credential-key] plugin-credentials.json state=encrypted",
      "[credential-key] vault.json state=encrypted",
    ]);
  });

  it("7.1: with no credential files createServer touches no keychain and writes no file", async () => {
    const sink = logSink();
    server = await createServer({ ...baseConfig, credentialKey: { env: {}, log: sink.log } });
    expect(getCredentialKeyState()).toMatchObject({ state: "deferred" });
    expect(fs.existsSync(filePath("vault"))).toBe(false);
    expect(fs.existsSync(filePath("plugin-credentials"))).toBe(false);
    expect(sink.lines[0]).toBe("[credential-key] source=keychain state=deferred created=false");
  });

  it("X19: a vault encrypted under A, running with B: one ready line (kid of B), one locked line, no marker or key", async () => {
    const marker = "val-X19-marker-0001";
    writeEnvelopeFile("vault", VAULT_DOC(marker), KEY_1);
    const before = fs.readFileSync(filePath("vault"));
    const sink = logSink();
    server = await createServer({ ...baseConfig, credentialKey: { env: { PI_DASHBOARD_DATA_KEY_FILE: writeKeyFile(b64(KEY_2)) }, log: sink.log } });

    const ready = sink.lines.filter((l) => /^\[credential-key\] source=\S+ state=ready\b/.test(l));
    expect(ready).toEqual([`[credential-key] source=key-file state=ready kid=${deriveKid(KEY_2)} created=false`]);
    expect(sink.lines).toContain("[credential-key] vault.json state=locked reason=key_mismatch");
    const all = sink.lines.join("\n");
    expect(all).not.toContain(marker);
    expect(all).not.toContain(b64(KEY_2));
    expect(all).not.toContain(KEY_2.toString("hex"));
    expect(fs.readFileSync(filePath("vault")).equals(before)).toBe(true); // locked: never rewritten
  });

  it("X17: the key never leaks (logs, health and vault HTTP bodies, bridge frames, process env)", async () => {
    const K = KEY_1;
    const forms = [K.toString("latin1"), K.toString("hex"), K.toString("base64"), K.toString("base64url")];
    const leaks = (text: string) => forms.filter((f) => text.includes(f));
    const logged: string[] = [];
    for (const m of ["log", "warn", "error", "info", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logged.push(args.map((a) => String(a)).join(" ")); });
    }
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ew-x17-")));
    try {
      writePlain("vault", {
        ...VAULT_DOC("val-X17-0000001"),
        grants: [{ id: "g1", subject: { kind: "dir", hubId: "hub", path: tmpDir }, bindingName: "GEMINI_API_KEY" }],
      });
      writePlain("plugin-credentials", { demo: { k: { token: "tok-X17-0000001" } } });
      server = await createServer({ ...baseConfig, credentialKey: { env: { PI_DASHBOARD_DATA_KEY_FILE: writeKeyFile(b64(K)) } } });
      await server.start();

      const bodies: string[] = [];
      for (const route of ["/api/health", "/api/vault"]) {
        const res = await proofFetch(`http://127.0.0.1:${server.httpPort()}${route}`);
        expect(res.status).toBe(200);
        bodies.push(await res.text());
      }
      ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
      const frames: string[] = [];
      ws.on("message", (raw) => { frames.push(String(raw)); });
      await new Promise<void>((resolve) => ws?.on("open", () => resolve()));
      ws.send(JSON.stringify({ type: "session_register", sessionId: "s1", cwd: tmpDir, source: "cli" }));
      await vi.waitFor(() => expect(frames.some((f) => f.includes("dashboard_identity"))).toBe(true), { timeout: 5_000 });
      ws.send(JSON.stringify({ type: "vault_sync_request", sessionId: "s1", cwd: tmpDir, tracked: [], reason: "connect" }));
      await vi.waitFor(() => expect(frames.some((f) => f.includes("vault_snapshot"))).toBe(true), { timeout: 5_000 });

      expect(leaks(logged.join("\n"))).toEqual([]);
      expect(leaks(bodies.join("\n"))).toEqual([]);
      expect(leaks(frames.join("\n"))).toEqual([]);
      // Children inherit `process.env`: it must not carry the key (only the key FILE path).
      expect(leaks(Object.values(process.env).join("\n"))).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
