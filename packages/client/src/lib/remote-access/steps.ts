/**
 * Remote access step engine — PURE. No I/O, no React.
 *
 * Every wizard decision (which steps a task lists, which are already satisfied,
 * which one is current, how a run of satisfied steps folds, what the three
 * roads read) is a function of one {@link Snapshot} plus the {@link RunState}
 * of the current wizard run. Each snapshot source is tri-state so a value that
 * has not loaded (or failed to load) is never rendered as a fact: `satisfied`
 * answers `"unknown"` instead.
 *
 * See change: add-remote-access-wizard (design D1, D3).
 */
import {
  type BindReachability,
  collectTrustedEntries,
  isLoopbackIpv4,
  isLoopbackOnlyEntry,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import type { TunnelStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ProviderReadiness, TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { isPairingEligible } from "../gateway/gateway-endpoints.js";

// ── Tri-state ────────────────────────────────────────────────────────

export type Tri<T> = { status: "loading" } | { status: "error" } | { status: "value"; value: T };

export const LOADING: Tri<never> = { status: "loading" };
export const FAILED: Tri<never> = { status: "error" };
export const loaded = <T>(value: T): Tri<T> => ({ status: "value", value });

/** `"unknown"` = an input has not loaded (or failed to). Never rendered as satisfied. */
type Sat = boolean | "unknown";

// ── Snapshot ─────────────────────────────────────────────────────────

/** The slice of `GET /api/config` the engine reads. */
export interface RaConfig {
  tunnel?: { provider?: string; mode?: string; zrok?: { reservedName?: string; persistent?: boolean } };
  pairing?: { acceptLanRequests?: boolean };
  trustedNetworks?: string[] | null;
  auth?: { bypassHosts?: string[] | null } | null;
  /** Computed on the guarded config surface; absent for an unguarded reader. */
  reachability?: BindReachability;
}

export interface Snapshot {
  config: Tri<RaConfig>;
  /** Per-provider readiness (`GET /api/tunnel-readiness`). */
  readiness: Tri<ProviderReadiness[]>;
  /** Gated `GET /api/tunnel-status-detail`. */
  status: Tri<TunnelStatusDetail>;
  /** `GET /api/tunnel/endpoints` — "Accessible at". */
  endpoints: Tri<TunnelEndpoint[]>;
  /** Live bind facts from the `reachability_updated` broadcast; outranks `config.reachability`. */
  live?: Pick<BindReachability, "resolvedBindHost" | "pendingBindHost"> & Partial<BindReachability>;
}

export const EMPTY_SNAPSHOT: Snapshot = { config: LOADING, readiness: LOADING, status: LOADING, endpoints: LOADING };

/** Provider assumed when `tunnel.provider` is unset (the server normalises to zrok). */
const DEFAULT_PROVIDER = "zrok";

// ── Run state ────────────────────────────────────────────────────────

export type TaskId = "share" | "device" | "lan" | "connect";
export type DeviceBranch = "wifi" | "anywhere";

export type StepId =
  | "provider"
  | "install"
  | "enable"
  | "address"
  | "connect"
  | "bind"
  | "accept"
  | "door"
  | "road"
  | "qr"
  | "approve"
  | "machine"
  | "reach"
  | "ask"
  | "finish";

export interface RunState {
  task: TaskId;
  /** Let a device in: the road the operator chose when none was on. */
  branch?: DeviceBranch;
  /** Steps completed during this run (action steps, and satisfied steps the operator walked through). */
  done: StepId[];
  /** A satisfied step the operator re-opened — it becomes the current step. */
  open?: StepId;
  /** "Continue anyway" on Who may enter — done for this run only. */
  waived?: StepId[];
}

export const newRun = (task: TaskId): RunState => ({ task, done: [] });

// ── Bind-host helpers ────────────────────────────────────────────────

/** Loopback-only host. `0.0.0.0` / `::` are ALL interfaces, not loopback. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || isLoopbackIpv4(h);
}

function bindLabel(host: string): string {
  const h = host.trim();
  if (h === "0.0.0.0" || h === "::") return `all networks (${h})`;
  return h;
}

// ── Accessors (tri-state in, tri-state out) ──────────────────────────

function cfgField<T>(snap: Snapshot, pick: (c: RaConfig) => T): Tri<T> {
  if (snap.config.status !== "value") return snap.config;
  return loaded(pick(snap.config.value));
}

export interface BindInfo {
  resolved: string;
  pending: string;
}

/** Live broadcast outranks the config read; no source at all → unknown. */
export function bindInfo(snap: Snapshot): Tri<BindInfo> {
  if (snap.live?.resolvedBindHost) {
    return loaded({ resolved: snap.live.resolvedBindHost, pending: snap.live.pendingBindHost || snap.live.resolvedBindHost });
  }
  if (snap.config.status !== "value") return snap.config;
  const r = snap.config.value.reachability;
  if (!r) return FAILED;
  return loaded({ resolved: r.resolvedBindHost, pending: r.pendingBindHost || r.resolvedBindHost });
}

function primaryProvider(snap: Snapshot): Tri<string | undefined> {
  return cfgField(snap, (c) => c.tunnel?.provider);
}

function primaryReadiness(snap: Snapshot): Tri<ProviderReadiness["state"] | undefined> {
  const p = primaryProvider(snap);
  if (p.status !== "value") return p;
  if (!p.value) return loaded(undefined);
  if (snap.readiness.status !== "value") return snap.readiness;
  return loaded(snap.readiness.value.find((r) => r.provider === p.value)?.state);
}

/** Entries admitted without authentication that are NOT loopback-only. */
export function openEntries(config: RaConfig): string[] {
  return [...new Set(collectTrustedEntries(config))].filter(
    (e) => !(isLoopbackOnlyEntry(e) || e === "::1" || e === "::1/128"),
  );
}

function acceptsLanRequests(snap: Snapshot): Tri<boolean> {
  return cfgField(snap, (c) => c.pairing?.acceptLanRequests === true);
}

// ── Roads ────────────────────────────────────────────────────────────

type LanState = "loading" | "unknown" | "off" | "restart-pending" | "listening" | "on";

export interface LanRoad {
  state: LanState;
  /** Resolved bind host, shown while listening (`all networks (0.0.0.0)`). */
  bind?: string;
}

type InternetState = "loading" | "unknown" | "off" | "on";

export interface InternetRoad {
  state: InternetState;
  address?: string;
  /** Every connected provider is a private mesh — reachable only from that network. */
  private?: boolean;
  providers?: string[];
}

const PRIVATE_MESH = new Set(["tailscale", "zerotier"]);

/** The one definition of the roads — shared by landing, "Where is the device" and the toolbar. */
export function roads(snap: Snapshot): { lan: LanRoad; internet: InternetRoad } {
  return { lan: lanRoad(snap), internet: internetRoad(snap) };
}

function lanRoad(snap: Snapshot): LanRoad {
  const bind = bindInfo(snap);
  const accept = acceptsLanRequests(snap);
  if (bind.status === "loading" || accept.status === "loading") return { state: "loading" };
  if (bind.status === "error" || accept.status === "error") return { state: "unknown" };
  const { resolved, pending } = bind.value;
  if (!isLoopbackHost(resolved)) {
    return accept.value
      ? { state: "on", bind: bindLabel(resolved) }
      : { state: "listening", bind: bindLabel(resolved) };
  }
  if (!isLoopbackHost(pending)) return { state: "restart-pending" };
  return { state: "off" };
}

function internetRoad(snap: Snapshot): InternetRoad {
  if (snap.status.status === "loading") return { state: "loading" };
  if (snap.status.status === "error") return { state: "unknown" };
  const s = snap.status.value;
  const connected = s.connectedProviders ?? (s.status === "active" ? [DEFAULT_PROVIDER] : []);
  if (connected.length === 0) return { state: "off" };
  const fromReadiness =
    snap.readiness.status === "value"
      ? snap.readiness.value
          .filter((r) => connected.includes(r.provider))
          .flatMap((r) => r.endpoints)
          .find((e) => e.kind === "public" || e.kind === "magicdns")?.url
      : undefined;
  const address = s.status === "active" ? s.url : fromReadiness;
  return {
    state: "on",
    address,
    private: connected.every((p) => PRIVATE_MESH.has(p)),
    providers: connected,
  };
}

/** True when a road a device could use is on (LAN counts only with requests accepted). */
function anyRoadOn(snap: Snapshot): Sat {
  const r = roads(snap);
  if (r.internet.state === "on" || r.lan.state === "on") return true;
  if (r.internet.state === "loading" || r.lan.state === "loading") return "unknown";
  if (r.internet.state === "unknown" || r.lan.state === "unknown") return "unknown";
  return false;
}

/** Endpoint the device steps use — https preferred, else the LAN address. */
export function deviceEndpoint(snap: Snapshot): TunnelEndpoint | null {
  const r = roads(snap);
  const eps = snap.endpoints.status === "value" ? snap.endpoints.value : [];
  if (r.internet.state === "on") {
    // Reachable-from-elsewhere endpoints only (not LAN / loopback); https preferred.
    const remote = eps.filter((e) => e.kind !== "lan" && e.kind !== "local");
    const tls = remote.find(isPairingEligible);
    if (tls) return tls;
    if (r.internet.address) return { kind: "public", url: r.internet.address, tls: /^https:/i.test(r.internet.address) };
    if (remote[0]) return remote[0];
  }
  if (r.lan.state === "on") {
    const tlsAny = eps.find((e) => isPairingEligible(e) && e.kind !== "local");
    if (tlsAny) return tlsAny;
    return eps.find((e) => e.kind === "lan") ?? null;
  }
  return null;
}

export type EndpointTransport = "https" | "lan-http" | "other-http";

/** How "Open it on the device" must treat an endpoint (design D5). */
export function endpointTransport(ep: TunnelEndpoint): EndpointTransport {
  if (isPairingEligible(ep)) return "https";
  return ep.kind === "lan" ? "lan-http" : "other-http";
}

// ── Step evaluation ──────────────────────────────────────────────────

export interface Evaluation {
  sat: Sat;
  /** Current value shown on a collapsed row (provider id, address, bind host…). */
  value?: string;
  /** Why `sat` is `"unknown"`. */
  pending?: "loading" | "error";
  /** Public address only: the reserved name is configured but the live share serves another. */
  degraded?: boolean;
}

const UNKNOWN_LOADING: Evaluation = { sat: "unknown", pending: "loading" };
const UNKNOWN_ERROR: Evaluation = { sat: "unknown", pending: "error" };

const unknownOf = (t: Tri<unknown>): Evaluation => (t.status === "loading" ? UNKNOWN_LOADING : UNKNOWN_ERROR);

/** Label for a step whose state is not known. */
export function unknownLabel(pending: "loading" | "error" | undefined): string {
  return pending === "error" ? "unknown" : "Checking…";
}

function effectiveProvider(snap: Snapshot): Tri<string> {
  const p = primaryProvider(snap);
  return p.status === "value" ? loaded(p.value ?? DEFAULT_PROVIDER) : p;
}

function connectedByThisServer(snap: Snapshot, provider: string): Tri<boolean> {
  if (snap.status.status !== "value") return snap.status;
  const s = snap.status.value;
  const list = s.connectedProviders ?? (s.status === "active" ? [DEFAULT_PROVIDER] : []);
  return loaded(list.includes(provider));
}

function degradedOf(snap: Snapshot): boolean {
  return snap.status.status === "value" && snap.status.value.status === "active" && !!snap.status.value.degraded;
}

/** Evaluate one step's satisfaction against current state. */
export function evaluate(step: StepId, snap: Snapshot, run?: RunState): Evaluation {
  switch (step) {
    case "provider": {
      const p = primaryProvider(snap);
      if (p.status !== "value") return unknownOf(p);
      return { sat: p.value !== undefined, value: p.value };
    }
    case "install": {
      const s = primaryReadiness(snap);
      if (s.status !== "value") return unknownOf(s);
      return { sat: s.value !== undefined && s.value !== "not-installed" };
    }
    case "enable": {
      const s = primaryReadiness(snap);
      if (s.status !== "value") return unknownOf(s);
      return { sat: s.value === "disconnected" || s.value === "connected" };
    }
    case "address": {
      const cfg = snap.config;
      if (cfg.status !== "value") return unknownOf(cfg);
      const z = cfg.value.tunnel?.zrok;
      const name = z?.reservedName;
      const degraded = !!name && degradedOf(snap);
      if (name && !degraded) return { sat: true, value: name };
      if (name && degraded) return { sat: false, value: name, degraded: true };
      // No name: satisfied only when the operator chose a temporary address.
      if (z?.persistent !== true) return { sat: true, value: "temporary" };
      return { sat: false };
    }
    case "connect": {
      const p = effectiveProvider(snap);
      if (p.status !== "value") return unknownOf(p);
      const c = connectedByThisServer(snap, p.value);
      if (c.status !== "value") return unknownOf(c);
      const r = internetRoad(snap);
      return { sat: c.value, value: c.value ? r.address : undefined };
    }
    case "bind": {
      const b = bindInfo(snap);
      if (b.status !== "value") return unknownOf(b);
      const live = !isLoopbackHost(b.value.resolved);
      return { sat: live, value: live ? bindLabel(b.value.resolved) : undefined };
    }
    case "accept": {
      const a = acceptsLanRequests(snap);
      if (a.status !== "value") return unknownOf(a);
      return { sat: a.value };
    }
    case "door": {
      if (run?.waived?.includes("door")) return { sat: true };
      if (snap.config.status !== "value") return unknownOf(snap.config);
      return { sat: openEntries(snap.config.value).length === 0 };
    }
    case "road": {
      if (run?.branch) return { sat: true };
      const r = roads(snap);
      const on = anyRoadOn(snap);
      if (on === "unknown") return { sat: "unknown", pending: r.internet.state === "unknown" || r.lan.state === "unknown" ? "error" : "loading" };
      if (!on) return { sat: false };
      return { sat: true, value: deviceEndpoint(snap)?.url };
    }
    // Action steps are never pre-satisfied — only a run completes them.
    default:
      return { sat: false };
  }
}

// ── Task plans ───────────────────────────────────────────────────────

const SHARE: StepId[] = ["provider", "install", "enable", "address", "connect", "door"];
const LAN: StepId[] = ["bind", "accept", "door"];
const CONNECT: StepId[] = ["machine", "reach", "ask", "finish"];
const WIFI: StepId[] = ["bind", "accept"];
const ANYWHERE: StepId[] = ["provider", "install", "enable", "address", "connect"];

/** Step ids a task lists, before applicability is filtered. */
function taskSteps(task: TaskId, run?: RunState): StepId[] {
  switch (task) {
    case "share":
      return SHARE;
    case "lan":
      return LAN;
    case "connect":
      return CONNECT;
    case "device": {
      const inserted = run?.branch === "wifi" ? WIFI : run?.branch === "anywhere" ? ANYWHERE : [];
      return ["road", ...inserted, "qr", "approve"];
    }
  }
}

/** A step that does not apply is omitted (and does not count toward "step K of N"). */
function applies(step: StepId, snap: Snapshot): boolean {
  if (step === "address") {
    const p = effectiveProvider(snap);
    // Not yet known → keep the row so the count does not jump when it loads.
    return p.status !== "value" || p.value === DEFAULT_PROVIDER;
  }
  return true;
}

type RowState = "current" | "todo" | "skipped" | "done";

export interface PlanRow {
  id: StepId;
  state: RowState;
  sat: Sat;
  value?: string;
  pending?: "loading" | "error";
  degraded?: boolean;
}

export interface Plan {
  rows: PlanRow[];
  /** The expanded step; `null` when every step is satisfied. */
  current: StepId | null;
  /** 1-based position of the current step among applicable steps. */
  k: number;
  n: number;
}

export function planTask(task: TaskId, snap: Snapshot, run: RunState = newRun(task)): Plan {
  const ids = taskSteps(task, run).filter((id) => applies(id, snap));
  const evals = ids.map((id) => {
    const ev = evaluate(id, snap, run);
    const doneNow = run.done.includes(id) || (id === "door" && !!run.waived?.includes("door"));
    return { id, ev, doneNow };
  });
  const resolvedCurrent =
    run.open && ids.includes(run.open)
      ? run.open
      : (evals.find((e) => !(e.doneNow || e.ev.sat === true))?.id ?? null);
  const rows: PlanRow[] = evals.map(({ id, ev, doneNow }) => {
    const satisfied = doneNow || ev.sat === true;
    let state: RowState;
    if (id === resolvedCurrent) state = "current";
    else if (satisfied) state = doneNow ? "done" : "skipped";
    else state = "todo";
    return { id, state, sat: doneNow ? true : ev.sat, value: ev.value, pending: ev.pending, degraded: ev.degraded };
  });
  const idx = rows.findIndex((r) => r.id === resolvedCurrent);
  return { rows, current: resolvedCurrent, k: idx >= 0 ? idx + 1 : rows.length, n: rows.length };
}

// ── Folding ──────────────────────────────────────────────────────────

export type FoldItem =
  | { kind: "row"; row: PlanRow }
  /** Two or more consecutive collapsed rows; `anyDone` flips the label to "N steps done". */
  | { kind: "fold"; rows: PlanRow[]; anyDone: boolean };

const collapsed = (r: PlanRow) => r.state === "skipped" || r.state === "done";

export function foldRows(rows: PlanRow[], showSkipped = false): FoldItem[] {
  const out: FoldItem[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!showSkipped && collapsed(rows[i])) {
      let j = i;
      while (j < rows.length && collapsed(rows[j])) j++;
      const run = rows.slice(i, j);
      if (run.length >= 2) {
        out.push({ kind: "fold", rows: run, anyDone: run.some((r) => r.state === "done") });
      } else {
        out.push({ kind: "row", row: run[0] });
      }
      i = j;
    } else {
      out.push({ kind: "row", row: rows[i] });
      i++;
    }
  }
  return out;
}

// ── Hints ────────────────────────────────────────────────────────────

export type TaskHint = { kind: "loading" } | { kind: "ready" } | { kind: "steps"; n: number };

/** Landing hint, derived from the task's own plan: outstanding steps, or Ready. */
export function taskHint(task: TaskId, snap: Snapshot): TaskHint {
  const plan = planTask(task, snap);
  if (task === "connect") return { kind: "steps", n: plan.rows.length };
  if (plan.rows.some((r) => r.sat === "unknown")) return { kind: "loading" };
  const outstanding = plan.rows.filter((r) => r.sat !== true).length;
  return outstanding === 0 ? { kind: "ready" } : { kind: "steps", n: outstanding };
}

// ── Approve completion ───────────────────────────────────────────────

export interface PairedDeviceLike {
  id: string;
  label: string;
}

export type ApproveOutcome = { kind: "paired"; devices: PairedDeviceLike[] } | { kind: "denied" };

/**
 * Approve completion (design D6): the request left the pending list; diff the
 * paired-device list taken when it appeared against a fresh read. `PairedDeviceView`
 * carries no `pendingId`, so a diff is the only join available.
 */
export function approveOutcome(beforeIds: readonly string[], after: readonly PairedDeviceLike[]): ApproveOutcome {
  const known = new Set(beforeIds);
  const added = after.filter((d) => !known.has(d.id));
  return added.length > 0 ? { kind: "paired", devices: added } : { kind: "denied" };
}

// ── Toolbar helper shared with the landing ───────────────────────────

/** Count of networks admitted without authentication that are not loopback-only. */
export function unauthenticatedNetworkCount(snap: Snapshot): number | null {
  return snap.config.status === "value" ? openEntries(snap.config.value).length : null;
}
