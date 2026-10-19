/**
 * Page-level store behind the file-handler layer: live instances, the pane
 * registration (anchor element + active key), pending dialogs and copy notices.
 * A module singleton because the cap (`MAX_LIVE_HANDLERS`) and "an instance
 * survives pane close / tab / session switch" are per BROWSER PAGE, not per
 * `EditorPane`. React reads it through `useSyncExternalStore`.
 *
 * Owns the policy that needs no network: mount planning (cap + clean-only LRU
 * eviction), the leave guard, non-keepAlive inactive close, plugin-disable hold.
 *
 * See change: add-editor-pane-file-handlers (D5).
 */
import { type DirtyState, type HandlerClaim, isGuarded, type LiveLite, planMount } from "./file-handler-logic.js";

export interface HandlerInstance {
  key: string;
  sessionId: string;
  cwd: string;
  /** Normalised cwd-relative path. */
  path: string;
  claim: HandlerClaim;
  dirty: DirtyState;
  /** Monotonic activation clock (LRU). */
  lastActivated: number;
  /** Bumped by `remount`/`resume`; the host is keyed by it. */
  nonce: number;
  /** Closed to save memory; the tab shows "Resume". */
  evicted: boolean;
  /** Plugin disabled live while unsaved: held with an overlay. */
  disabled: boolean;
  /** Snapshot refused (too large): mode shown unavailable with the limit. */
  unavailableLimit?: number;
  /** The first-overwrite notice was confirmed by this instance. */
  firstOverwriteDone: boolean;
}

export interface PaneRegistration {
  sessionId: string;
  /** Session-pane body element the overlay is anchored to (`null` = not mounted). */
  anchor: HTMLElement | null;
  /** Key of the active tab's handler instance, or `null`. */
  activeKey: string | null;
  /** Revert a tab to the built-in view (aborted mount / unavailable / discard). */
  clearMode(path: string): void;
}

export type GuardReason = "mode-switch" | "close-tab" | "refresh" | "reload" | "disable";

export type DialogSpec =
  | { kind: "first-overwrite"; label: string; notice: string }
  | { kind: "conflict"; label: string; gone: boolean; dirty: boolean }
  | { kind: "confirm"; reason: GuardReason; label: string; unknown: boolean }
  | { kind: "blocked"; tabs: Array<{ key: string; path: string; label: string }> };

interface DialogEntry {
  id: number;
  ownerKey: string | null;
  spec: DialogSpec;
  // biome-ignore lint/suspicious/noExplicitAny: result type is per-kind, enforced at the `ask` call site
  resolve: (v: any) => void;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  cancelValue: any;
}

interface CopyNotice {
  id: number;
  sessionId: string;
  path: string;
}

export interface StoreState {
  instances: ReadonlyMap<string, HandlerInstance>;
  pane: PaneRegistration | null;
  dialogs: readonly DialogEntry[];
  notices: readonly CopyNotice[];
}

export type ActivateSpec = Pick<HandlerInstance, "key" | "sessionId" | "cwd" | "path" | "claim">;
export type ActivateResult = "live" | "evicted" | "blocked";

export class FileHandlerStore {
  private state: StoreState = { instances: new Map(), pane: null, dialogs: [], notices: [] };
  private listeners = new Set<() => void>();
  private clock = 0;
  private seq = 0;
  /** A mount that was blocked by the cap, waiting on the user's choice. */
  private pendingMount: { spec: ActivateSpec; fromResume: boolean } | null = null;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = (): StoreState => this.state;

