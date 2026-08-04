/**
 * Package operation queue — single-source-of-truth FIFO scheduler for
 * pi package install/remove/update operations across the client.
 *
 * Why this exists: the server's `packageManagerWrapper` enforces strict
 * single-flight (one op at a time, second concurrent op → 409). Before
 * this module existed, every component that wanted to install something
 * mounted its own `usePackageOperations` hook with a single state slot,
 * so a second click stomped the first click's state, the original
 * spinner orphaned, and the second POST often 409'd.
 *
 * This singleton owns:
 *   - the running op (at most one, across ALL operation kinds)
 *   - a FIFO queue of pending ops
 *   - a per-`source` status map (idle/queued/running/success/error)
 *   - the `pi-package-event` window listener that advances the queue
 *     when `package_operation_complete` arrives, and the
 *     `pi-core-event` listener that streams pi-core progress.
 *
 * Two operation kinds ride the same FIFO because they contend for the
 * same server-side busy lock (`PackageManagerWrapper.busy`):
 *   - `"extension"` — POST `/api/packages/{action}` → 202 + operationId,
 *     completion arrives asynchronously via `package_operation_complete`.
 *   - `"pi-core"` — POST `/api/pi-core/update` → blocks until the install
 *     finishes; completion is carried by the response body. The
 *     `pi_core_update_complete` WS frame is deliberately IGNORED: the
 *     server broadcasts it before returning the HTTP response, so it
 *     nearly always arrives first and would complete the op early.
 *
 * The queue carries NO package-manager knowledge. It posts a package name
 * and renders whatever the server reports; the server picks the package
 * manager (see `detectPackageManager` in `lifecycle/recovery-server.ts`,
 * change: cf18e682). Only ONE response shape is a 409 (the busy lock), so
 * package-manager-level failures — e.g. pi 0.82 requiring a `pnpm store
 * prune` before a pnpm-installed core package can update — reach the row
 * as their own verbatim message via `results[].error`.
 *
 * Pi-core sources use the `pi-core:<scoped-npm-name>` prefix convention
 * (see `piCoreSource`). The prefix is documentation; `kind` is the
 * dispatch key.
 *
 * React subscribers consume it via `usePackageQueue()` (see
 * `usePackageOperations.ts`) and re-render when `subscribe`'s callback
 * fires.
 *
 * See change: unify-pi-core-into-package-queue.
 */

import { getApiBase } from "../api/api-context.js";
import { t as i18nT } from "../i18n/i18n.js";

export type PackageScope = "global" | "local";
export type PackageAction = "install" | "remove" | "update";
export type PackageOperationStatus = "idle" | "queued" | "running" | "success" | "error";
export type PackageOpKind = "extension" | "pi-core";

/** Source-key prefix for pi-core ops. Convention, not the dispatch key. */
export const PI_CORE_SOURCE_PREFIX = "pi-core:";

/** Build the queue source key for a pi-core package's full scoped npm name. */
export function piCoreSource(name: string): string {
  return PI_CORE_SOURCE_PREFIX + name;
}

export interface EnqueueRequest {
  source: string;
  action: PackageAction;
  scope: PackageScope;
  cwd?: string;
  /** Dispatch discriminator. Defaults to `"extension"`. */
  kind?: PackageOpKind;
}

export interface RunningOp {
  operationId: string | null; // null between POST and POST-resolve
  source: string;
  kind: PackageOpKind;
  action: PackageAction;
  scope: PackageScope;
  cwd?: string;
  message: string;
  /** Number of 409 retries already attempted for this op. */
  retries: number;
}

interface QueuedOp {
  source: string;
  kind: PackageOpKind;
  action: PackageAction;
  scope: PackageScope;
  cwd?: string;
  /** Optional callback fired once when this op completes. */
  onComplete?: (success: boolean, error?: string) => void;
  /** 409-retry counter carried across re-prepends. */
  retries: number;
}

interface ErrorState {
  message: string;
}

