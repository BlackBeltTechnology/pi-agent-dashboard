/**
 * Supervised-mode wiring between the bridge and the server (design D4, D12).
 *
 * - `restore` (session_start, every reason): restores the last `supervised-mode`
 *   session entry for THAT session id before any tool call; no entry → the
 *   configured default (never the previous session's mode); a read failure or a
 *   malformed entry fails CLOSED (Supervised + a log line).
 * - `onSetSupervised`: the server → bridge `set_supervised {on, rev?}` control message.
 *   Applies the value, appends the session entry and reports `supervised_state`. A flip
 *   never touches a pending approval. Malformed payloads are ignored.
 * - `registrationFields` / `reportIfChanged`: `{on, rev}` + `toolGateOwner` on the session
 *   registration, re-reported via `supervised_state` when either changes later.
 *
 * Reconcile (higher `rev` wins) is the SERVER's rule; the bridge applies what it is sent.
 * See change: add-supervised-tool-approval.
 */
import { type ToolGateOwner, toolGateOwner } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import { parseSetSupervised } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/supervised-mode.js";
import type { SupervisedModeStore } from "./mode-store.js";

/** `pi.appendEntry` custom type holding `{ on, rev }`. */
export const MODE_ENTRY = "supervised-mode";

export interface SupervisedModeControlDeps {
  modes: SupervisedModeStore;
  getSessionId: () => string;
  /** `pi.appendEntry(type, data)`. */
  appendEntry: (type: string, data: unknown) => void;
  /** Non-buffering-or-buffering send toward the server (`connection.send`). */
  send: (msg: { type: "supervised_state"; sessionId: string; on: boolean; rev: number; toolGateOwner?: ToolGateOwner }) => void;
  /** Owner slot read (default: the shared `toolGateOwner`). */
  getOwner?: (sessionId: string) => ToolGateOwner | undefined;
  log: (line: string) => void;
}

export interface SupervisedRegistrationFields {
  supervised: { on: boolean; rev: number };
  toolGateOwner?: ToolGateOwner;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createSupervisedModeControl(deps: SupervisedModeControlDeps) {
  const { modes } = deps;
  const getOwner = deps.getOwner ?? toolGateOwner;
  /** Last `{on,rev,owner}` the server was told, per session id. */
  const reported = new Map<string, string>();

  const fieldsFor = (sid: string): SupervisedRegistrationFields => {
    const owner = getOwner(sid);
    return { supervised: { on: modes.get(sid), rev: modes.rev(sid) }, ...(owner ? { toolGateOwner: owner } : {}) };
  };
  const keyOf = (f: SupervisedRegistrationFields): string => `${f.supervised.on}:${f.supervised.rev}:${f.toolGateOwner ?? ""}`;

  function report(sid: string): void {
    const f = fieldsFor(sid);
    reported.set(sid, keyOf(f));
    deps.send({ type: "supervised_state", sessionId: sid, on: f.supervised.on, rev: f.supervised.rev, ...(f.toolGateOwner ? { toolGateOwner: f.toolGateOwner } : {}) });
  }

  return {
    /** `session_start`: restore the session's own mode (see module doc). Never throws. */
    restore(sessionId: string, readEntries: () => readonly unknown[]): void {
      try {
        modes.clear(sessionId);
        let last: { data?: unknown } | undefined;
        for (const e of readEntries()) {
          const entry = e as { type?: unknown; customType?: unknown; data?: unknown } | null;
          if (entry?.type === "custom" && entry.customType === MODE_ENTRY) last = entry;
        }
        if (!last) return; // no entry → the configured default (resolved by the store)
        const d = last.data as { on?: unknown; rev?: unknown } | null | undefined;
        if (typeof d?.on !== "boolean") throw new Error("malformed supervised-mode entry");
        const rev = typeof d.rev === "number" && Number.isInteger(d.rev) && d.rev >= 0 ? d.rev : 0;
        modes.set(sessionId, d.on, rev);
      } catch (err) {
        modes.set(sessionId, true, 0); // fail CLOSED: never silently Full
        deps.log(`[supervised] mode restore failed: ${errText(err)}`);
      }
    },

    /** Server → bridge `set_supervised`; malformed → ignored (mode kept). */
    onSetSupervised(msg: unknown): void {
      const parsed = parseSetSupervised(msg);
      if (!parsed) {
        deps.log("[supervised] ignored malformed set_supervised");
        return;
      }
      const sid = deps.getSessionId();
      const rev = modes.set(sid, parsed.on, parsed.rev);
      try {
        deps.appendEntry(MODE_ENTRY, { on: parsed.on, rev });
      } catch (err) {
        deps.log(`[supervised] supervised-mode entry failed: ${errText(err)}`);
      }
      report(sid);
    },

    /** Fields for `session_register`; records them as what the server knows. */
    registrationFields(sessionId: string): SupervisedRegistrationFields {
      const f = fieldsFor(sessionId);
      reported.set(sessionId, keyOf(f));
      return f;
    },

    /** Re-report when `{on, rev, owner}` moved since the registration / last report. Never throws. */
    reportIfChanged(): void {
      try {
        const sid = deps.getSessionId();
        const prev = reported.get(sid);
        if (prev === undefined) return; // not registered yet — the registration carries it
        if (keyOf(fieldsFor(sid)) !== prev) report(sid);
      } catch (err) {
        deps.log(`[supervised] state report failed: ${errText(err)}`);
      }
    },

    /** `session_shutdown`. */
    clear(sessionId: string): void {
      reported.delete(sessionId);
    },
  };
}

export type SupervisedModeControl = ReturnType<typeof createSupervisedModeControl>;
