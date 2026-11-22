/**
 * Shared test harness for the sudo-askpass suites: a controller wired to a fake
 * server link (frames recorded, answers injected) and a direct unix-socket client
 * speaking the helper protocol. Real helper/wrapper processes are exercised in
 * sudo-askpass-helper.test.ts and sudo-askpass-install.test.ts.
 * See change: add-sudo-credential-prompt.
 */
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SUDO_CREDENTIAL_PROMPT,
  SUDO_CREDENTIAL_FEATURE,
  type SudoCredentialPromptConfig,
} from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";
import { createSudoAskpass, type SudoAskpass, type SudoAskpassDeps } from "../sudo-askpass/index.js";
import { SUDO_HELPER_OK_MAGIC } from "../sudo-askpass/protocol.js";

export const SESSION = "sess-1";

export interface HelperReply {
  ok: boolean;
  password?: string;
}

/** Speaks the helper protocol directly; resolves when the bridge closes the socket. */
export function askSocket(socketPath: string, promptText: string, ppid: number): Promise<HelperReply> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const conn = net.createConnection(socketPath);
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      const buf = Buffer.concat(chunks);
      const magic = SUDO_HELPER_OK_MAGIC;
      if (buf.length > magic.length && buf.subarray(0, magic.length).equals(magic)) {
        resolve({ ok: true, password: buf.subarray(magic.length).toString("utf8").replace(/\n$/, "") });
      } else resolve({ ok: false });
    };
    conn.on("connect", () => conn.write(`${JSON.stringify({ promptText, ppid })}\n`));
    conn.on("data", (d: Buffer) => chunks.push(d));
    conn.on("end", finish);
    conn.on("close", finish);
    conn.on("error", finish);
  });
}

/** Poll with real setImmediate (immune to fake timers) until `cond` holds. */
export async function pollUntil(cond: () => boolean, what = "condition"): Promise<void> {
  const deadline = process.hrtime.bigint() + 3_000_000_000n;
  while (!cond()) {
    if (process.hrtime.bigint() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((r) => setImmediate(r));
  }
}

/** Let queued socket I/O drain (for "nothing happened" assertions). */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

export interface Harness {
  ctl: SudoAskpass;
  env: NodeJS.ProcessEnv;
  cfg: SudoCredentialPromptConfig;
  frames: Array<Record<string, any>>;
  logs: string[];
  registered: string[];
  /** Mutable: flip to simulate the server link going away. */
  link: { connected: boolean; sendOk: boolean };
  tmp: string;
  install(features?: string[]): Promise<void>;
  /** Start a helper request; resolves with the reply once the bridge closes the socket. */
  ask(prompt?: string, ppid?: number): Promise<HelperReply>;
  requests(): Array<Record<string, any>>;
  cacheFrames(): Array<Record<string, any>>;
  respond(callId: string, password: unknown, sessionId?: string): void;
  cancel(callId: string, reason?: "unanswerable"): void;
  forget(): void;
  /** Start a bash tool call that stays in flight until `endTool`. */
  startTool(id: string, command: string): void;
  endTool(id: string): void;
  dispose(): void;
}

export function createHarness(opts: { cfg?: Partial<SudoCredentialPromptConfig>; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; deps?: Partial<SudoAskpassDeps> } = {}): Harness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sudo-h-"));
  const env: NodeJS.ProcessEnv = opts.env ?? {};
  const cfg: SudoCredentialPromptConfig = { ...DEFAULT_SUDO_CREDENTIAL_PROMPT, ...opts.cfg };
  const frames: Array<Record<string, any>> = [];
  const logs: string[] = [];
  const registered: string[] = [];
  const link = { connected: true, sendOk: true };
  const ctl = createSudoAskpass({
    send: (m) => {
      if (!link.sendOk) return false;
      frames.push(m as Record<string, any>);
      return true;
    },
    sessionId: () => SESSION,
    isConnected: () => link.connected,
    readConfig: () => cfg,
    registerPassword: (v) => registered.push(v),
    env,
    platform: opts.platform ?? "linux",
    tmpdir: tmp,
    log: (l) => logs.push(l),
    ...opts.deps,
  });
  const h: Harness = {
    ctl,
    env,
    cfg,
    frames,
    logs,
    registered,
    link,
    tmp,
    async install(features = [SUDO_CREDENTIAL_FEATURE]) {
      ctl.onServerMessage({ type: "dashboard_identity", features });
      await ctl.whenIdle();
    },
    ask: (prompt = "[sudo] password for u: ", ppid = 4242) => askSocket(ctl.socketPath() as string, prompt, ppid),
    requests: () => frames.filter((f) => f.type === "sudo_credential_request"),
    cacheFrames: () => frames.filter((f) => f.type === "sudo_credential_cache"),
    respond: (callId, password, sessionId = SESSION) => {
      ctl.onServerMessage({ type: "sudo_credential_response", sessionId, callId, password });
    },
    cancel: (callId, reason) => {
      ctl.onServerMessage({ type: "sudo_credential_cancel", sessionId: SESSION, callId, ...(reason ? { reason } : {}) });
    },
    forget: () => {
      ctl.onServerMessage({ type: "sudo_credential_forget", sessionId: SESSION });
    },
    startTool: (id, command) => ctl.toolExecutionStart({ toolCallId: id, toolName: "bash", args: { command } }),
    endTool: (id) => ctl.toolExecutionEnd({ toolCallId: id, toolName: "bash" }),
    dispose() {
      ctl.shutdown();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  return h;
}
