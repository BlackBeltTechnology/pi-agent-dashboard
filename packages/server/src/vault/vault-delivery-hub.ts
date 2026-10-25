/**
 * Hub half of vault env delivery.
 *
 * Per connected bridge session it keeps the last sync request (cwd, origin,
 * tracked names) and answers with the COMPLETE set of granted values: on every
 * sync request (connect + every `session_start` reason) and, debounced, on every
 * vault write and config change (push). A sync answer and a push are the same
 * message, so a missed push is reconciled by the next sync.
 *
 * Trust gate (D3, prove-vault-bridge-tls D5): a session is delivered to only when it is hub-local
 * with LOCAL admission (unix socket, local credential proof, in-process), or a remote paired device
 * whose bridge the hub itself proved: its upgrade arrived on the hub's own TLS socket, its ticket was
 * minted the same way, the device is active and its bearer was never seen off a proven channel, and the
 * bridge declares certificate validation enforced. Loopback by address alone is not local admission.
 *
 * Order of refusal: config switch first (it must work while the vault is
 * corrupt), then trust, then vault health, then the project.
 *
 * Nothing here logs a value. The per-session state view carries names and states.
 *
 * See change: add-credential-vault (D2, D3); retro-ux-credential-vault (D2: project memory + open projects);
 * prove-vault-bridge-tls (D3, D5, D6, D8).
 */

