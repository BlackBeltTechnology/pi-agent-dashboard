/**
 * Bridge half of the gate↔server grant link (D3).
 *
 *  - `handleIdentity`: on every `dashboard_identity { grantStoreId }` frame,
 *    compare against the local `~/.pi/dashboard/grant-store-id` token (re-read
 *    each time) and remember whether the connected server writes the very store
 *    the gate reads. Missing frame / local file / mismatch → "Always allow"
 *    is not offered.
 *  - `requestGrant`: send `path_grant_request`, resolve on the matching
 *    `path_grant_result`. Never buffered or replayed; unsent / closed / late →
 *    `ok:false` (the call then runs once, not saved).
 * See change: ask-agent-file-access-in-chat.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";

const GRANT_STORE_ID_FILE = nodePath.join(os.homedir(), ".pi", "dashboard", "grant-store-id");
const GRANT_REQUEST_TIMEOUT_MS = 10_000;

export interface GrantLinkDeps {
  /** Sends on the OPEN socket; `false` = not sent. */
  send: (msg: unknown) => boolean;
  sessionId: () => string;
  readLocalToken?: () => string | null;
  timeoutMs?: number;
  newId?: () => string;
}

export interface GrantLink {
  handleIdentity(msg: { grantStoreId?: unknown }): void;
  handleResult(msg: { requestId?: unknown; ok?: unknown; subject?: unknown; error?: unknown }): void;
  /** True when the last identity frame's token equals the local token file. */
  storeMatches(): boolean;
  requestGrant(req: { promptId: string; path: string; subject: string }): Promise<{ ok: boolean; subject?: string; error?: string }>;
  /** Socket closed: fail pending requests and forget the identity. */
  reset(error?: string): void;
}

function readLocalGrantStoreId(file = GRANT_STORE_ID_FILE): string | null {
  try {
    const v = fs.readFileSync(file, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

export function createGrantLink(deps: GrantLinkDeps): GrantLink {
  const readLocal = deps.readLocalToken ?? (() => readLocalGrantStoreId());
  const timeoutMs = deps.timeoutMs ?? GRANT_REQUEST_TIMEOUT_MS;
  const newId = deps.newId ?? randomUUID;
  let match = false;
  const pending = new Map<string, { resolve: (r: { ok: boolean; subject?: string; error?: string }) => void; timer: ReturnType<typeof setTimeout> }>();

  const settle = (id: string, r: { ok: boolean; subject?: string; error?: string }): void => {
    const e = pending.get(id);
    if (!e) return;
    pending.delete(id);
    clearTimeout(e.timer);
    e.resolve(r);
  };

  return {
    handleIdentity(msg) {
      const remote = typeof msg.grantStoreId === "string" ? msg.grantStoreId : "";
      const local = readLocal();
      match = remote !== "" && local !== null && remote === local;
    },
    handleResult(msg) {
      if (typeof msg.requestId !== "string") return;
      settle(msg.requestId, {
        ok: msg.ok === true,
        ...(typeof msg.subject === "string" ? { subject: msg.subject } : {}),
        ...(typeof msg.error === "string" ? { error: msg.error } : {}),
      });
    },
    storeMatches: () => match,
    requestGrant(req) {
      return new Promise((resolve) => {
        const requestId = newId();
        const timer = setTimeout(() => settle(requestId, { ok: false, error: "timeout" }), timeoutMs);
        timer.unref?.();
        pending.set(requestId, { resolve, timer });
        let sent = false;
        try {
          sent = deps.send({
            type: "path_grant_request",
            requestId,
            sessionId: deps.sessionId(),
            promptId: req.promptId,
            path: req.path,
            subject: req.subject,
          });
        } catch {
          sent = false;
        }
        if (!sent) settle(requestId, { ok: false, error: "dashboard not connected" });
      });
    },
    reset(error = "disconnected") {
      match = false;
      for (const id of [...pending.keys()]) settle(id, { ok: false, error });
    },
  };
}
