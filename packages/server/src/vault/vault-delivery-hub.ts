/**
 * Hub half of vault env delivery.
 *
 * Per connected bridge session it keeps the last sync request (cwd, origin,
 * tracked names) and answers with the COMPLETE set of granted values: on every
 * sync request (connect + every `session_start` reason) and, debounced, on every
 * vault write and config change (push). A sync answer and a push are the same
 * message, so a missed push is reconciled by the next sync.
 *
 * Trust gate (D3): a session is delivered to only when it is hub-local, or a
 * remote paired device over TLS. The hub cannot verify TLS for a bridge today
 * (the gateway listener is plain `ws`; TLS terminates at a proxy), so `isTls`
 * defaults to false and remote delivery stays off until the gateway can prove it.
 *
 * Order of refusal: config switch first (it must work while the vault is
 * corrupt), then trust, then vault health, then the project.
 *
 * Nothing here logs a value. The per-session state view carries names and states.
 *
 * See change: add-credential-vault (D2, D3).
 */

import type { VaultReportMessage, VaultSnapshotMessage, VaultSyncRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { clampVaultGraceHours, type VaultDeliveryOutcome } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { normalizeOrigin, type SessionProject } from "@blackbelt-technology/pi-dashboard-shared/vault-project-key.js";
import { type SessionOrigin, UNATTRIBUTED_REMOTE } from "../session/session-origin.js";
import { type BindingState, buildDeliverySnapshot, resolveBindings } from "./vault-grants.js";
import type { VaultDocument, VaultStore } from "./vault-store.js";

export type VaultTrustDecision =
  | { allow: true; deviceId: string }
  | { allow: false; outcome: "untrusted" | "transport-insecure" };

/** The two ways a bridge connection can be trusted with values. */
export function decideVaultTrust(input: { origin: SessionOrigin; tls: boolean }): VaultTrustDecision {
  const { origin, tls } = input;
  if (origin.local) return { allow: true, deviceId: "hub" };
  if (!origin.deviceId || origin.deviceId === UNATTRIBUTED_REMOTE) return { allow: false, outcome: "untrusted" };
  if (!tls) return { allow: false, outcome: "transport-insecure" };
  return { allow: true, deviceId: origin.deviceId };
}

type SessionBindingRowState = BindingState | "delivered" | "local-override" | "inherited" | "revoked";

interface SessionBindingView {
  bindings: Array<{ name: string; state: SessionBindingRowState }>;
  /** Wall-clock ms of the last successful vault contact with this session. */
  lastContactAt?: number;
  outcome: VaultDeliveryOutcome;
  /** Present when the session resolved to a project; used to confirm a pending checkout. */
  project?: { deviceId: string; dir: string; repoKey?: string };
}

export interface VaultDeliveryHubDeps {
  store: VaultStore;
  /** Origin of a connected session, or undefined when unknown. */
  getOrigin: (sessionId: string) => SessionOrigin | undefined;
  /** Send to ONE session's bridge. Returns false when not connected. */
  send: (sessionId: string, msg: VaultSnapshotMessage) => boolean;
  /** Live read of the config-held master switch. */
  isDeliveryEnabled: () => boolean;
  /** Live read of the configured offline grace (hours); clamped here. */
  getGraceHours: () => number;
  /** Does the hub have proof this session's connection is TLS? Default: never. */
  isTls?: (sessionId: string) => boolean;
  now?: () => number;
  /** Debounce for change-driven pushes. Default 150 ms (well inside the 5 s budget). */
  pushDelayMs?: number;
}

export interface VaultDeliveryHub {
  handleSyncRequest(sessionId: string, msg: VaultSyncRequestMessage): Promise<VaultDeliveryOutcome>;
  handleReport(sessionId: string, msg: VaultReportMessage): void;
  /** Debounced recompute-and-send for every known session. */
  schedulePush(): void;
  /** Immediate recompute-and-send for every known session. */
  pushNow(): Promise<void>;
  getSessionState(sessionId: string): SessionBindingView | undefined;
  forget(sessionId: string): void;
  dispose(): void;
}

interface SessionRecord {
  cwd?: string;
  origin?: string;
  tracked: Set<string>;
  /** Names granted in the last `ok` snapshot we sent. */
  granted: Set<string>;
  revoked: Set<string>;
  reported: Map<string, "delivered" | "local-override" | "inherited">;
  lastContactAt?: number;
  outcome: VaultDeliveryOutcome;
  project?: SessionProject;
  states: Array<{ name: string; state: BindingState }>;
}

export function createVaultDeliveryHub(deps: VaultDeliveryHubDeps): VaultDeliveryHub {
  const now = deps.now ?? Date.now;
  const sessions = new Map<string, SessionRecord>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const snapshotMsg = (
    status: VaultSnapshotMessage["status"],
    outcome: VaultDeliveryOutcome,
    entries: VaultSnapshotMessage["entries"] = [],
  ): VaultSnapshotMessage => ({
    type: "vault_snapshot",
    status,
    outcome,
    entries,
    graceHours: clampVaultGraceHours(deps.getGraceHours()),
  });

  const withdraw = (rec: SessionRecord, outcome: VaultDeliveryOutcome): VaultSnapshotMessage => {
    rec.outcome = outcome;
    rec.project = undefined;
    rec.states = [];
    for (const n of rec.granted) rec.revoked.add(n);
    rec.granted = new Set();
    return snapshotMsg("denied", outcome);
  };

  /** Build the snapshot for a trusted session in a healthy vault. */
  const deliver = (rec: SessionRecord, doc: VaultDocument, deviceId: string): VaultSnapshotMessage => {
    if (!rec.cwd) return withdraw(rec, "no-project");
    const repoKey = rec.origin ? normalizeOrigin(rec.origin) : undefined;
    const project: SessionProject = { deviceId, dir: rec.cwd, repoKey };
    const snap = buildDeliverySnapshot(doc, project, (id) => deps.store.getKeyValue(id));
    const grantedNow = new Set(snap.entries.map((e) => e.name));
    // Names we (or the bridge) held that are no longer granted: shown as revoked.
    for (const n of [...rec.granted, ...rec.tracked]) if (!grantedNow.has(n)) rec.revoked.add(n);
    for (const n of grantedNow) rec.revoked.delete(n);
    rec.granted = grantedNow;
    rec.project = project;
    rec.states = snap.states.length > 0 ? snap.states : resolveBindings(doc, project).map((r) => ({ name: r.name, state: r.state }));
    rec.outcome = "delivered";
    rec.lastContactAt = now();
    return snapshotMsg("ok", "delivered", snap.entries);
  };

  /** Compute the answer for one session and update its record. */
  const compute = (sessionId: string, rec: SessionRecord): VaultSnapshotMessage => {
    if (!deps.isDeliveryEnabled()) return withdraw(rec, "disabled");
    const origin = deps.getOrigin(sessionId);
    if (!origin) return withdraw(rec, "untrusted");
    const trust = decideVaultTrust({ origin, tls: deps.isTls?.(sessionId) ?? false });
    if (!trust.allow) return withdraw(rec, trust.outcome);
    const { status, doc } = deps.store.readDocument();
    if (status.state === "corrupt") {
      rec.outcome = "vault-unavailable";
      return snapshotMsg("unavailable", "vault-unavailable");
    }
    return deliver(rec, doc, trust.deviceId);
  };

  const answer = (sessionId: string): VaultDeliveryOutcome | undefined => {
    const rec = sessions.get(sessionId);
    if (!rec) return undefined;
    const msg = compute(sessionId, rec);
    if (msg.status !== "unavailable") rec.lastContactAt = now();
    deps.send(sessionId, msg);
    return rec.outcome;
  };

  const pushNow = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    for (const id of [...sessions.keys()]) answer(id);
  };

  const unsubscribe = deps.store.onChange(() => schedulePush());

  function schedulePush(): void {
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; void pushNow(); }, deps.pushDelayMs ?? 150);
    timer.unref?.();
  }

  return {
    async handleSyncRequest(sessionId, msg) {
      const rec: SessionRecord = sessions.get(sessionId) ?? {
        tracked: new Set(), granted: new Set(), revoked: new Set(), reported: new Map(), outcome: "untrusted", states: [],
      };
      rec.cwd = typeof msg.cwd === "string" && msg.cwd.length > 0 ? msg.cwd : undefined;
      rec.origin = typeof msg.origin === "string" ? msg.origin : undefined;
      rec.tracked = new Set(Array.isArray(msg.tracked) ? msg.tracked.filter((n) => typeof n === "string") : []);
      rec.reported = new Map();
      sessions.set(sessionId, rec);
      return answer(sessionId) ?? "untrusted";
    },
    handleReport(sessionId, msg) {
      const rec = sessions.get(sessionId);
      if (!rec || !Array.isArray(msg.applied)) return;
      for (const a of msg.applied) {
        if (typeof a?.name === "string" && (a.outcome === "delivered" || a.outcome === "local-override" || a.outcome === "inherited")) {
          rec.reported.set(a.name, a.outcome);
        }
      }
    },
    schedulePush,
    pushNow,
    getSessionState(sessionId) {
      const rec = sessions.get(sessionId);
      if (!rec) return undefined;
      const bindings: SessionBindingView["bindings"] = rec.states.map((s) => ({
        name: s.name,
        state: s.state === "granted" ? (rec.reported.get(s.name) ?? "delivered") : s.state,
      }));
      for (const n of rec.revoked) if (!bindings.some((b) => b.name === n)) bindings.push({ name: n, state: "revoked" });
      return { bindings, lastContactAt: rec.lastContactAt, outcome: rec.outcome, project: rec.project && { ...rec.project } };
    },
    forget(sessionId) {
      sessions.delete(sessionId);
    },
    dispose() {
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = undefined;
      sessions.clear();
    },
  };
}
