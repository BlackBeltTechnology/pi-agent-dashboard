/**
 * Sudo credential relay — the server's in-memory road between a bridge's
 * `sudo_credential_request` and the operator's browser(s).
 *
 * Deliberately NOT the `QuestionStore` / `prompt_response` road: that road
 * persists and replays. This one holds only `{sessionId, callId, commands,
 * prompt, ack state}` for ONE pending prompt per session; the password is
 * forwarded browser → bridge from inside a single call frame and is never
 * stored, logged, put in the event store or replayed.
 *
 * Contract (design D5/D6/D9):
 *  - one pending slot per session, keyed `(sessionId, callId)`; a response,
 *    cancel or ack for anything else is dropped;
 *  - control-tier audience only (observe-tier sockets are never fan-out
 *    targets and their acks/answers are dropped);
 *  - first answer wins, every other recipient gets `sudo_credential_dismiss`;
 *  - refuse at once (`_cancel {reason:"unanswerable"}` to the bridge) when the
 *    bridge is untrusted, nobody can answer, or the fan-out reached nobody;
 *  - a recipient must ack (`_shown`) within the ack deadline, else refuse;
 *  - empty or over-long passwords are dropped, the prompt stays pending.
 *
 * Logs carry the event name + callId only: never command text, prompt text or
 * a password. See change: add-sudo-credential-prompt.
 */
