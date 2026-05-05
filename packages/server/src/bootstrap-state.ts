import type { DashboardStarter } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";

/**
 * In-memory bootstrap state store for the dashboard server.
 *
 * Tracks the degraded-mode status during first-run pi install, upgrade
 * operations, and version-skew detection. Subscribers (browser gateway,
 * CLI progress printer) receive a snapshot on every `set()` call.
 *
 * See change: unified-bootstrap-install.
 */

export type BootstrapStatus = "ready" | "installing" | "failed";

export interface BootstrapProgress {
  /** Package / phase being processed (e.g. "pi-coding-agent", "bridge-register"). */
  step: string;
  /** Optional completion percentage (0..100). */
  pct?: number;
  /** Last line of npm output or other streaming context. */
  output?: string;
}

export interface BootstrapError {
  message: string;
  stack?: string;
}

export interface BootstrapVersions {
  pi?: string;
  openspec?: string;
  tsx?: string;
}

export interface BootstrapCompatibility {
  minimum: string;
  recommended: string;
  /** null = no upper bound enforced yet. */
  maximum: string | null;
  /** Current resolved pi version, or undefined when pi is unresolved. */
  current?: string;
  /** Hint that the user should upgrade pi (below recommended). */
  upgradeRecommended?: boolean;
  /** Hint that the user should upgrade the dashboard itself (above maximum). */
  upgradeDashboard?: boolean;
}

export interface BootstrapState {
  status: BootstrapStatus;
  progress?: BootstrapProgress;
  error?: BootstrapError;
  version?: BootstrapVersions;
  compatibility?: BootstrapCompatibility;
  /** Set when `registerBridgeExtension` fails after a successful install. */
  bridgeRegistrationError?: string;
  /**
   * Who started this server process. Defaults to "Standalone" (direct CLI).
   * Set at boot time from `parseDashboardStarter(process.env)`.
   */
  starter?: DashboardStarter;
  /**
   * Installable list reconciliation progress.
   * Set by bootstrapInstallFromList during Phase B reconcile.
   * See change: simplify-electron-bootstrap-derived-state.
   */
  installable?: {
    total: number;
    installed: number;
    /** Package names that failed to install. */
    failed: string[];
  };
}

export type BootstrapListener = (state: BootstrapState) => void;

export interface BootstrapStateStore {
  get(): BootstrapState;
  /**
   * Merge `partial` into the current state. Passing `undefined` for a
   * key explicitly clears it (e.g. `set({ progress: undefined })` removes
   * the progress line after completion). Broadcasts to all subscribers.
   */
  set(partial: Partial<BootstrapState>): void;
  subscribe(listener: BootstrapListener): () => void;
  /** Clear all listeners (used in tests + server shutdown). */
  dispose(): void;
  /**
   * Record the package list used by the most recent `bootstrapInstall`
   * call. Used by `POST /api/bootstrap/retry` to re-run the exact failed
   * set rather than a hard-coded default. Not part of the WS-broadcast
   * snapshot — it's purely side-channel metadata for the server.
   * See change: unified-bootstrap-install (verification follow-up).
   */
  setLastInstallPackages(packages: readonly string[]): void;
  /** Read the last install set. Returns a fresh copy. */
  getLastInstallPackages(): string[];
}

/**
 * Create a fresh bootstrap state store. `initial` is merged over the
 * default `{ status: "ready" }`.
 */
export function createBootstrapState(
  initial?: Partial<BootstrapState>,
): BootstrapStateStore {
  let state: BootstrapState = { status: "ready", ...initial };
  let lastInstallPackages: string[] = [];
  const listeners = new Set<BootstrapListener>();

  function notify(): void {
    const snapshot = { ...state };
    for (const l of listeners) {
      try {
        l(snapshot);
      } catch (err) {
        // Listener errors are non-fatal — log but continue.
        console.error("[bootstrap-state] listener threw:", err);
      }
    }
  }

  return {
    get() {
      return { ...state };
    },
    set(partial) {
      // Merge: explicit `undefined` in partial clears the field.
      state = { ...state, ...partial } as BootstrapState;
      // Strip keys whose value is undefined to keep the snapshot tidy.
      for (const key of Object.keys(partial) as (keyof BootstrapState)[]) {
        if (partial[key] === undefined) delete state[key];
      }
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
    },
    setLastInstallPackages(packages) {
      lastInstallPackages = [...packages];
    },
    getLastInstallPackages() {
      return [...lastInstallPackages];
    },
  };
}