  private set(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private tick = (): number => ++this.clock;
  get = (key: string): HandlerInstance | undefined => this.state.instances.get(key);

  private put(inst: HandlerInstance): void {
    this.set({ instances: new Map(this.state.instances).set(inst.key, inst) });
  }
  private patch(key: string, p: Partial<HandlerInstance>): void {
    const cur = this.get(key);
    if (cur) this.put({ ...cur, ...p });
  }

  private live(): HandlerInstance[] {
    return [...this.state.instances.values()].filter((i) => !i.evicted);
  }
  private lites(): LiveLite[] {
    return this.live().map((i) => ({ key: i.key, claimRef: i.claim.ref, dirty: i.dirty, lastActivated: i.lastActivated }));
  }

  /** Whether any live instance is unsaved/unknown (drives `beforeunload`). */
  hasUnsaved = (): boolean => this.live().some((i) => isGuarded(i.dirty));

  // ── pane registration ───────────────────────────────────────────────────
  setPane(pane: PaneRegistration | null): void {
    const prev = this.state.pane;
    const same =
      prev && pane && prev.sessionId === pane.sessionId && prev.anchor === pane.anchor && prev.activeKey === pane.activeKey && prev.clearMode === pane.clearMode;
    if (same) return;
    this.set({ pane });
    if (pane?.activeKey && pane.activeKey !== prev?.activeKey) this.patch(pane.activeKey, { lastActivated: this.tick() });
    this.sweepInactive();
  }

  /**
   * Non-keepAlive claims close when their tab becomes inactive, only if clean;
   * dirty/unknown stay mounted hidden (and count toward the cap).
   */
  private sweepInactive(): void {
    const pane = this.state.pane;
    if (!pane) return;
    for (const i of this.live()) {
      if (i.sessionId === pane.sessionId && i.key !== pane.activeKey && !i.claim.keepAlive && i.dirty === false) this.destroy(i.key);
    }
  }

  // ── mount / eviction ────────────────────────────────────────────────────
  /** Ensure an instance exists for the active tab. Idempotent. */
  activate(spec: ActivateSpec): ActivateResult {
    const cur = this.get(spec.key);
    if (cur) return cur.evicted ? "evicted" : "live";
    return this.mount(spec, false);
  }

  /** "Resume" on an evicted tab: fresh mount + snapshot, subject to the cap again. */
  resume(key: string): ActivateResult {
    const cur = this.get(key);
    if (!cur) return "blocked";
    if (!cur.evicted) return "live";
    return this.mount(cur, true);
  }

  private mount(spec: ActivateSpec, fromResume: boolean): ActivateResult {
    // One blocked dialog per mount attempt (the pane effect re-runs `activate`).
    if (this.pendingMount?.spec.key === spec.key) return "blocked";
    const plan = planMount(this.lites(), { key: spec.key, claimRef: spec.claim.ref, keepAliveMax: spec.claim.keepAliveMax });
    if (plan.kind === "blocked") {
      this.pendingMount = { spec, fromResume };
      const tabs = plan.keys.flatMap((k) => {
        const i = this.get(k);
        return i ? [{ key: k, path: i.path, label: i.claim.label }] : [];
      });
      void this.ask<"cancel" | { discard: string }>({ kind: "blocked", tabs }, "cancel").then((r) => this.resolveBlocked(r));
      return "blocked";
    }
    if (plan.kind === "evict") this.patch(plan.key, { evicted: true, dirty: false });
    const base = this.get(spec.key);
    this.put({
      key: spec.key,
      sessionId: spec.sessionId,
      cwd: spec.cwd,
      path: spec.path,
      claim: spec.claim,
      dirty: "unknown",
      lastActivated: this.tick(),
      nonce: (base?.nonce ?? 0) + 1,
      evicted: false,
      disabled: false,
      firstOverwriteDone: base?.firstOverwriteDone ?? false,
    });
    return "live";
  }

  private resolveBlocked(r: "cancel" | { discard: string }): void {
    const pending = this.pendingMount;
    this.pendingMount = null;
    if (!pending) return;
    if (r === "cancel") {
      // An aborted first mount reverts the tab to the built-in view; a cancelled Resume keeps the placeholder.
      if (!pending.fromResume) this.state.pane?.clearMode(pending.spec.path);
      return;
    }
    this.destroy(r.discard);
    this.mount(pending.spec, pending.fromResume);
  }

  // ── instance state ──────────────────────────────────────────────────────
  setDirty(key: string, d: DirtyState): void {
    const cur = this.get(key);
    if (!cur || cur.dirty === d) return;
    this.patch(key, { dirty: d });
    this.sweepInactive();
  }
  setUnavailable(key: string, limit: number): void {
    this.patch(key, { unavailableLimit: limit, dirty: false });
  }
  setDisabled(key: string, disabled: boolean): void {
    if (this.get(key)?.disabled !== disabled) this.patch(key, { disabled });
  }
  markFirstOverwriteDone(key: string): void {
    this.patch(key, { firstOverwriteDone: true });
  }
  /** Re-mount the handler from a fresh snapshot (state back to `"unknown"`). */
  remount(key: string): void {
    const cur = this.get(key);
    if (cur) this.put({ ...cur, nonce: cur.nonce + 1, dirty: "unknown", evicted: false, unavailableLimit: undefined });
  }
  /** Drop an instance (the caller already passed the guard) and cancel its pending dialogs. */
  destroy(key: string): void {
    if (!this.get(key)) return;
    const instances = new Map(this.state.instances);
    instances.delete(key);
    const gone = this.state.dialogs.filter((d) => d.ownerKey === key);
    this.set({ instances, dialogs: this.state.dialogs.filter((d) => d.ownerKey !== key) });
    for (const d of gone) d.resolve(d.cancelValue);
  }

  /** The leave guard: resolve `true` to proceed. `false` instances pass without a dialog. */
  guard(key: string, reason: GuardReason): Promise<boolean> {
    const inst = this.get(key);
    if (!inst || !isGuarded(inst.dirty)) return Promise.resolve(true);
    return this.ask<boolean>({ kind: "confirm", reason, label: inst.claim.label, unknown: inst.dirty === "unknown" }, false, key);
  }

  // ── dialogs / notices ───────────────────────────────────────────────────
  ask<R>(spec: DialogSpec, cancelValue: R, ownerKey: string | null = null): Promise<R> {
    return new Promise<R>((resolve) => {
      this.set({ dialogs: [...this.state.dialogs, { id: ++this.seq, ownerKey, spec, resolve, cancelValue }] });
    });
  }
  /** Settle the head dialog with `value`. */
  answer(id: number, value: unknown): void {
    const d = this.state.dialogs.find((x) => x.id === id);
    if (!d) return;
    this.set({ dialogs: this.state.dialogs.filter((x) => x.id !== id) });
    d.resolve(value);
  }
  /** Dismiss a dialog with its cancel value (Escape / overlay click). */
  cancelDialog(id: number): void {
    const d = this.state.dialogs.find((x) => x.id === id);
    if (d) this.answer(id, d.cancelValue);
  }
  notifyCopy(sessionId: string, path: string): void {
    this.set({ notices: [...this.state.notices, { id: ++this.seq, sessionId, path }] });
  }
  dismissNotice(id: number): void {
    if (this.state.notices.some((n) => n.id === id)) this.set({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  /** Test helper: drop everything (singleton hygiene). */
  reset(): void {
    this.state = { instances: new Map(), pane: null, dialogs: [], notices: [] };
    this.pendingMount = null;
    this.clock = 0;
    for (const l of this.listeners) l();
  }
}

/** The page-wide store. */
export const fileHandlerStore = new FileHandlerStore();