import type {
  ServerToExtensionMessage,
  SudoCredentialCacheMessage,
  SudoCredentialDismissMessage,
  SudoCredentialRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type {
  ServerToBrowserMessage,
  SudoCredentialCancelBrowserMessage,
  SudoCredentialForgetBrowserMessage,
  SudoCredentialResponseBrowserMessage,
  SudoCredentialShownBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  SUDO_CREDENTIAL_ACK_DEADLINE_MS,
  SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH,
} from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";

/** An opaque browser socket: the relay only compares identity and hands it back to the seam. */
export type SudoSocket = object;

/** The browser gateway's side of the relay. */
export interface SudoBrowserSeam {
  /** Subscribers of `sessionId` that may answer (control tier, session owners). Observe-tier sockets are never returned. */
  audience(sessionId: string): SudoSocket[];
  /** Whether `socket` is at a tier that may receive/answer (used for replay to a joining socket). */
  canAnswer(socket: SudoSocket): boolean;
  /** One frame to one socket; false when it did not reach the wire (shed, not open). May throw. */
  send(socket: SudoSocket, msg: ServerToBrowserMessage): boolean;
}

export interface SudoCredentialRelayDeps {
  browsers: SudoBrowserSeam;
  /** One frame to the session's bridge; false when it is not connected. */
  sendToBridge(sessionId: string, msg: ServerToExtensionMessage): boolean;
  /** The remote-bridge trust predicate (`decideVaultTrust`): false ⇒ refuse at once. */
  isBridgeTrusted(sessionId: string): boolean;
  /** Override for tests; default `SUDO_CREDENTIAL_ACK_DEADLINE_MS`. */
  ackDeadlineMs?: number;
}

/** Browser → server frames the relay consumes. */
export type SudoBrowserMessage =
  | SudoCredentialResponseBrowserMessage
  | SudoCredentialCancelBrowserMessage
  | SudoCredentialForgetBrowserMessage
  | SudoCredentialShownBrowserMessage;

export interface SudoCredentialRelay {
  /** Bridge → server: a helper asks for a password. */
  handleRequest(sessionId: string, msg: SudoCredentialRequestMessage): void;
  /** Bridge → server: cache expiry metadata (never the password). */
  handleCache(sessionId: string, msg: SudoCredentialCacheMessage): void;
  /** Bridge → server: the pending prompt is gone (helper closed, tool call ended, timeout). */
  handleDismiss(sessionId: string, msg: SudoCredentialDismissMessage): void;
  /** Browser → server: response / cancel / forget / shown. Dispatches on `msg.type`. */
  handleBrowserMessage(socket: SudoSocket, msg: SudoBrowserMessage): void;
  /** A socket just subscribed: replay cache metadata and the pending request (never a password). */
  replayTo(socket: SudoSocket, sessionId: string): void;
  /** The session's bridge socket closed: dismiss the prompt, clear cache metadata. */
  onBridgeDisconnect(sessionId: string): void;
  /** The session ended: dismiss the prompt and forget everything about it. */
  forgetSession(sessionId: string): void;
  dispose(): void;
}

interface Pending {
  callId: string;
  commands: string[];
  prompt: string;
  promptTruncated?: number;
  /** Sockets that were sent the request (only these may ack). */
  recipients: Set<SudoSocket>;
  acked: boolean;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_CALL_ID_LENGTH = 128;
const CALL_ID_PATTERN = /^[\w+/=.-]+$/;

const isCallId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_CALL_ID_LENGTH && CALL_ID_PATTERN.test(v);

export function createSudoCredentialRelay(deps: SudoCredentialRelayDeps): SudoCredentialRelay {
  const { browsers } = deps;
  const ackDeadlineMs = deps.ackDeadlineMs ?? SUDO_CREDENTIAL_ACK_DEADLINE_MS;
  const pending = new Map<string, Pending>();
  /** Cache metadata per session; `null` = nothing cached (kept so a late joiner is told). */
  const cache = new Map<string, number | null>();

  /** Event name + callId only: the log must never carry command text, prompt text or a password. */
  const log = (event: string, callId?: string): void => {
    console.log(`[sudo-credential] ${event}${callId ? ` callId=${callId}` : ""}`);
  };

  const safeSend = (socket: SudoSocket, msg: ServerToBrowserMessage): boolean => {
    try {
      return browsers.send(socket, msg) !== false;
    } catch {
      return false;
    }
  };

  const toBridge = (sessionId: string, msg: ServerToExtensionMessage): void => {
    try {
      deps.sendToBridge(sessionId, msg);
    } catch {
      /* a bridge that cannot be reached has nothing further to receive */
    }
  };

  const dismissFrame = (sessionId: string, callId: string): ServerToBrowserMessage => ({
    type: "sudo_credential_dismiss",
    sessionId,
    callId,
  });

  /** Free the slot (timer included) and return it, or undefined. */
  const take = (sessionId: string): Pending | undefined => {
    const slot = pending.get(sessionId);
    if (!slot) return undefined;
    clearTimeout(slot.timer);
    pending.delete(sessionId);
    return slot;
  };

  const dismissRecipients = (sessionId: string, slot: Pending, except?: SudoSocket): void => {
    for (const socket of slot.recipients) {
      if (socket !== except) safeSend(socket, dismissFrame(sessionId, slot.callId));
    }
  };

  /** Non-sticky refusal: the helper exits 1 at once; later prompts are unaffected. */
  const refuse = (sessionId: string, callId: string, cause: string): void => {
    log(`refused cause=${cause}`, callId);
    toBridge(sessionId, { type: "sudo_credential_cancel", sessionId, callId, reason: "unanswerable" });
  };

  const bound = (sessionId: unknown, callId: unknown): Pending | undefined => {
    if (typeof sessionId !== "string" || typeof callId !== "string") return undefined;
    const slot = pending.get(sessionId);
    return slot && slot.callId === callId ? slot : undefined;
  };

  const requestFrame = (sessionId: string, slot: Pending): ServerToBrowserMessage => ({
    type: "sudo_credential_request",
    sessionId,
    callId: slot.callId,
    commands: slot.commands,
    prompt: slot.prompt,
    ...(slot.promptTruncated !== undefined ? { promptTruncated: slot.promptTruncated } : {}),
  });

  const relay: SudoCredentialRelay = {
    handleRequest(sessionId, msg) {
      const callId = (msg as { callId?: unknown }).callId;
      if (!isCallId(callId) || !Array.isArray(msg.commands) || typeof msg.prompt !== "string") {
        log("request-malformed");
        return;
      }
      const existing = pending.get(sessionId);
      if (existing) {
        // A duplicate of the live prompt is ignored; a different call is refused (single slot).
        if (existing.callId !== callId) refuse(sessionId, callId, "slot-busy");
        return;
      }
      if (!deps.isBridgeTrusted(sessionId)) return refuse(sessionId, callId, "untrusted");
      const audience = browsers.audience(sessionId);
      if (audience.length === 0) return refuse(sessionId, callId, "no-audience");

      const slot: Pending = {
        callId,
        commands: msg.commands.filter((c): c is string => typeof c === "string"),
        prompt: msg.prompt,
        ...(typeof msg.promptTruncated === "number" ? { promptTruncated: msg.promptTruncated } : {}),
        recipients: new Set(),
        acked: false,
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
      };
      const frame = requestFrame(sessionId, slot);
      for (const socket of audience) {
        if (safeSend(socket, frame)) slot.recipients.add(socket);
      }
      if (slot.recipients.size === 0) return refuse(sessionId, callId, "fanout-failed");

      slot.timer = setTimeout(() => {
        const live = pending.get(sessionId);
        if (live !== slot || slot.acked) return;
        take(sessionId);
        dismissRecipients(sessionId, slot);
        refuse(sessionId, callId, "no-ack");
      }, ackDeadlineMs);
      slot.timer.unref?.();
      pending.set(sessionId, slot);
      log("request", callId);
    },

    handleCache(sessionId, msg) {
      const expiresAt = (msg as { expiresAt?: unknown }).expiresAt;
      if (expiresAt !== null && !(typeof expiresAt === "number" && Number.isFinite(expiresAt))) return;
      cache.set(sessionId, expiresAt);
      log("cache");
      for (const socket of browsers.audience(sessionId)) {
        safeSend(socket, { type: "sudo_credential_cache", sessionId, expiresAt });
      }
    },

    handleDismiss(sessionId, msg) {
      const slot = bound(sessionId, (msg as { callId?: unknown }).callId);
      if (!slot) return;
      take(sessionId);
      dismissRecipients(sessionId, slot);
      log("dismissed", slot.callId);
    },

    handleBrowserMessage(socket, msg) {
      switch (msg.type) {
        case "sudo_credential_response": {
          const slot = bound(msg.sessionId, msg.callId);
          const password: unknown = msg.password;
          if (
            !slot ||
            typeof password !== "string" ||
            password.length === 0 ||
            password.length > SUDO_CREDENTIAL_MAX_PASSWORD_LENGTH
          ) {
            return;
          }
          // Trust may have been lost since the prompt started (e.g. bearer-exposed) while the
          // socket stayed open: re-check right before the password would be forwarded.
          if (!deps.isBridgeTrusted(msg.sessionId)) {
            take(msg.sessionId);
            dismissRecipients(msg.sessionId, slot);
            refuse(msg.sessionId, slot.callId, "untrusted");
            return;
          }
          take(msg.sessionId);
          toBridge(msg.sessionId, {
            type: "sudo_credential_response",
            sessionId: msg.sessionId,
            callId: slot.callId,
            password,
          });
          dismissRecipients(msg.sessionId, slot, socket);
          log("answered", slot.callId);
          return;
        }
        case "sudo_credential_cancel": {
          const slot = bound(msg.sessionId, msg.callId);
          if (!slot) return;
          take(msg.sessionId);
          // Operator Cancel: no `reason` (sticky on the bridge), unlike the refusal.
          toBridge(msg.sessionId, { type: "sudo_credential_cancel", sessionId: msg.sessionId, callId: slot.callId });
          dismissRecipients(msg.sessionId, slot, socket);
          log("cancelled", slot.callId);
          return;
        }
        case "sudo_credential_forget": {
          if (typeof msg.sessionId !== "string") return;
          toBridge(msg.sessionId, { type: "sudo_credential_forget", sessionId: msg.sessionId });
          log("forget");
          return;
        }
        case "sudo_credential_shown": {
          const slot = bound(msg.sessionId, msg.callId);
          // Only a socket that was sent the request can vouch that a client renders it.
          if (!slot || !slot.recipients.has(socket)) return;
          slot.acked = true;
          clearTimeout(slot.timer);
          return;
        }
      }
    },

    replayTo(socket, sessionId) {
      if (!browsers.canAnswer(socket)) return;
      if (cache.has(sessionId)) {
        safeSend(socket, { type: "sudo_credential_cache", sessionId, expiresAt: cache.get(sessionId) ?? null });
      }
      const slot = pending.get(sessionId);
      if (slot && !slot.recipients.has(socket) && safeSend(socket, requestFrame(sessionId, slot))) {
        slot.recipients.add(socket);
      }
    },

    onBridgeDisconnect(sessionId) {
      const slot = take(sessionId);
      if (slot) {
        dismissRecipients(sessionId, slot);
        log("dismissed", slot.callId);
      }
      if (cache.get(sessionId) != null) {
        cache.set(sessionId, null);
        for (const socket of browsers.audience(sessionId)) {
          safeSend(socket, { type: "sudo_credential_cache", sessionId, expiresAt: null });
        }
      }
    },

    forgetSession(sessionId) {
      const slot = take(sessionId);
      if (slot) dismissRecipients(sessionId, slot);
      cache.delete(sessionId);
    },

    dispose() {
      for (const slot of pending.values()) clearTimeout(slot.timer);
      pending.clear();
      cache.clear();
    },
  };
  return relay;
}
