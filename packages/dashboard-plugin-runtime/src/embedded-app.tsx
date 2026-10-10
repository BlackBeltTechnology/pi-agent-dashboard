// `<EmbeddedApp>` — hosts an app-kit `DashboardAppDefinition` inside a
// `shell-overlay-route` claim (`presentation: "content"`): builds the EMBEDDED
// `AppHost` (unchanged app-kit interface) from the client-injected shell
// services, and renders the OpenSpec-board-style top bar above the app.
//
// Exposed via the `./embedded-app` subpath (NOT the runtime root) so only the
// lazily-loaded route modules that render an app pull in app-kit.
// See change: add-plugin-app-host (D3, D4, D5, D7, D9).
import {
  type AppAction,
  type AppHost,
  AppHostProvider,
  type DashboardAppDefinition,
} from "@blackbelt-technology/pi-dashboard-app-kit/react";
import React, {
  Component,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Router, useLocation } from "wouter";
import { type EmbeddedAppShell, isSafeDashboardPath, useEmbeddedAppShell } from "./embedded-app-shell.js";
import { useLanguage, useRuntimeT } from "./plugin-context.js";

export interface EmbeddedAppProps {
  app: DashboardAppDefinition;
  /** Absolute route base the app renders under, e.g. `/folder/<enc>/wall`. */
  basePath: string;
  /** Encoded folder token (the claim's `:encodedCwd`) for folder-scoped apps. */
  folderParam?: string;
  /** Plugin-served standalone URL (e.g. `/apps/wall/`); absent ⇒ no *Open standalone*. */
  standaloneUrl?: string;
  /** The claim's `onBack` (descriptor back target). */
  onBack: () => void;
  /** The claim's plugin context — accepted for symmetry with the slot props; unused today. */
  pluginContext?: unknown;
}

/** At most this many `setActions` entries render inline; the rest overflow. */
const INLINE_ACTIONS = 2;

