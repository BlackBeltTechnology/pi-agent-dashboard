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
 * See change: add-credential-vault (D2, D3); retro-ux-credential-vault (D2: project memory + open projects).
 */

import type { VaultReportMessage, VaultSnapshotMessage, VaultSyncRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { remoteForWire } from "@blackbelt-technology/pi-dashboard-shared/remote-credentials.js";
import { clampVaultGraceHours, type VaultDeliveryOutcome } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { normalizeOrigin, type SessionProject } from "@blackbelt-technology/pi-dashboard-shared/vault-project-key.js";
import { type SessionOrigin, UNATTRIBUTED_REMOTE } from "../session/session-origin.js";
import { type BindingState, buildDeliverySnapshot, resolveBindings } from "./vault-grants.js";
import type { VaultProjects } from "./vault-projects.js";
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

type SessionBindingRowState = BindingState | "delivered" | "local-override" | "inherited" | "revoked" | "hub-unreachable";

interface SessionBindingView {
  bindings: Array<{ name: string; state: SessionBindingRowState }>;
  /** Wall-clock ms of the last successful vault contact with this session. */
  lastContactAt?: number;
  outcome: VaultDeliveryOutcome;
  /** Present when the session resolved to a project; used to confirm a pending checkout. */
  project?: { deviceId: string; dir: string; repoKey?: string };
}

/** One project the picker offers: a connected one (`sessions`), or a remembered one (`lastSeenAt`). */
export interface ProjectView {
  kind: "repo" | "dir";
  deviceId?: string;
  dir: string;
  repoKey?: string;
  sessions?: number;
  lastSeenAt?: number;
  /** Refused sessions are listed by working directory and are never grantable. */
  blocked?: "untrusted" | "transport-insecure";
}

/** Longest working directory a refused session is listed under. */
const MAX_BLOCKED_DIR_LENGTH = 4096;

export interface VaultDeliveryHubDeps {
  store: VaultStore;
  /** Remembers each resolved project for the picker. Optional: delivery works without it. */
  projects?: Pick<VaultProjects, "record">;
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
  /**
   * Is this session's bridge connected right now? When it is not, the rows that
   * held a value show `hub-unreachable` (the values may still be live within the
   * bridge's offline grace; the last contact time says since when). Default: always connected.
   */
  isSessionConnected?: (sessionId: string) => boolean;
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
  /** Projects of the sessions connected now (never values): delivered ones grouped, refused ones listed by `cwd`. */
  listOpenProjects(): ProjectView[];
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

/** The per-binding rows for the session view. A disconnected session's value-holding rows read `hub-unreachable`. */
function bindingRows(rec: SessionRecord, connected: boolean): SessionBindingView["bindings"] {
  const rows: SessionBindingView["bindings"] = rec.states.map((s) => ({
    name: s.name,
    state: s.state === "granted" ? (rec.reported.get(s.name) ?? "delivered") : s.state,
  }));
  for (const n of rec.revoked) if (!rows.some((b) => b.name === n)) rows.push({ name: n, state: "revoked" });
  if (!connected) for (const b of rows) if (HOLDING_STATES.has(b.state)) b.state = "hub-unreachable";
  return rows;
}

/** Where a session's project belongs in the picker: delivered → grouped, refused → by `cwd`, otherwise nowhere. */
function openProjectOf(rec: SessionRecord): { group: "open" | "blocked"; key: string; view: ProjectView } | undefined {
  if (rec.outcome === "delivered" && rec.project) {
    const { deviceId, dir, repoKey } = rec.project;
    const view: ProjectView = { kind: repoKey ? "repo" : "dir", deviceId, dir, ...(repoKey ? { repoKey } : {}), sessions: 1 };
    return { group: "open", key: `${deviceId}\u0000${dir}`, view };
  }
  if ((rec.outcome === "untrusted" || rec.outcome === "transport-insecure") && rec.cwd) {
    const dir = rec.cwd.slice(0, MAX_BLOCKED_DIR_LENGTH);
    return { group: "blocked", key: `${rec.outcome}\u0000${dir}`, view: { kind: "dir", dir, sessions: 1, blocked: rec.outcome } };
  }
  return undefined;
}

/** Count one more session on an existing entry, or add `fresh` (already counting one). */
function tally(into: Map<string, ProjectView>, key: string, fresh: ProjectView): void {
  const known = into.get(key);
  if (known) known.sessions = (known.sessions ?? 0) + 1;
  else into.set(key, fresh);
}

/** States in which the session holds (or may hold) a delivered value. */
const HOLDING_STATES: ReadonlySet<string> = new Set(["delivered", "local-override", "inherited"]);

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
    // Fire-and-forget: a failure is logged by name only (the message can carry a path) and never touches delivery.
    deps.projects?.record(project).catch((err: unknown) => {
      console.warn(`[vault] project record failed: ${(err as Error)?.name ?? "error"}`);
    });
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
    timer = setTimeout(() => {
      timer = undefined;
      pushNow().catch((err: unknown) => console.warn(`[vault] push failed: ${(err as Error)?.name ?? "error"}`));
    }, deps.pushDelayMs ?? 150);
    timer.unref?.();
  }

  return {
    async handleSyncRequest(sessionId, msg) {
      const rec: SessionRecord = sessions.get(sessionId) ?? {
        tracked: new Set(), granted: new Set(), revoked: new Set(), reported: new Map(), outcome: "untrusted", states: [],
      };
      rec.cwd = typeof msg.cwd === "string" && msg.cwd.length > 0 ? msg.cwd : undefined;
      // Strip again on receipt: an old bridge sends the raw remote, userinfo
      // and all. The stored origin (and so the persisted project record and the
      // derived repoKey) never carries a credential.
      // See change: harden-bridge-inbound-and-discovery (D18).
      rec.origin = typeof msg.origin === "string" ? remoteForWire(msg.origin) : undefined;
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
      const bindings = bindingRows(rec, deps.isSessionConnected?.(sessionId) !== false);
      return { bindings, lastContactAt: rec.lastContactAt, outcome: rec.outcome, project: rec.project && { ...rec.project } };
    },
    listOpenProjects() {
      const groups = { open: new Map<string, ProjectView>(), blocked: new Map<string, ProjectView>() };
      for (const [id, rec] of sessions) {
        if (deps.isSessionConnected?.(id) === false) continue;
        const entry = openProjectOf(rec);
        if (entry) tally(groups[entry.group], entry.key, entry.view);
      }
      return [...groups.open.values(), ...groups.blocked.values()];
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
