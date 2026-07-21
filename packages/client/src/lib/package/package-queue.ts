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
 *   - the running op (at most one)
 *   - a FIFO queue of pending ops
 *   - a per-`source` status map (idle/queued/running/success/error)
 *   - the single `pi-package-event` window listener that advances the
 *     queue when `package_operation_complete` arrives.
 *
 * React subscribers consume it via `usePackageQueue()` (see
 * `usePackageOperations.ts`) and re-render when `subscribe`'s callback
 * fires.
 */

import { getApiBase } from "../api/api-context.js";
import { t as i18nT } from "../i18n/i18n.js";

export type PackageScope = "global" | "local";
export type PackageAction = "install" | "remove" | "update";
export type PackageOperationStatus = "idle" | "queued" | "running" | "success" | "error";

export interface EnqueueRequest {
  source: string;
  action: PackageAction;
  scope: PackageScope;
  cwd?: string;
}

export interface RunningOp {
  operationId: string | null; // null between POST and POST-resolve
  source: string;
  action: PackageAction;
  scope: PackageScope;
  cwd?: string;
  message: string;
  /** Number of 409 retries already attempted for this op. */
  retries: number;
}

interface QueuedOp {
  source: string;
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

    if (this.running === null) {
      this.startOperation({ ...req, retries: 0, onComplete });
    } else {
      this.queue.push({ ...req, retries: 0, onComplete });
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
      // Retry-once policy.
      if (op.retries < 1) {
        const retried: QueuedOp = { ...op, retries: op.retries + 1 };
        // Drop running, schedule retry at head.
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
        return;
      }
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
