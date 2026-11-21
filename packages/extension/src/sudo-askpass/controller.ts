/**
 * Bridge half of the sudo credential prompt.
 *
 * Observes `dashboard_identity` (modelled on `vault-delivery.ts` `handleIdentity`)
 * and, while the server advertises `sudo-credential`, the setting is on, the
 * platform is not win32 and the operator set no `SUDO_ASKPASS` of their own,
 * installs the askpass wrapper and points `process.env.SUDO_ASKPASS` at it. The
 * helper asks over a unix socket; the bridge applies the anti-accident gate (a
 * bash / `user_bash` call in flight, one pending prompt, not Cancel-blocked,
 * server connected), consults the per-session cache, otherwise asks the operator
 * through the server relay and delivers the answer to the helper.
 *
 * Never logged or thrown: the password. Log lines carry type + callId only.
 *
 * See change: add-sudo-credential-prompt (D3, D4, D7, D9, D10).
 */

import { randomBytes } from "node:crypto";
import type net from "node:net";
import os from "node:os";
import type {
  SudoCredentialCacheMessage,
  SudoCredentialDismissMessage,
  SudoCredentialRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import {
  parseSudoCredentialPrompt,
  SUDO_CREDENTIAL_FEATURE,
  SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH,
  type SudoCredentialPromptConfig,
} from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";
import type { BashOperationsLike } from "../vault-redaction.js";
import { createInFlightTracker } from "./in-flight.js";
import { installAskpass, type InstalledAskpass } from "./install.js";
import { createInvocationCounters, createPasswordCache } from "./password-cache.js";
import { buildPromptDisplay } from "./prompt-text.js";
import { SUDO_HELPER_MAX_REQUEST_BYTES, SUDO_HELPER_OK_MAGIC, SUDO_HELPER_REFUSE } from "./protocol.js";
import { registerSudoPassword } from "./sudo-mask-registry.js";

type SudoOutbound = SudoCredentialRequestMessage | SudoCredentialDismissMessage | SudoCredentialCacheMessage;

/** sudo's default `passwd_tries`: the invocation at this ordinal is the last one sudo will make. */
const SUDO_FINAL_INVOCATION = 3;
const HELPER_REQUEST_READ_TIMEOUT_MS = 5_000;
const COUNTER_WINDOW_FALLBACK_MINUTES = 5;

export interface SudoAskpassDeps {
  /** Send on the OPEN server socket; false = not sent. */
  send: (msg: SudoOutbound) => boolean;
  sessionId: () => string;
  isConnected: () => boolean;
  /** Re-read on every decision, so a Settings change applies live (G6). Clamped here. */
  readConfig: () => SudoCredentialPromptConfig;
  /** Seam for the vault-masker registry (D7 C); defaults to the real one. */
  registerPassword?: (value: string) => void;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  tmpdir?: string;
  execPath?: string;
  mkdtemp?: (prefix: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface SudoAskpass {
  /** Observes `dashboard_identity` (returns false) and consumes `sudo_credential_response|cancel|forget`. */
  onServerMessage(msg: unknown): boolean;
  onOpen(): void;
  /** Server connection lost: withdraw, zero the cache, dismiss any pending prompt. */
  onClose(): void;
  /** Re-evaluate the install predicate against the live setting (also runs on identity and each helper request). */
  reconcile(): void;
  toolExecutionStart(event: { toolCallId?: unknown; toolName?: unknown; args?: unknown }): void;
  toolExecutionEnd(event: { toolCallId?: unknown; toolName?: unknown }): void;
  /** Wrap `user_bash` operations with the in-flight tracker. */
  trackUserBash(ops: BashOperationsLike): BashOperationsLike;
  /** True while our wrapper is installed (D9); drives `userBash({ always })`. */
  featureInstalled(): boolean;
  /** `session_shutdown`: withdraw everything we installed. */
  shutdown(): void;
  /** Resolves when no install is in flight (tests, orderly teardown). */
  whenIdle(): Promise<void>;
  wrapperPath(): string | undefined;
  socketPath(): string | undefined;
  /** Test seams: state sizes, never values the production path would not hold anyway. */
  debug: {
    cacheBuffer(): Buffer | undefined;
    cacheExpiresAt(): number | null;
    counterSize(): number;
    pendingCallId(): string | undefined;
  };
}

interface Pending {
  callId: string;
  sock: net.Socket;
  /** Helper invocation ordinal for its (self-reported) sudo pid. */
  invocation: number;
  timer: ReturnType<typeof setTimeout>;
}

const sockAlive = (s: net.Socket): boolean => !s.destroyed && s.writable;

export function createSudoAskpass(deps: SudoAskpassDeps): SudoAskpass {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const register = deps.registerPassword ?? registerSudoPassword;
  const log = (line: string): void => deps.log?.(line);

  let featureSupported = false;
  let installed: InstalledAskpass | undefined;
  let installing: Promise<void> | undefined;
  let pending: Pending | undefined;
  /** Tool-call ids a sticky Cancel covers; pruned as they end. */
  const covered = new Set<string>();
  const counters = createInvocationCounters();
  const tracker = createInFlightTracker((id, remaining) => {
    covered.delete(id);
    if (remaining === 0 && pending) dismissPending("call-ended");
  });
  const cache = createPasswordCache({
    onChange: (expiresAt) => {
      deps.send({ type: "sudo_credential_cache", sessionId: deps.sessionId(), expiresAt });
    },
  });

  const config = (): SudoCredentialPromptConfig => {
    try {
      return parseSudoCredentialPrompt(deps.readConfig());
    } catch {
      return parseSudoCredentialPrompt(undefined);
    }
  };

  const refuse = (sock: net.Socket): void => {
    if (!sockAlive(sock)) return;
    sock.end(SUDO_HELPER_REFUSE);
  };

  const deliver = (sock: net.Socket, password: Buffer): void => {
    if (!sockAlive(sock)) return;
    const framed = Buffer.concat([SUDO_HELPER_OK_MAGIC, password, Buffer.from("\n")]);
    sock.write(framed, () => {
      framed.fill(0);
      sock.end();
    });
  };

  const clearPendingState = (): Pending | undefined => {
    const p = pending;
    if (!p) return undefined;
    clearTimeout(p.timer);
    pending = undefined;
    return p;
  };

  /** Bridge-initiated end of the pending prompt: browsers are dismissed, the helper exits 1. */
  function dismissPending(why: string): void {
    const p = clearPendingState();
    if (!p) return;
    log(`[sudo-askpass] dismiss callId=${p.callId} (${why})`);
    deps.send({ type: "sudo_credential_dismiss", sessionId: deps.sessionId(), callId: p.callId });
    refuse(p.sock);
  }

  const withdraw = (): void => {
    dismissPending("withdrawn");
    cache.clear();
    counters.clear();
    covered.clear();
    const inst = installed;
    if (!inst) return;
    installed = undefined;
    if (env.SUDO_ASKPASS === inst.wrapperPath) delete env.SUDO_ASKPASS; // only if still ours
    inst.close();
    process.off("exit", exitCleanup);
    log("[sudo-askpass] withdrawn");
  };
  /** Best-effort directory removal when the process exits without a shutdown. */
  const exitCleanup = (): void => {
    installed?.close();
  };

  const want = (): boolean => platform !== "win32" && featureSupported && config().enabled;

  const operatorPreset = (): boolean => {
    const v = env.SUDO_ASKPASS;
    return typeof v === "string" && v.length > 0;
  };

  const runInstall = async (): Promise<void> => {
    const result = await installAskpass({
      platform,
      tmpdir: deps.tmpdir ?? os.tmpdir(),
      execPath: deps.execPath ?? process.execPath,
      mkdtemp: deps.mkdtemp,
      onConnection: onHelperConnection,
    });
    if (!result.ok) {
      log(`[sudo-askpass] install aborted: ${result.reason}`);
      return;
    }
    // The identity may have flapped, or the setting flipped, while we were installing.
    if (!want() || operatorPreset()) {
      result.value.close();
      return;
    }
    installed = result.value;
    env.SUDO_ASKPASS = installed.wrapperPath;
    process.once("exit", exitCleanup);
    log("[sudo-askpass] installed");
  };

  const reconcile = (): void => {
    const wanted = want();
    if (!wanted) {
      if (installed) withdraw();
      return;
    }
    if (installed || installing !== undefined) return;
    if (operatorPreset()) return; // a local override (or a parent pi's wrapper) is never touched
    installing = runInstall()
      .catch(() => log("[sudo-askpass] install aborted: error"))
      .finally(() => {
        installing = undefined; // a failed install is retried by the next identity, never in a loop
      });
  };

  // ---- helper requests -------------------------------------------------

  /** Anti-accident gate (D7): not security, it stops stray or mistaken requests. */
  const gateOpen = (): boolean => {
    if (!installed || !deps.isConnected()) return false;
    const inFlight = tracker.list();
    if (inFlight.length === 0) return false;
    if (pending) return false;
    return !inFlight.every((e) => covered.has(e.id)); // every in-flight call covered by a sticky Cancel
  };

  function onHelperConnection(sock: net.Socket): void {
    sock.on("error", () => {});
    sock.setTimeout(HELPER_REQUEST_READ_TIMEOUT_MS, () => sock.destroy());
    let buf: Buffer = Buffer.alloc(0);
    let handled = false;
    sock.on("data", (chunk: Buffer) => {
      if (handled) return;
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(10);
      if (nl < 0) {
        if (buf.length > SUDO_HELPER_MAX_REQUEST_BYTES) {
          handled = true;
          refuse(sock);
        }
        return;
      }
      handled = true;
      sock.setTimeout(0);
      let req: { promptText?: unknown; ppid?: unknown } | undefined;
      try {
        req = JSON.parse(buf.subarray(0, nl).toString("utf8"));
      } catch {
        req = undefined;
      }
      if (!req || typeof req !== "object") return refuse(sock);
      handleHelperRequest(sock, typeof req.promptText === "string" ? req.promptText : "", req.ppid);
    });
    sock.on("close", () => {
      if (pending?.sock === sock) dismissPending("helper-closed");
    });
  }

  /** Caching turned off live: nothing cached may be served. */
  const clearCacheIfDisabled = (cfg: SudoCredentialPromptConfig): void => {
    if (cfg.cacheMinutes === 0) cache.clear();
  };

  function handleHelperRequest(sock: net.Socket, promptText: string, ppid: unknown): void {
    reconcile(); // a live disable must beat a request that raced it
    if (!gateOpen()) return refuse(sock);
    const cfg = config();
    clearCacheIfDisabled(cfg);
    const windowMs = (cfg.cacheMinutes > 0 ? cfg.cacheMinutes : COUNTER_WINDOW_FALLBACK_MINUTES) * 60_000;
    const invocation = counters.bump(ppid, windowMs);
    // A repeat helper call for the same sudo pid means sudo rejected the previous password.
    if (invocation >= 2) cache.clear();
    const cached = invocation === 1 ? cache.get() : undefined;
    if (cached) return deliver(sock, cached);

    const callId = randomBytes(16).toString("hex");
    const { prompt, promptTruncated } = buildPromptDisplay(promptText);
    pending = {
      callId,
      sock,
      invocation,
      timer: setTimeout(() => {
        // Not sticky (G4): sudo's three-attempt budget bounds repeats.
        if (pending?.callId === callId) dismissPending("timeout");
      }, cfg.timeoutMs),
    };
    pending.timer.unref?.();
    const sent = deps.send({
      type: "sudo_credential_request",
      sessionId: deps.sessionId(),
      callId,
      commands: tracker.list().map((e) => e.command),
      prompt,
      ...(promptTruncated ? { promptTruncated } : {}),
    });
    if (!sent) {
      clearPendingState();
      refuse(sock);
    }
  }

  // ---- operator answers ------------------------------------------------

  const onResponse = (m: { sessionId?: unknown; callId?: unknown; password?: unknown }): void => {
    reconcile(); // a live disable must beat an answer that raced it: withdraws (dismissing the pending prompt) before anything is accepted
    const p = pending;
    if (!p || m.callId !== p.callId || m.sessionId !== deps.sessionId()) return; // late / stray / replayed: dropped
    if (!sockAlive(p.sock)) {
      dismissPending("helper-closed");
      return;
    }
    const pw = m.password;
    // Defensive (G5): empty / over-long is never registered, cached or delivered; the prompt stays pending.
    if (typeof pw !== "string" || pw.length < 1 || pw.length > SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH) return;

    register(pw); // D7 C: before delivery and before caching, also when caching is off
    clearPendingState();
    const bytes = Buffer.from(pw, "utf8");
    const cfg = config();
    // The last sudo invocation's entry could not be cleared if wrong, so it is not cached (D3).
    if (cfg.cacheMinutes > 0 && p.invocation < SUDO_FINAL_INVOCATION) {
      cache.set(Buffer.from(bytes), cfg.cacheMinutes * 60_000);
    }
    deliver(p.sock, bytes);
    // `deliver` frames its own copy; ours is no longer needed.
    bytes.fill(0);
  };

  const onCancel = (m: { sessionId?: unknown; callId?: unknown; reason?: unknown }): void => {
    const p = pending;
    if (!p || m.callId !== p.callId || m.sessionId !== deps.sessionId()) return;
    // Operator Cancel (no reason) is sticky for the calls in flight now; a relay refusal is not.
    if (m.reason === undefined) for (const e of tracker.list()) covered.add(e.id);
    clearPendingState();
    log(`[sudo-askpass] ${m.reason === undefined ? "cancel" : "refused"} callId=${p.callId}`);
    refuse(p.sock);
  };

  return {
    onServerMessage(raw) {
      const msg = raw as { type?: unknown; features?: unknown; sessionId?: unknown } | null | undefined;
      switch (msg?.type) {
        case "dashboard_identity":
          featureSupported = Array.isArray(msg.features) && msg.features.includes(SUDO_CREDENTIAL_FEATURE);
          reconcile();
          return false; // observed, never consumed: other handlers still need it
        case "sudo_credential_response":
          onResponse(msg as Parameters<typeof onResponse>[0]);
          return true;
        case "sudo_credential_cancel":
          onCancel(msg as Parameters<typeof onCancel>[0]);
          return true;
        case "sudo_credential_forget":
          if (msg.sessionId === deps.sessionId()) cache.clear();
          return true;
        default:
          return false;
      }
    },
    onOpen() {},
    onClose() {
      featureSupported = false;
      withdraw();
    },
    reconcile,
    toolExecutionStart(e) {
      const command = (e.args as { command?: unknown } | null | undefined)?.command;
      if (e.toolName === "bash" && typeof e.toolCallId === "string" && typeof command === "string") {
        tracker.beginTool(e.toolCallId, command);
      }
    },
    toolExecutionEnd(e) {
      if (e.toolName === "bash" && typeof e.toolCallId === "string") tracker.endTool(e.toolCallId);
    },
    trackUserBash: (ops) => tracker.wrapOperations(ops),
    featureInstalled: () => installed !== undefined,
    shutdown() {
      featureSupported = false;
      withdraw();
    },
    whenIdle: async () => {
      while (installing !== undefined) await installing;
    },
    wrapperPath: () => installed?.wrapperPath,
    socketPath: () => installed?.socketPath,
    debug: {
      cacheBuffer: () => cache.peek(),
      cacheExpiresAt: () => cache.expiresAt(),
      counterSize: () => counters.size(),
      pendingCallId: () => pending?.callId,
    },
  };
}
