/**
 * Bridge half of credential-vault env delivery.
 *
 * Applies the hub's COMPLETE granted set to `process.env` so commands started
 * afterwards (bash tool, `!` commands, skills) see the keys. Safety properties:
 *
 *  - Tracked set: each delivered name maps to the SHA-256 of its value. A
 *    rotation or revocation touches a name only while the live value still
 *    matches; a name the user overwrote is dropped from tracking and left alone.
 *  - Precedence: a name present before delivery (user, spawn contributor, or a
 *    win32 case-variant) is a `local-override` and is never touched.
 *  - Nested pi: delivery sets `PI_DASHBOARD_VAULT_DELIVERED` (names only). A
 *    nested bridge adopts the listed names as `inherited`: masks them, never
 *    reports local-override, never updates or removes them (the parent owns them).
 *  - Reconciliation: every connect and every `session_start` reason asks the hub
 *    for the full set; the difference is applied under the same hash check.
 *  - Withdrawal: an unreadable cwd, a project change, a hub that lacks the
 *    `vault-delivery` feature, or an expired offline grace withdraws everything.
 *  - Grace: counted from the last successful hub contact as the LARGER of
 *    monotonic and wall-clock elapsed time, so a sleeping machine cannot extend
 *    retention. A connected, answering hub resets it continuously.
 *  - Names are re-validated here (same rule as the hub) before touching env.
 *
 * State lives in a registry on `process`, which survives jiti cache
 * invalidation and extension reload. The redaction set (plaintext values) stays
 * for the life of the process, even after rotation or revocation, because
 * already-running processes may still print an old value.
 *
 * See change: add-credential-vault (D2, D5).
 */

