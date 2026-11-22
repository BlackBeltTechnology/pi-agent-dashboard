/**
 * Real-server rig for the sudo credential wiring tests: `createServer`, a stub
 * hub-local bridge (local credential proof, so `decideVaultTrust` passes) and
 * real browser `/ws` sockets, all collecting every frame they receive.
 * See change: add-sudo-credential-prompt.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRIDGE_PURPOSE, canonicalBinding, LOCAL_PROOF_HEADER, mintProof } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { expect, vi } from "vitest";
import { WebSocket } from "ws";
import { _resetCredentialKeyForTests } from "../../auth/credential-key.js";
import { readLocalTokenIfPresent } from "../../auth/local-token.js";
import { createServer, type DashboardServer, type ServerConfig } from "../../server.js";
import { proofWebSocket } from "../../test-support/local-credential-stamp.js";
import { b64, KEY_1, logSink, resetCredentialFiles, writeKeyFile } from "./credential-key-kit.js";

export type Frame = Record<string, any> & { type: string };

export interface Peer {
  ws: WebSocket;
  frames: Frame[];
  send(msg: Record<string, unknown>): void;
  /** Frames of the given type(s) received so far. */
  of(...types: string[]): Frame[];
  /** Resolve once a frame matching `pred` arrived. */
  waitFor(pred: (f: Frame) => boolean, timeout?: number): Promise<Frame>;
}

export interface SudoRig {
  server: DashboardServer;
  tmp: string;
  /** A registered, live stub bridge for `sessionId` (has received `dashboard_identity`). */
  bridge(sessionId: string, opts?: { unproven?: boolean }): Promise<Peer>;
  /** A browser socket, subscribed to `sessionId` when given. */
  browser(sessionId?: string): Promise<Peer>;
  dispose(): Promise<void>;
}

const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", gatewayTcp: true, dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function peer(ws: WebSocket): Peer {
  const frames: Frame[] = [];
  ws.on("message", (raw) => {
    try { frames.push(JSON.parse(String(raw))); } catch { /* ignore non-JSON */ }
  });
  return {
    ws,
    frames,
    send: (msg) => ws.send(JSON.stringify(msg)),
    of: (...types) => frames.filter((f) => types.includes(f.type)),
    waitFor: async (pred, timeout = 5_000) => {
      let found: Frame | undefined;
      await vi.waitFor(() => { found = frames.find(pred); expect(found).toBeDefined(); }, { timeout });
      return found as Frame;
    },
  };
}

const opened = (ws: WebSocket) => new Promise<void>((resolve) => ws.on("open", () => resolve()));

/** Boot a real server over an isolated tmp dir (callers must `dispose()`). */
export async function bootSudoRig(extra: Partial<ServerConfig> = {}): Promise<SudoRig> {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ew-sudo-")));
  _resetCredentialKeyForTests();
  resetCredentialFiles();
  const server = await createServer({
    ...baseConfig,
    credentialKey: { env: { PI_DASHBOARD_DATA_KEY_FILE: writeKeyFile(b64(KEY_1)) }, log: logSink().log },
    ...extra,
  });
  await server.start();
  const sockets: WebSocket[] = [];

  return {
    server,
    tmp,
    async bridge(sessionId, opts = {}) {
      // Hub vault trust needs LOCAL admission (a verified local credential proof), not just a loopback address;
      // an `unproven` bridge stands for a remote one that `decideVaultTrust` refuses.
      const proof = mintProof({
        token: readLocalTokenIfPresent() as string,
        binding: canonicalBinding("127.0.0.1", server.piPort() as number),
        purpose: BRIDGE_PURPOSE,
      });
      const ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`, opts.unproven ? {} : { headers: { [LOCAL_PROOF_HEADER]: proof.header } });
      sockets.push(ws);
      const p = peer(ws);
      await opened(ws);
      p.send({ type: "session_register", sessionId, cwd: tmp, source: "cli" });
      p.send({ type: "replay_complete", sessionId });
      // A live session in a tool call has events; subscribe replays pending state only for such a session.
      p.send({ type: "event_forward", sessionId, event: { eventType: "agent_start", timestamp: Date.now(), data: { type: "agent_start" } } });
      await p.waitFor((f) => f.type === "dashboard_identity");
      return p;
    },
    async browser(sessionId) {
      const ws = proofWebSocket(`ws://127.0.0.1:${server.httpPort()}/ws`);
      sockets.push(ws);
      const p = peer(ws);
      await opened(ws);
      if (sessionId) p.send({ type: "subscribe", sessionId });
      await settle();
      return p;
    },
    async dispose() {
      for (const s of sockets) s.close();
      await server.stop();
      _resetCredentialKeyForTests();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}