interface SuccessState {
  message: string;
}

const RETRY_BACKOFF_MS = 500;
const SUCCESS_AUTOCLEAR_MS = 3000;

class PackageQueue {
  private running: RunningOp | null = null;
  private queue: QueuedOp[] = [];
  private successBySource = new Map<string, SuccessState>();
  private errorBySource = new Map<string, ErrorState>();
  private listeners = new Set<() => void>();
  private autoClearTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Callbacks waiting for the running op to complete. */
  private pendingCompleteCallbacks: Array<(success: boolean, error?: string) => void> = [];
  /** Listeners notified on every successful completion (for installed-list refresh). */
  private completionListeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("pi-package-event", this.onWindowEvent);
      window.addEventListener("pi-core-event", this.onPiCoreEvent);
    }
  }

  // ── Public API ────────────────────────────────────────────────

  enqueue(req: EnqueueRequest, onComplete?: (success: boolean, error?: string) => void): void {
    const status = this.getStateForSource(req.source);
    if (status === "running" || status === "queued") {
      // Dedup — drop duplicate enqueues silently.
      return;
    }
    // Clear any sticky error/success for this source on fresh enqueue.
    this.errorBySource.delete(req.source);
    this.successBySource.delete(req.source);
    const existingTimer = this.autoClearTimers.get(req.source);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.autoClearTimers.delete(req.source);
    }

    const op: QueuedOp = { ...req, kind: req.kind ?? "extension", retries: 0, onComplete };
    if (this.running === null) {
      this.startOperation(op);
    } else {
      this.queue.push(op);
      this.notify();
    }
  }

  getStateForSource(source: string): PackageOperationStatus {
    if (this.running?.source === source) return "running";
    if (this.queue.some((q) => q.source === source)) return "queued";
    if (this.errorBySource.has(source)) return "error";
    if (this.successBySource.has(source)) return "success";
    return "idle";
  }

  getMessageForSource(source: string): string {
    if (this.running?.source === source) return this.running.message;
    if (this.errorBySource.has(source)) return this.errorBySource.get(source)!.message;
    if (this.successBySource.has(source)) return this.successBySource.get(source)!.message;
    return "";
  }

  getRunning(): RunningOp | null {
    return this.running;
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  /** True while any op — of any kind — holds the single-flight slot. */
  isAnyRunning(): boolean {
    return this.running !== null;
  }

  /** Subscribe to ANY state transition. Returns unsubscribe fn. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Subscribe to per-completion notifications (regardless of source). */
  onAnyCompletion(cb: () => void): () => void {
    this.completionListeners.add(cb);
    return () => {
      this.completionListeners.delete(cb);
    };
  }

  // ── Test hook ─────────────────────────────────────────────────

  __resetForTests(): void {
    this.running = null;
    this.queue = [];
    this.successBySource.clear();
    this.errorBySource.clear();
    this.pendingCompleteCallbacks = [];
    for (const t of this.autoClearTimers.values()) clearTimeout(t);
    this.autoClearTimers.clear();
    this.notify();
  }

  // ── Internal ──────────────────────────────────────────────────

  private startOperation(op: QueuedOp): void {
    this.running = {
      operationId: null,
      source: op.source,
      kind: op.kind,
      action: op.action,
      scope: op.scope,
      cwd: op.cwd,
      message: i18nT("status.starting", undefined, "Starting…"),
      retries: op.retries,
    };
    if (op.onComplete) this.pendingCompleteCallbacks.push(op.onComplete);
    this.notify();

    void this.postOperation(op);
  }

  private async postOperation(op: QueuedOp): Promise<void> {
    switch (op.kind) {
      case "pi-core":
        await this.postPiCoreUpdate(op);
        return;
      case "extension":
        await this.postExtensionOperation(op);
        return;
    }
  }

  /**
   * 409 retry-once policy, shared by both dispatch arms: drop the
   * running slot, re-prepend the op, and re-start it after a short
   * backoff. Returns `true` when a retry was scheduled.
   */
  private scheduleRetry(op: QueuedOp): boolean {
    if (op.retries >= 1) return false;
    const retried: QueuedOp = { ...op, retries: op.retries + 1 };
    this.running = null;
    this.queue.unshift(retried);
    this.notify();
    setTimeout(() => {
      // Only fire if nothing else jumped in (which can't, because
      // running is null and retried is at head — but be defensive).
      if (this.running === null && this.queue[0]?.source === retried.source) {
        const head = this.queue.shift()!;
        this.startOperation(head);
      }
    }, RETRY_BACKOFF_MS);
    return true;
  }

  /**
   * Pi-core arm. Completion is signalled by the POST response — the
   * `pi_core_update_complete` WS frame is ignored (see module header).
   * Always sent as a single-name batch so per-row state stays keyed by
   * strict source equality.
   */
  private async postPiCoreUpdate(op: QueuedOp): Promise<void> {
    const name = op.source.slice(PI_CORE_SOURCE_PREFIX.length);
    let res: Response;
    let body: any;
    try {
      res = await fetch(`${getApiBase()}/api/pi-core/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packages: [name] }),
      });
      body = await res.json().catch(() => ({}));
    } catch (err: any) {
      this.completeRunning(false, err?.message ?? "Network error");
      return;
    }

    // Stale guard: reset/cancellation during the await.
    if (this.running?.source !== op.source) return;

    if (res.status === 409) {
      if (this.scheduleRetry(op)) return;
      this.completeRunning(false, body?.error ?? "Server busy");
      return;
    }

    if (!res.ok || body?.success === false) {
      this.completeRunning(false, body?.error ?? `HTTP ${res.status}`);
      return;
    }

    // Single-name batch in → at most one result out.
    const results = body?.data?.results;
    if (Array.isArray(results) && results.length === 0) {
      // Server resolved nothing updatable (e.g. `updateAvailable` flipped
      // false between render and click). "Nothing to do" is not a failure —
      // reporting it as one paints a red error on a healthy row.
      this.completeRunning(true, undefined, "Already up to date");
      return;
    }

    const result = results?.[0];
    if (result?.success) {
      this.completeRunning(true, undefined, "Update complete");
    } else {
      // Propagate the server's message verbatim. Package-manager-specific
      // failures (e.g. pi 0.82's pnpm cache-prune requirement) arrive here
      // as HTTP 200 + `success: false`, NOT as a 409, so they must never be
      // flattened into the generic busy text.
      this.completeRunning(false, result?.error ?? `Update failed for ${name}`);
    }
  }

  private async postExtensionOperation(op: QueuedOp): Promise<void> {
    let res: Response;
    let body: any;
    try {
      res = await fetch(`${getApiBase()}/api/packages/${op.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: op.source, scope: op.scope, cwd: op.cwd }),
      });
      body = await res.json().catch(() => ({}));
    } catch (err: any) {
      this.completeRunning(false, err?.message ?? "Network error");
      return;
    }

    // Stale guard: if reset/cancellation happened during the await,
    // bail out without mutating state.
    if (this.running?.source !== op.source) return;

    if (res.status === 409) {
      if (this.scheduleRetry(op)) return;
      // Out of retries → error and advance.
      this.completeRunning(false, body?.error ?? "Server busy");
      return;
    }

    if (!res.ok || body?.success === false) {
      this.completeRunning(false, body?.error ?? `HTTP ${res.status}`);
      return;
    }

    const opId: string | undefined = body?.data?.operationId;
    if (!opId) {
      this.completeRunning(false, "Server returned no operationId");
      return;
    }
    this.running.operationId = opId;
    this.running.message = "Running…";
    this.notify();
  }

  /**
   * Match an incoming WS message to the running op.
   *
   * Race window: when the queue POSTs an operation, the server may finish
   * faster than the HTTP response round-trip (notably for local-path
   * installs that have no network step). The `package_operation_complete`
   * WS frame can therefore arrive while `running.operationId` is still
   * `null` (we haven't parsed `body.data.operationId` yet). Strict
   * `operationId === operationId` matching during that window silently
   * drops legitimate completions — the spinner sticks and the queue
   * jams. See change: fix-local-path-install-spinner.
   *
   * Source-fallback during the null-opId window is unambiguous because
   * `PackageManagerWrapper.busy` enforces at-most-one-in-flight per
   * server, so we cannot have a second op for the same source running
   * concurrently. Once `operationId` is known, prefer it: it survives
   * any future server-side source canonicalization.
   */
  private matchesRunning(opId: string | undefined, source: string | undefined): boolean {
    if (!this.running) return false;
    if (this.running.operationId !== null) {
      return this.running.operationId === opId;
    }
    return this.running.source === source;
  }

  private onWindowEvent = (e: Event) => {
    const msg = (e as CustomEvent).detail;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "package_progress") {
      // PackageProgressMessage shape: { type, operationId, event: { source, action, type, message } }
      // Source lives on the nested `event` object, not the top-level message.
      if (this.matchesRunning(msg.operationId, msg.event?.source)) {
        this.running!.message = msg.event?.message ?? `${msg.event?.action}: ${msg.event?.type}`;
        this.notify();
      }
      return;
    }
    if (msg.type === "package_operation_complete") {
      // PackageOperationCompleteMessage shape: { type, operationId, source, action, ... }
      // Source is top-level here.
      if (!this.matchesRunning(msg.operationId, msg.source)) return;
      const errorMsg = msg.success ? undefined : (msg.error ?? "Operation failed");
      const successMsg = msg.success
        ? `${msg.action} complete${msg.sessionsReloaded ? ` (${msg.sessionsReloaded} sessions reloaded)` : ""}`
        : "";
      this.completeRunning(!!msg.success, errorMsg, successMsg);
    }
  };

  /**
   * `pi-core-event` channel. Only progress is consumed:
   * `pi_core_update_complete` is a deliberate no-op because the server
   * broadcasts it BEFORE returning the HTTP response that actually
   * carries the result (see module header / design R4).
   */
  private onPiCoreEvent = (e: Event) => {
    const msg = (e as CustomEvent).detail;
    if (!msg || typeof msg !== "object") return;
    if (msg.type !== "pi_core_update_progress") return;
    if (typeof msg.name !== "string") return;
    const running = this.running;
    if (!running || running.kind !== "pi-core") return;
    if (running.source !== piCoreSource(msg.name)) return;
    running.message = msg.message ?? `${msg.name}: ${msg.phase}`;
    this.notify();
  };

  private completeRunning(success: boolean, errorMsg?: string, successMsg?: string): void {
    if (!this.running) return;
    const source = this.running.source;
    if (success) {
      this.successBySource.set(source, { message: successMsg ?? "Done" });
      const t = setTimeout(() => {
        this.successBySource.delete(source);
        this.autoClearTimers.delete(source);
        this.notify();
      }, SUCCESS_AUTOCLEAR_MS);
      this.autoClearTimers.set(source, t);
    } else {
      this.errorBySource.set(source, { message: errorMsg ?? "Operation failed" });
    }

    // Fire pending completion callbacks (drain).
    const cbs = this.pendingCompleteCallbacks;
    this.pendingCompleteCallbacks = [];
    this.running = null;
    for (const cb of cbs) {
      try { cb(success, errorMsg); } catch { /* ignore */ }
    }
    if (success) {
      for (const cb of this.completionListeners) {
        try { cb(); } catch { /* ignore */ }
      }
    }

    // Advance.
    const next = this.queue.shift();
    if (next) {
      this.startOperation(next);
    } else {
      this.notify();
    }
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try { cb(); } catch { /* ignore */ }
    }
  }
}

export const packageQueue = new PackageQueue();