import { createHash } from "node:crypto";
import { realpathAsync, remoteUrlOrAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { VaultReportMessage, VaultSnapshotMessage, VaultSyncRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { remoteForWire } from "@blackbelt-technology/pi-dashboard-shared/remote-credentials.js";
import {
  clampVaultGraceHours,
  isDeliverableEnvName,
  VAULT_DELIVERED_MARKER_ENV,
  VAULT_DELIVERY_FEATURE,
} from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";

const REGISTRY_KEY = "__piDashboardVaultDelivery";
const HOUR_MS = 3_600_000;
const DEFAULT_IDENTITY_TIMEOUT_MS = 10_000;

export interface VaultRegistry {
  /** Delivered names → SHA-256 of the delivered value. Never the value. */
  tracked: Map<string, { hash: string }>;
  /** Plaintext values per name; kept for the process lifetime. */
  redaction: Map<string, Set<string>>;
  /** Bumped whenever a new value joins `redaction`, so the masker knows to rebuild. */
  redactionVersion: number;
  /** Names a parent pi delivered (adopted from the marker). */
  inherited: Set<string>;
  graceHours: number;
  /** True while the hub is reachable and answering. Contact time freezes when false. */
  up: boolean;
  lastContactMono: number;
  lastContactWall: number;
  lastCwd?: string;
  lastProject?: { dir: string; origin?: string };
}

export function createVaultRegistry(): VaultRegistry {
  return {
    tracked: new Map(),
    redaction: new Map(),
    redactionVersion: 0,
    inherited: new Set(),
    graceHours: 24,
    up: false,
    lastContactMono: 0,
    lastContactWall: 0,
  };
}

/** The process-global registry (survives reload and jiti cache invalidation). */
function getProcessVaultRegistry(): VaultRegistry {
  const holder = process as unknown as Record<string, VaultRegistry | undefined>;
  return (holder[REGISTRY_KEY] ??= createVaultRegistry());
}

interface VaultProject {
  dir: string;
  origin?: string;
}

export interface VaultDeliveryDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  registry?: VaultRegistry;
  /** Send on the OPEN socket; false = not sent. */
  send: (msg: VaultSyncRequestMessage | VaultReportMessage) => boolean;
  sessionId: () => string;
  clock?: { mono: () => number; wall: () => number };
  /** Resolve the session cwd to its real path and raw origin. Undefined = unusable. */
  resolveProject?: (cwd: string) => Promise<VaultProject | undefined>;
  identityTimeoutMs?: number;
  /**
   * `"enforced"` while the connection carries the TLS checks (read per sync); declared
   * on `vault_sync_request`. See change: prove-vault-bridge-tls (D7).
   */
  certValidation?: () => "enforced" | undefined;
  log?: (line: string) => void;
}

export interface VaultDelivery {
  /** Observes `vault_snapshot` and `dashboard_identity`. Returns true only when it consumed the frame. */
  onServerMessage(msg: unknown): boolean;
  onOpen(): void;
  onClose(): void;
  onSessionStart(input: { reason: VaultSyncRequestMessage["reason"]; getCwd: () => string }): Promise<void>;
  /** Grace check; also refreshes contact while the hub is up. Call periodically. */
  tick(): void;
  /** Every value currently or previously delivered/inherited. */
  redactionValues(): string[];
  /** Every `(name, value)` ever delivered/inherited, plus a version that changes when the set grows. For the masker. */
  redactionState(): { version: number; entries: Array<{ name: string; value: string }> };
  withdrawAll(): void;
  dispose(): void;
}

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

async function defaultResolveProject(cwd: string): Promise<VaultProject | undefined> {
  const real = await realpathAsync(cwd);
  if (real.kind !== "ok") return undefined;
  let origin: string | undefined;
  try {
    origin = await remoteUrlOrAsync({ cwd: real.path });
  } catch {
    origin = undefined;
  }
  return { dir: real.path, origin };
}

/**
 * The `process.env` + registry operations. A class (not closures) so each
 * method is analysed on its own.
 */
class EnvApplier {
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  readonly registry: VaultRegistry;

  constructor(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, registry: VaultRegistry) {
    this.env = env;
    this.platform = platform;
    this.registry = registry;
  }

  /** The live env key for `name` (win32: any case-variant), or undefined when unset. */
  envKeyOf(name: string): string | undefined {
    if (this.platform === "win32") {
      const upper = name.toUpperCase();
      return Object.keys(this.env).find((k) => k.toUpperCase() === upper && this.env[k] !== undefined);
    }
    return this.env[name] !== undefined ? name : undefined;
  }

  remember(name: string, value: string): void {
    let set = this.registry.redaction.get(name);
    if (!set) this.registry.redaction.set(name, (set = new Set()));
    if (!set.has(value)) {
      set.add(value);
      this.registry.redactionVersion++;
    }
  }

  writeMarker(): void {
    const names = [...new Set([...this.registry.tracked.keys(), ...this.registry.inherited])];
    if (names.length > 0) this.env[VAULT_DELIVERED_MARKER_ENV] = names.join(",");
    else delete this.env[VAULT_DELIVERED_MARKER_ENV];
  }

  /** A nested pi adopts the parent's delivered names: mask them, never own them. */
  adoptInherited(): void {
    const marker = this.env[VAULT_DELIVERED_MARKER_ENV];
    if (!marker) return;
    for (const name of marker.split(",")) {
      if (!isDeliverableEnvName(name) || this.registry.tracked.has(name)) continue;
      const key = this.envKeyOf(name);
      const value = key ? this.env[key] : undefined;
      if (typeof value !== "string" || value.length === 0) continue;
      this.registry.inherited.add(name);
      this.remember(name, value);
    }
  }

  removeIfOurs(name: string): void {
    const entry = this.registry.tracked.get(name);
    this.registry.tracked.delete(name);
    if (!entry) return;
    const key = this.envKeyOf(name);
    if (key !== undefined && sha256(String(this.env[key])) === entry.hash) delete this.env[key];
  }

  withdrawAll(): void {
    for (const name of [...this.registry.tracked.keys()]) this.removeIfOurs(name);
    this.writeMarker();
  }

  /** Apply ONE granted entry and report how it landed. */
  applyOne(name: string, value: string): VaultReportMessage["applied"][number]["outcome"] {
    const tracked = this.registry.tracked.get(name);
    if (tracked) return this.updateTracked(name, value, tracked.hash);
    if (this.registry.inherited.has(name)) return "inherited";
    if (this.envKeyOf(name) !== undefined) return "local-override";
    this.env[name] = value;
    this.registry.tracked.set(name, { hash: sha256(value) });
    this.remember(name, value);
    return "delivered";
  }

  /** Update a tracked name only while its live value still matches what we delivered. */
  private updateTracked(name: string, value: string, hash: string): "delivered" | "local-override" {
    const key = this.envKeyOf(name);
    const live = key !== undefined ? String(this.env[key]) : undefined;
    if (key === undefined || live === undefined || sha256(live) !== hash) {
      // The user overwrote it: stop tracking, leave their value.
      this.registry.tracked.delete(name);
      return "local-override";
    }
    if (live !== value) {
      this.env[key] = value;
      this.registry.tracked.set(name, { hash: sha256(value) });
    }
    this.remember(name, value);
    return "delivered";
  }

  /** Apply the complete granted set; returns how each name landed. */
  applyEntries(entries: Array<{ name: string; value: string }>): VaultReportMessage["applied"] {
    const applied: VaultReportMessage["applied"] = [];
    const granted = new Set<string>();
    for (const { name, value } of entries) {
      if (!isDeliverableEnvName(name) || typeof value !== "string" || value.length === 0) continue;
      granted.add(name);
      applied.push({ name, outcome: this.applyOne(name, value) });
    }
    for (const name of [...this.registry.tracked.keys()]) if (!granted.has(name)) this.removeIfOurs(name);
    this.writeMarker();
    return applied;
  }
}

export function createVaultDelivery(deps: VaultDeliveryDeps): VaultDelivery {
  const env = deps.env ?? process.env;
  const registry = deps.registry ?? getProcessVaultRegistry();
  const applier = new EnvApplier(env, deps.platform ?? process.platform, registry);
  const clock = deps.clock ?? { mono: () => performance.now(), wall: () => Date.now() };
  const resolveProject = deps.resolveProject ?? defaultResolveProject;
  const identityTimeoutMs = deps.identityTimeoutMs ?? DEFAULT_IDENTITY_TIMEOUT_MS;
  let supported = false;
  let identityTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const touch = (): void => {
    registry.lastContactMono = clock.mono();
    registry.lastContactWall = clock.wall();
  };

  const withdrawAll = (): void => applier.withdrawAll();

  const applySnapshot = (entries: Array<{ name: string; value: string }>): void => {
    const applied = applier.applyEntries(entries);
    if (applied.length === 0) return;
    try { deps.send({ type: "vault_report", sessionId: deps.sessionId(), applied }); } catch { /* best effort */ }
  };

  const sendSync = (reason: VaultSyncRequestMessage["reason"], project: VaultProject | undefined): void => {
    if (!supported) return;
    // Raw origin, userinfo-stripped, never normalized; unparseable-with-userinfo
    // → undefined → no origin sent. See change: harden-bridge-inbound-and-discovery (D18).
    const origin = project?.origin ? remoteForWire(project.origin) : undefined;
    try {
      deps.send({
        type: "vault_sync_request",
        sessionId: deps.sessionId(),
        ...(project ? { cwd: project.dir } : {}),
        ...(origin ? { origin } : {}),
        tracked: [...registry.tracked.keys()],
        reason,
        ...(deps.certValidation?.() === "enforced" ? { certValidation: "enforced" as const } : {}),
      });
    } catch { /* the next connect re-syncs */ }
  };

  const handleSnapshot = (m: VaultSnapshotMessage): void => {
    registry.graceHours = clampVaultGraceHours(m.graceHours);
    if (m.status === "unavailable") {
      registry.up = false; // treated like an unreachable hub: the grace keeps running
      return;
    }
    registry.up = true;
    touch();
    applySnapshot(m.status === "ok" && Array.isArray(m.entries) ? m.entries : []);
  };

  const handleIdentity = (features: unknown): void => {
    clearIdentityTimer();
    supported = Array.isArray(features) && features.includes(VAULT_DELIVERY_FEATURE);
    if (supported) sendSync("connect", registry.lastProject);
    else withdrawAll(); // downgraded hub: no revocation path, so no values
  };

  /** The session's own cwd resolved to a real path + origin, or undefined when unreadable. */
  const readProject = async (getCwd: () => string): Promise<VaultProject | undefined> => {
    let cwd: string | undefined;
    try {
      const v = getCwd();
      cwd = typeof v === "string" && v.length > 0 ? v : undefined;
    } catch {
      cwd = undefined;
    }
    return cwd === undefined ? undefined : resolveProject(cwd);
  };

  const clearIdentityTimer = (): void => {
    if (identityTimer) clearTimeout(identityTimer);
    identityTimer = undefined;
  };

  applier.adoptInherited();

  return {
    onServerMessage(raw) {
      const msg = raw as { type?: string } | null | undefined;
      if (msg?.type === "vault_snapshot") {
        handleSnapshot(msg as VaultSnapshotMessage);
        return true;
      }
      if (msg?.type === "dashboard_identity") handleIdentity((msg as { features?: unknown }).features);
      return false; // identity is observed, never consumed: other handlers still need it
    },
    onOpen() {
      registry.up = true;
      touch();
      clearIdentityTimer();
      if (registry.tracked.size > 0) {
        // An old hub never announces an identity at all: treat that as a downgrade.
        identityTimer = setTimeout(() => {
          identityTimer = undefined;
          if (!disposed && !supported) withdrawAll();
        }, identityTimeoutMs);
        identityTimer.unref?.();
      }
    },
    onClose() {
      supported = false;
      registry.up = false;
      clearIdentityTimer();
    },
    async onSessionStart({ reason, getCwd }) {
      applier.adoptInherited();
      const project = await readProject(getCwd);
      if (!project) {
        // No usable cwd: nothing may stay delivered, and nothing new is delivered.
        withdrawAll();
        registry.lastCwd = undefined;
        registry.lastProject = undefined;
        sendSync(reason, undefined);
        return;
      }
      // A different project must not see the previous project's values, even for
      // the moment before the hub answers. "Different" is the whole identity the
      // hub keys on: the real path AND the raw origin (a re-pointed origin in the
      // same directory is a different repository key).
      const prev = registry.lastProject;
      if (prev !== undefined && (prev.dir !== project.dir || (prev.origin ?? "") !== (project.origin ?? ""))) withdrawAll();
      registry.lastCwd = project.dir;
      registry.lastProject = project;
      sendSync(reason, project);
    },
    tick() {
      if (registry.tracked.size === 0) return;
      if (registry.up) {
        touch();
        return;
      }
      const elapsed = Math.max(clock.mono() - registry.lastContactMono, clock.wall() - registry.lastContactWall);
      if (elapsed > registry.graceHours * HOUR_MS) {
        deps.log?.("[vault] offline grace elapsed; withdrawing delivered values");
        withdrawAll();
      }
    },
    redactionValues() {
      const out = new Set<string>();
      for (const set of registry.redaction.values()) for (const v of set) out.add(v);
      return [...out];
    },
    redactionState() {
      const entries: Array<{ name: string; value: string }> = [];
      for (const [name, set] of registry.redaction) for (const value of set) entries.push({ name, value });
      return { version: registry.redactionVersion, entries };
    },
    withdrawAll,
    dispose() {
      disposed = true;
      clearIdentityTimer();
    },
  };
}