function basename(cwd: string): string {
  // split + filter, not a `[\\/]+$` trim: that regex is polynomial on
  // untrusted input with many trailing separators (CodeQL js/polynomial-redos).
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

function warnRejected(appId: string, what: string, value: unknown): void {
  console.warn(`[embedded-app:${appId}] rejected ${what}:`, value);
}

function isDev(): boolean {
  return typeof import.meta !== "undefined" && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
}

function signal() {
  const listeners = new Set<() => void>();
  return {
    emit() {
      for (const l of listeners) l();
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

function currentTheme(): string {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function subscribeTheme(cb: () => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

/** Mutable per-mount host state the host methods read at call time. */
interface HostRuntime {
  location: string;
  navigate: (to: string) => void;
  title: string | null;
  actions: AppAction[];
  language: string;
  appRoot: HTMLElement | null;
}

/**
 * The part appended to the standalone URL: `appPath` when given (`#…` kept as
 * is, `/…` without its leading slash), else the current location relative to
 * `basePath`. `null` for an `appPath` that fails the path rules (D5).
 */
function standaloneSuffix(appPath: string | undefined, location: string, basePath: string): string | null {
  if (appPath === undefined) {
    const inside = location.toLowerCase().startsWith(basePath.toLowerCase());
    return (inside ? location.slice(basePath.length) : "").replace(/^\/+/, "");
  }
  if (appPath.startsWith("#")) return isSafeDashboardPath(`/${appPath}`, { allowApps: true }) ? appPath : null;
  return isSafeDashboardPath(appPath, { allowApps: true }) ? appPath.replace(/^\/+/, "") : null;
}

function createEmbeddedHost(o: {
  app: DashboardAppDefinition;
  basePath: string;
  folder: { cwd: string; name: string } | undefined;
  standaloneUrl: string | undefined;
  shell: EmbeddedAppShell;
  rt: HostRuntime;
  titleSignal: ReturnType<typeof signal>;
  actionSignal: ReturnType<typeof signal>;
  langSignal: ReturnType<typeof signal>;
}): AppHost {
  const { app, basePath, folder, standaloneUrl, shell, rt } = o;
  const go = (dest: string) => {
    shell.returnTarget.set({
      appId: app.id,
      title: app.title,
      context: rt.title || folder?.name || "",
      href: rt.location,
      dest: dest.split(/[?#]/, 1)[0] ?? dest,
    });
    rt.navigate(dest);
  };
  return {
    version: 1,
    mode: "embedded",
    basePath,
    ...(folder ? { folder } : {}),
    capabilities: {
      dashboard: true,
      fullscreen: typeof document !== "undefined" && !!document.fullscreenEnabled,
      ...(standaloneUrl ? { standaloneUrl } : {}),
    },
    api: { fetch: shell.fetch, wsUrl: shell.wsUrl },
    // The dashboard has no operator model a plugin may read; apps treat a null
    // identity as "the dashboard's own session".
    identity: { current: () => null, subscribe: () => () => {} },
    theme: { current: currentTheme, subscribe: subscribeTheme },
    i18n: { language: () => rt.language, subscribe: o.langSignal.subscribe },
    setTitle(title) {
      rt.title = title;
      // The dashboard owns the document title while the app is embedded; the
      // previous title is restored on unmount (`EmbeddedAppHosted`).
      if (typeof document !== "undefined") document.title = title;
      o.titleSignal.emit();
    },
    setActions(actions) {
      rt.actions = actions;
      o.actionSignal.emit();
    },
    openSession(id) {
      go(`/session/${encodeURIComponent(id)}`);
    },
    openFolder(cwd) {
      go(`/folder/${shell.encodeFolder(cwd)}`);
    },
    navigateDashboard(path) {
      if (!isSafeDashboardPath(path)) {
        warnRejected(app.id, "navigateDashboard path", path);
        return;
      }
      go(path);
    },
    openStandalone(appPath) {
      const suffix = standaloneUrl ? standaloneSuffix(appPath, rt.location, basePath) : null;
      if (!standaloneUrl || suffix === null) {
        warnRejected(app.id, "openStandalone appPath", appPath);
        return;
      }
      const base = suffix.startsWith("#") || standaloneUrl.endsWith("/") ? standaloneUrl : `${standaloneUrl}/`;
      // One named window per app ⇒ a repeated call reuses it. In Electron every
      // window.open is handed to the system browser (no BrowserWindow).
      window.open(`${base}${suffix}`, `pi-app-${app.id}`);
    },
    requestFullscreen(el) {
      const target = (el ?? rt.appRoot) as HTMLElement | null;
      void target?.requestFullscreen?.();
    },
  };
}

// ── Error boundary (D9 crashed state) ────────────────────────────────────────

interface BoundaryProps {
  appId: string;
  onBack: () => void;
  labels: { crashed: string; reload: string; back: string };
  children: ReactNode;
}

class AppErrorBoundary extends Component<BoundaryProps, { error: unknown; epoch: number }> {
  state = { error: null as unknown, epoch: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error(`[embedded-app:${this.props.appId}] app crashed:`, error);
  }

  render() {
    if (this.state.error) {
      const { labels, onBack } = this.props;
      return (
        <div role="alert" data-testid="embedded-app-crashed" className="flex flex-col items-center justify-center gap-3 h-full p-6 text-[13px] text-[var(--text-secondary)]">
          <p>{labels.crashed}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-[44px] px-4 rounded-md border border-[var(--border-secondary)] text-[var(--text-primary)]"
              onClick={() => this.setState((s) => ({ error: null, epoch: s.epoch + 1 }))}
            >
              {labels.reload}
            </button>
            <button type="button" className="min-h-[44px] px-4 rounded-md text-blue-400 hover:text-blue-300" onClick={onBack}>
              {labels.back}
            </button>
          </div>
        </div>
      );
    }
    // The epoch key remounts the app subtree on "Reload app".
    return <React.Fragment key={this.state.epoch}>{this.props.children}</React.Fragment>;
  }
}

// ── Dev-mode embedding-rule warnings (D7) ────────────────────────────────────
// Title and <body> mutations are observable without false positives. History
// writes are not: the dashboard router and the app's own (base-relative)
// router push through the same `history.pushState` as a rule-breaking
// `window.location` write, so that rule is review-enforced only.

function useEmbeddingRuleWarnings(appId: string, rt: HostRuntime) {
  useEffect(() => {
    if (!isDev() || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    const warn = (rule: string) => console.warn(`[embedded-app:${appId}] embedding rule: ${rule}`);
    const titleObs = new MutationObserver(() => {
      if (rt.title === null || document.title !== rt.title) warn("set the title via host.setTitle, not document.title");
    });
    const titleEl = document.querySelector("title");
    if (titleEl) titleObs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    const bodyObs = new MutationObserver(() => warn("do not mutate <html>/<body> attributes (class/style)"));
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      titleObs.disconnect();
      bodyObs.disconnect();
    };
  }, [appId, rt]);
}

// ── Top bar ──────────────────────────────────────────────────────────────────

function TopBar({
  app,
  folderName,
  standaloneUrl,
  host,
  onBack,
  actions,
}: {
  app: DashboardAppDefinition;
  folderName: string | undefined;
  standaloneUrl: string | undefined;
  host: AppHost;
  onBack: () => void;
  actions: AppAction[];
}) {
  const t = useRuntimeT();
  const [menuOpen, setMenuOpen] = useState(false);
  const Ctx = app.HeaderContext;
  const inline = actions.slice(0, INLINE_ACTIONS);
  const overflow = actions.slice(INLINE_ACTIONS);
  const btn =
    "min-h-[44px] sm:min-h-0 text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
  return (
    <div
      data-testid="embedded-app-topbar"
      className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] shrink-0"
    >
      <button
        type="button"
        onClick={onBack}
        data-testid="embedded-app-back"
        aria-label={t("embeddedApp.back", undefined, "Back")}
        className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 text-blue-400 hover:text-blue-300 text-[13px] flex items-center gap-1"
      >
        <span aria-hidden="true">←</span>
        <span className="hidden sm:inline">{t("embeddedApp.back", undefined, "Back")}</span>
      </button>
      <nav
        aria-label={t("embeddedApp.breadcrumb", undefined, "Breadcrumb")}
        data-testid="embedded-app-breadcrumb"
        className="hidden sm:block text-[var(--text-primary)] font-semibold text-[13px] truncate"
      >
        {folderName ? (
          <>
            <span className="text-[var(--text-tertiary)] font-normal">{folderName}</span>
            <span className="text-[var(--text-tertiary)] font-normal" aria-hidden="true">
              {" › "}
            </span>
          </>
        ) : null}
        <span>{app.title}</span>
      </nav>
      {Ctx ? (
        <div data-testid="embedded-app-header-context" className="min-w-0 flex items-center">
          <Ctx />
        </div>
      ) : null}
      <span className="flex-1" />
      <div data-testid="embedded-app-actions" className="hidden sm:flex items-center gap-2">
        {inline.map((a) => (
          <button key={a.id} type="button" className={btn} onClick={a.onSelect} title={a.shortcut}>
            {a.label}
          </button>
        ))}
      </div>
      {actions.length > 0 ? (
        <div className="relative">
          <button
            type="button"
            data-testid="embedded-app-overflow"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("embeddedApp.more", undefined, "More actions")}
            className={`${btn} ${overflow.length > 0 ? "" : "sm:hidden"}`}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div
              role="menu"
              data-testid="embedded-app-overflow-menu"
              className="absolute right-0 mt-1 z-popover min-w-[180px] rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-lg py-1"
            >
              {/* Narrow: every action folds here; wide: only the overflow. */}
              {actions.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  data-overflow={i >= INLINE_ACTIONS ? "true" : "false"}
                  className={`w-full text-left min-h-[44px] sm:min-h-0 px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] ${i < INLINE_ACTIONS ? "sm:hidden" : ""}`}
                  onClick={() => {
                    setMenuOpen(false);
                    a.onSelect();
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {standaloneUrl ? (
        <button
          type="button"
          data-testid="embedded-app-open-standalone"
          className={`${btn} hidden sm:inline-flex`}
          onClick={() => host.openStandalone()}
        >
          {t("embeddedApp.openStandalone", undefined, "Open standalone")} ⧉
        </button>
      ) : null}
    </div>
  );
}

// ── EmbeddedApp ──────────────────────────────────────────────────────────────

function StateMessage({ testId, message, onBack, backLabel }: { testId: string; message: string; onBack: () => void; backLabel: string }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-col items-center justify-center gap-3 h-full p-6 text-[13px] text-[var(--text-secondary)]">
      <p>{message}</p>
      <button type="button" className="min-h-[44px] px-4 rounded-md text-blue-400 hover:text-blue-300" onClick={onBack}>
        {backLabel}
      </button>
    </div>
  );
}

export function EmbeddedApp(props: EmbeddedAppProps) {
  const shell = useEmbeddedAppShell();
  const t = useRuntimeT();
  const back = t("embeddedApp.back", undefined, "Back");
  if (!shell) {
    return (
      <StateMessage
        testId="embedded-app-no-shell"
        message={t("embeddedApp.noShell", undefined, "This app cannot run here: the dashboard shell services are unavailable.")}
        onBack={props.onBack}
        backLabel={back}
      />
    );
  }
  let folder: { cwd: string; name: string } | undefined;
  if (props.folderParam !== undefined) {
    const cwd = shell.decodeFolder(props.folderParam);
    if (!cwd) {
      return (
        <StateMessage
          testId="embedded-app-folder-not-found"
          message={t("embeddedApp.folderNotFound", undefined, "Folder not found")}
          onBack={props.onBack}
          backLabel={back}
        />
      );
    }
    folder = { cwd, name: basename(cwd) };
  }
  return <EmbeddedAppHosted {...props} shell={shell} folder={folder} />;
}

function EmbeddedAppHosted({
  app,
  basePath,
  standaloneUrl,
  onBack,
  shell,
  folder,
}: EmbeddedAppProps & { shell: EmbeddedAppShell; folder: { cwd: string; name: string } | undefined }) {
  const t = useRuntimeT();
  const [location, navigate] = useLocation();
  const language = useLanguage();
  const signals = useMemo(() => ({ title: signal(), actions: signal(), lang: signal() }), []);
  const rt = useRef<HostRuntime>({ location, navigate, title: null, actions: [], language, appRoot: null }).current;
  rt.location = location;
  rt.navigate = navigate;
  const folderKey = folder?.cwd;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `folder` is keyed by its cwd; rt + signals are stable.
  const host = useMemo(
    () =>
      createEmbeddedHost({
        app,
        basePath,
        folder,
        standaloneUrl,
        shell,
        rt,
        titleSignal: signals.title,
        actionSignal: signals.actions,
        langSignal: signals.lang,
      }),
    [app, basePath, folderKey, standaloneUrl, shell, rt, signals],
  );
  useEffect(() => {
    if (rt.language !== language) {
      rt.language = language;
      signals.lang.emit();
    }
  }, [language, rt, signals]);
  const getActions = useCallback(() => rt.actions, [rt]);
  const actions = useSyncExternalStore(signals.actions.subscribe, getActions, getActions);
  useEmbeddingRuleWarnings(app.id, rt);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);
  const App = app.App;
  return (
    <AppHostProvider host={host}>
      <div className="flex flex-col h-full min-h-0 bg-[var(--bg-primary)]" data-testid="embedded-app" data-app-id={app.id}>
        <TopBar app={app} folderName={folder?.name} standaloneUrl={standaloneUrl} host={host} onBack={onBack} actions={actions} />
        <div
          ref={(el) => {
            rt.appRoot = el;
          }}
          className="flex-1 min-h-0 overflow-auto relative"
        >
          <AppErrorBoundary
            appId={app.id}
            onBack={onBack}
            labels={{
              crashed: t("embeddedApp.crashed", undefined, "This app stopped working."),
              reload: t("embeddedApp.reload", undefined, "Reload app"),
              back: t("embeddedApp.back", undefined, "Back"),
            }}
          >
            <Suspense fallback={<div data-testid="embedded-app-loading" aria-busy="true" className="h-full" />}>
              <Router base={basePath}>
                <App />
              </Router>
            </Suspense>
          </AppErrorBoundary>
        </div>
      </div>
    </AppHostProvider>
  );
}
