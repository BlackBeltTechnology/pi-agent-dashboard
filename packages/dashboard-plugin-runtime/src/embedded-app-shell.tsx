// Shell services for embedded plugin apps (`<EmbeddedApp>`), injected by the
// client. The runtime cannot import client code, so `App.tsx` mounts
// `<EmbeddedAppShellProvider>` with the dashboard's authenticated transport and
// folder codec. This module is React-only and does NOT import app-kit, so the
// runtime root stays free of the app-kit dependency; `<EmbeddedApp>` itself
// lives behind the `./embedded-app` subpath.
// See change: add-plugin-app-host (D4, D5).
import { createContext, type ReactNode, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { useRuntimeT } from "./plugin-context.js";

// ── Path validation (D5) ─────────────────────────────────────────────────────

const UNSAFE_CHARS = /[\\\s\u0000-\u001f\u007f]/;

/**
 * Whether `path` is a root-relative, scheme-free dashboard path: starts with
 * exactly one `/`; no `\`, whitespace or control char (raw or percent-decoded);
 * no `.`/`..` segment after decoding. With `allowApps: false` (the
 * `navigateDashboard` rule) the first segment may not be `apps`. Query and hash
 * are allowed but checked for the same characters.
 */
export function isSafeDashboardPath(path: string, opts: { allowApps?: boolean } = {}): boolean {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return false;
  if (UNSAFE_CHARS.test(path)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.startsWith("//") || UNSAFE_CHARS.test(decoded)) return false;
  const pathname = decoded.split(/[?#]/, 1)[0] ?? "";
  const segs = pathname.split("/");
  if (segs.some((s) => s === "." || s === "..")) return false;
  if (!opts.allowApps && segs[1]?.toLowerCase() === "apps") return false;
  return true;
}

// ── Return target (D5 return pill) ───────────────────────────────────────────

export interface ReturnTarget {
  appId: string;
  /** App title shown in the pill. */
  title: string;
  /** Last `setTitle()` value, else the folder name, else "". */
  context: string;
  /** The app's full path at navigation time — what the pill pushes. */
  href: string;
  /** The destination path the pill shows on. */
  dest: string;
}

export interface ReturnTargetStore {
  get(): ReturnTarget | null;
  set(target: ReturnTarget): void;
  clear(): void;
  subscribe(cb: () => void): () => void;
}

/** In-memory, one target at a time (a newer one replaces it); lost on reload. */
export function createReturnTargetStore(): ReturnTargetStore {
  let current: ReturnTarget | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    get: () => current,
    set(target) {
      current = target;
      emit();
    },
    clear() {
      if (current === null) return;
      current = null;
      emit();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

// ── Shell services context ───────────────────────────────────────────────────

export interface EmbeddedAppShell {
  /** Authenticated same-origin fetch. Rejects any path that is not root-relative and scheme-free. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Socket URL with a single-use ticket when the dashboard needs one; `null` for a refused path. */
  wsUrl(path: string): Promise<string | null>;
  encodeFolder(cwd: string): string;
  /** `null` when `encoded` is not a valid folder token. */
  decodeFolder(encoded: string): string | null;
  returnTarget: ReturnTargetStore;
}

const ShellContext = createContext<EmbeddedAppShell | null>(null);

export function EmbeddedAppShellProvider({ shell, children }: { shell: EmbeddedAppShell; children: ReactNode }) {
  return <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>;
}

/** The injected shell services, or `null` outside a provider. */
export function useEmbeddedAppShell(): EmbeddedAppShell | null {
  return useContext(ShellContext);
}

// ── Return pill (rendered by the shell) ──────────────────────────────────────

/** Pill label: `← <title> · <context>`, the context part omitted when empty. */
export function returnPillLabel(t: Pick<ReturnTarget, "title" | "context">): string {
  return t.context ? `← ${t.title} · ${t.context}` : `← ${t.title}`;
}

/**
 * Shows `← <app> · <context>` while the location equals the recorded
 * destination; activating it PUSHES the recorded app path (never
 * `history.back()`) and clears the target. Navigating anywhere else after the
 * destination was reached clears it. Renders nothing without a provider.
 */
export function EmbeddedAppReturnPill({ store: storeProp }: { store?: ReturnTargetStore } = {}) {
  const shell = useEmbeddedAppShell();
  const store = storeProp ?? shell?.returnTarget ?? null;
  const [location, navigate] = useLocation();
  const target = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.get ?? nullGet,
    store?.get ?? nullGet,
  );
  const t = useRuntimeT();
  // Whether the CURRENT target's destination has been reached. Reset whenever a
  // new target replaces it; the navigation that records a target and the one
  // that lands on `dest` are not one atomic step.
  const reached = useRef<ReturnTarget | null>(null);
  useEffect(() => {
    if (!store || !target) return;
    if (location === target.dest) {
      reached.current = target;
    } else if (reached.current === target) {
      reached.current = null;
      store.clear();
    }
  }, [location, target, store]);
  if (!store || !target || location !== target.dest) return null;
  return (
    <button
      type="button"
      data-testid="embedded-app-return-pill"
      aria-label={t("embeddedApp.returnTo", { app: target.title }, "Return to {app}")}
      onClick={() => {
        store.clear();
        navigate(target.href);
      }}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-popover min-h-[44px] px-4 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-[13px] shadow-lg hover:border-[var(--accent-primary,#3b82f6)]"
    >
      {returnPillLabel(target)}
    </button>
  );
}

const noopSubscribe = () => () => {};
const nullGet = () => null;