import type { VaultReportMessage, VaultSnapshotMessage, VaultSyncRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { remoteForWire } from "@blackbelt-technology/pi-dashboard-shared/remote-credentials.js";
import { clampVaultGraceHours, type VaultDeliveryOutcome, type VaultTrustDetail } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { normalizeOrigin, type SessionProject } from "@blackbelt-technology/pi-dashboard-shared/vault-project-key.js";
import { auditPrefix } from "../auth/audit-log.js";
import type { DeviceTrust } from "../pairing/paired-devices.js";
import { type BridgeChannel, isLocallyAdmitted } from "../pi/bridge-channel.js";
import { type SessionOrigin, UNATTRIBUTED_REMOTE } from "../session/session-origin.js";
import { type BindingState, buildDeliverySnapshot, resolveBindings } from "./vault-grants.js";
import type { VaultProjects } from "./vault-projects.js";
import type { VaultDocument, VaultStore } from "./vault-store.js";

export type VaultTrustDecision =
  | { allow: true; deviceId: string }
  | { allow: false; outcome: "untrusted" | "transport-insecure"; detail: VaultTrustDetail };

export interface VaultTrustInput {
  /** Origin of the session (derived from the credential), or undefined when unknown. */
  origin: SessionOrigin | undefined;
  /** How the socket the session is routed to was admitted; undefined = closed, unknown or unrouted. */
  channel: BridgeChannel | undefined;
  /** Registry view of a device: active, tracked, never off a proven channel. */
  deviceTrust: (deviceId: string) => DeviceTrust;
  /** The bridge's declared `certValidation`. */
  bridgeCertCheck: "enforced" | undefined;
  /** Live `tls.enabled && tls.acceptBridges` (a TLS-admitted channel needs it). */
  tlsBridgesLive: boolean;
  /** A first-exposure write has not persisted: the hub cannot prove its record is durable. */
  exposurePending: boolean;
}

const refuse = (outcome: "untrusted" | "transport-insecure", detail: VaultTrustDetail): VaultTrustDecision => ({
  allow: false,
  outcome,
  detail,
});

/**
 * Who may be trusted with values, and the named cause when not. Checked in design D5 order:
 * no channel → hub-local admission → ticket device → device active → proven TLS → exposure record →
 * ticket TLS → bridge certificate validation.
 */
export function decideVaultTrust(input: VaultTrustInput): VaultTrustDecision {
  const { origin, channel } = input;
  // 1. Closed, unknown or unrouted.
  if (!origin || !channel) return refuse("untrusted", "unattributed");
  // 2. Hub-local needs local admission, not just a loopback address.
  if (origin.local && isLocallyAdmitted(channel.admission)) return { allow: true, deviceId: "hub" };
  // 3. Deprecated hub-local paths (an L4 forwarder looks identical).
  if (origin.local && channel.admission !== "device-ticket") return refuse("untrusted", "local-unproven");
  // 4–5. A device ticket is evaluated as ITS device, even when the origin reads local; ticket and origin must agree.
  const attributed = origin.deviceId && origin.deviceId !== UNATTRIBUTED_REMOTE ? origin.deviceId : undefined;
  let deviceId: string | undefined;
  if (channel.admission === "device-ticket") {
    deviceId = channel.ticketDeviceId;
    if (!deviceId || (attributed && attributed !== deviceId)) return refuse("untrusted", "unattributed");
  } else {
    deviceId = attributed;
    if (!deviceId) return refuse("untrusted", "unattributed");
  }
  const trust = input.deviceTrust(deviceId);
  // 6. Revoked, held, expired or unknown.
  if (trust === "inactive") return refuse("untrusted", "device-inactive");
  // 7. The hub must have observed TLS itself, and a TLS-admitted channel needs the switch on right now.
  if (!channel.provenTls || !input.tlsBridgesLive) return refuse("transport-insecure", "plain-transport");
  // 8–9. The bearer must never have been seen off a proven channel; history must be tracked and durable.
  if (trust === "exposed") return refuse("transport-insecure", "bearer-exposed");
  if (trust === "history-unknown" || input.exposurePending) return refuse("transport-insecure", "history-unknown");
  // 10. Defence in depth: the ticket was minted on a proven-TLS request.
  if (!channel.ticketTls) return refuse("transport-insecure", "ticket-plain");
  // 11. An old or misconfigured bridge cannot be told apart from an honest one.
  if (input.bridgeCertCheck !== "enforced") return refuse("transport-insecure", "bridge-outdated");
  return { allow: true, deviceId };
}

type SessionBindingRowState = BindingState | "delivered" | "local-override" | "inherited" | "revoked" | "hub-unreachable";

interface SessionBindingView {
  bindings: Array<{ name: string; state: SessionBindingRowState }>;
  /** Wall-clock ms of the last successful vault contact with this session. */
  lastContactAt?: number;
  outcome: VaultDeliveryOutcome;
  /** Which proof a refused remote session is missing (never a value). */
  trustDetail?: VaultTrustDetail;
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
  /** The channel of the socket the session is ROUTED to now (follows register and move-commit); undefined = unrouted. */
  getChannel: (sessionId: string) => BridgeChannel | undefined;
  /** Registry view of a device (active, tracked, never off a proven channel). */
  getDeviceTrust: (deviceId: string) => DeviceTrust;
  /** Live `tls.enabled && tls.acceptBridges`. */
  isTlsBridgesLive: () => boolean;
  /** True while a first-exposure write has not persisted. Default: false. */
  exposurePending?: () => boolean;
  /** Send to ONE session's bridge. Returns false when not connected. */
  send: (sessionId: string, msg: VaultSnapshotMessage) => boolean;
  /** Live read of the config-held master switch. */
  isDeliveryEnabled: () => boolean;
  /** Live read of the configured offline grace (hours); clamped here. */
  getGraceHours: () => number;
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
  /**
   * The routing entry for `sessionId` now points at a (possibly different) socket: record what that
   * bridge declared and, when the session is already known, re-evaluate and send NOW so a socket swap
   * (reconnect, plaintext fallback, move) never keeps the previous socket's verdict.
   */
  handleRegister(sessionId: string, declared?: { certValidation?: "enforced" }): void;
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
  trustDetail?: VaultTrustDetail;
  /** `outcome/detail/device` of the last `[vault] trust` log line (one line per change). */
  trustLogKey?: string;
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
  /** What each session's bridge declared about certificate validation (register or sync request). */
  const declaredCert = new Map<string, "enforced" | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const snapshotMsg = (
    status: VaultSnapshotMessage["status"],
    outcome: VaultDeliveryOutcome,
    entries: VaultSnapshotMessage["entries"] = [],
    trustDetail?: VaultTrustDetail,
  ): VaultSnapshotMessage => ({
    type: "vault_snapshot",
    status,
    outcome,
    entries,
    graceHours: clampVaultGraceHours(deps.getGraceHours()),
    ...(trustDetail ? { trustDetail } : {}),
  });

  const withdraw = (rec: SessionRecord, outcome: VaultDeliveryOutcome, detail?: VaultTrustDetail): VaultSnapshotMessage => {
    rec.outcome = outcome;
    rec.trustDetail = detail;
    rec.project = undefined;
    rec.states = [];
    for (const n of rec.granted) rec.revoked.add(n);
    rec.granted = new Set();
    return snapshotMsg("denied", outcome, [], detail);
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
    rec.trustDetail = undefined;
    rec.lastContactAt = now();
    return snapshotMsg("ok", "delivered", snap.entries);
  };

  /** One `[vault] trust …` line per outcome/detail change (never per sync); no value, bearer or hash. */
  const logTrust = (sessionId: string, rec: SessionRecord, deviceId: string | undefined): void => {
    const key = `${rec.outcome}/${rec.trustDetail ?? ""}/${deviceId ?? ""}`;
    if (rec.trustLogKey === key) return;
    const refusal = rec.outcome === "untrusted" || rec.outcome === "transport-insecure";
    const wasRefusal = rec.trustLogKey !== undefined && /^(untrusted|transport-insecure)\//.test(rec.trustLogKey);
    rec.trustLogKey = key;
    if (!refusal && !wasRefusal) return;
    console.log(
      `[vault] trust session=${auditPrefix(sessionId, 36)} device=${deviceId ? auditPrefix(deviceId) : "none"} outcome=${rec.outcome}${rec.trustDetail ? ` detail=${rec.trustDetail}` : ""}`,
    );
  };

  /** Compute the answer for one session and update its record. */
  const compute = (sessionId: string, rec: SessionRecord): VaultSnapshotMessage => {
    if (!deps.isDeliveryEnabled()) return withdraw(rec, "disabled");
    const origin = deps.getOrigin(sessionId);
    const channel = deps.getChannel(sessionId);
    const trust = decideVaultTrust({
      origin,
      channel,
      deviceTrust: deps.getDeviceTrust,
      bridgeCertCheck: declaredCert.get(sessionId),
      tlsBridgesLive: deps.isTlsBridgesLive(),
      exposurePending: deps.exposurePending?.() === true,
    });
    const deviceForLog = channel?.ticketDeviceId ?? origin?.deviceId;
    if (!trust.allow) {
      const msg = withdraw(rec, trust.outcome, trust.detail);
      logTrust(sessionId, rec, deviceForLog);
      return msg;
    }
    const { status, doc } = deps.store.readDocument();
    if (status.state === "corrupt") {
      rec.outcome = "vault-unavailable";
      rec.trustDetail = undefined;
      return snapshotMsg("unavailable", "vault-unavailable");
    }
    const msg = deliver(rec, doc, trust.deviceId);
    logTrust(sessionId, rec, deviceForLog);
    return msg;
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
    // A session that is not connected is not re-evaluated: nothing can be sent to it, its view keeps the
    // `hub-unreachable` rows and the bridge's offline grace applies.
    for (const id of [...sessions.keys()]) {
      if (deps.isSessionConnected?.(id) === false) continue;
      answer(id);
    }
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
      declaredCert.set(sessionId, msg.certValidation === "enforced" ? "enforced" : undefined);
      sessions.set(sessionId, rec);
      return answer(sessionId) ?? "untrusted";
    },
    handleRegister(sessionId, declared) {
      if (declared) declaredCert.set(sessionId, declared.certValidation === "enforced" ? "enforced" : undefined);
      // Unknown session: the sync request that follows carries its cwd and runs the first evaluation.
      if (sessions.has(sessionId)) answer(sessionId);
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
      return {
        bindings,
        lastContactAt: rec.lastContactAt,
        outcome: rec.outcome,
        ...(rec.trustDetail ? { trustDetail: rec.trustDetail } : {}),
        project: rec.project && { ...rec.project },
      };
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
      declaredCert.delete(sessionId);
    },
    dispose() {
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = undefined;
      sessions.clear();
      declaredCert.clear();
    },
  };
}
