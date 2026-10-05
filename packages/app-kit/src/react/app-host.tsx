// `AppHost` — the contract between an app (a SPA that may run embedded in the
// dashboard OR standalone) and its host. App authors depend on this one module;
// environment access (api, identity, theme, language, title) only goes through
// the host. This change ships the contract + the STANDALONE host. The embedded
// host (`<EmbeddedApp>`, `presentation:"content"`) is owned by
// `add-plugin-app-host` and plugs into the same `AppHost` interface.
// See change: add-team-plugin (D16, minimal AppHost).
import { createContext, type ComponentType, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react";
import { apiUrl, type AppConfig, configureDashboard, loadAppConfig, wsUrl as kitWsUrl } from "../config.js";
import { currentOperator, onIdentityChange, type Operator } from "../identity-state.js";
import { authedFetch, ticketSocketUrl } from "../transport.js";

export interface AppAction {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  onSelect(): void;
}

export interface AppHost {
  version: 1;
  mode: "embedded" | "standalone";
  /** Route base the app renders under: `/apps/team`, `/team`, `/folder/<enc>/team`. */
  basePath: string;
  /** Embedded folder-scoped apps. */
  folder?: { cwd: string; name: string };
  capabilities: { dashboard: boolean; fullscreen: boolean; standaloneUrl?: string };
  api: {
    fetch(path: string, init?: RequestInit): Promise<Response>;
    /** A socket URL carrying a single-use ticket (or null when not admitted). */
    wsUrl(path: string): Promise<string | null>;
  };
  identity: { current(): Operator | null; subscribe(cb: () => void): () => void };
  theme: { current(): string; subscribe(cb: () => void): () => void; set?(theme: string): void };
  i18n: { language(): string; subscribe(cb: () => void): () => void; set?(lang: string): void };
  setTitle(title: string): void;
  setActions(actions: AppAction[]): void;
  openSession(id: string): void;
  openFolder(cwd: string): void;
  navigateDashboard(path: string): void;
  openStandalone(appPath?: string): void;
  requestFullscreen(el?: Element): void;
}

export interface DashboardAppDefinition {
  id: string;
  title: string;
  App: ComponentType;
  /** The app's contribution to the host's header (e.g. a project selector). */
  HeaderContext?: ComponentType;
}

export function defineDashboardApp(d: DashboardAppDefinition): DashboardAppDefinition {
  return d;
}

const HostContext = createContext<AppHost | null>(null);

export function AppHostProvider({ host, children }: { host: AppHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useAppHost(): AppHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("useAppHost: no AppHostProvider above this component");
  return host;
}

export function useOptionalAppHost(): AppHost | null {
  return useContext(HostContext);
}

/** Re-render on any of the host's subscribable values. */
export function useHostValue<T>(subscribe: (cb: () => void) => () => void, get: () => T): T {
  return useSyncExternalStore(subscribe, get, get);
}

// ── Standalone host ──────────────────────────────────────────────────────────

function createSignal(): { listeners: Set<() => void>; emit(): void; subscribe(cb: () => void): () => void } {
  const listeners = new Set<() => void>();
  return {
    listeners,
    emit: () => {
      for (const l of listeners) l();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: keep in-memory only */
  }
}

export interface StandaloneHostOptions {
  appId: string;
  basePath: string;
  /** Skip the `config.json` read (tests, or an already-configured page). */
  config?: AppConfig;
  defaultLanguage?: string;
  defaultTheme?: string;
}

/**
 * The standalone host: no dashboard chrome, `capabilities.dashboard = false`
 * (navigation methods are no-ops), data through app-kit's authed transport.
 * Storage keys are prefixed `<appId>:`.
 */
export async function createStandaloneHost(o: StandaloneHostOptions): Promise<AppHost> {
  const cfg = o.config ?? (await loadAppConfig("/config.json", { allowMissing: true }));
  configureDashboard(cfg);
  const langKey = `${o.appId}:lang`;
  const themeKey = `${o.appId}:theme`;
  let language = readStored(langKey) ?? o.defaultLanguage ?? "en";
  let theme = readStored(themeKey) ?? o.defaultTheme ?? "dark";
  const lang = createSignal();
  const themeSignal = createSignal();
  let actions: AppAction[] = [];
  const actionSignal = createSignal();
  const applyTheme = () => {
    if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
  };
  applyTheme();

  const host: AppHost & { actions(): AppAction[]; subscribeActions(cb: () => void): () => void } = {
    version: 1,
    mode: "standalone",
    basePath: o.basePath,
    capabilities: { dashboard: false, fullscreen: typeof document !== "undefined" && !!document.fullscreenEnabled },
    api: {
      fetch: (path, init) => authedFetch(apiUrl(path), init),
      wsUrl: async (path) => {
        const url = kitWsUrl(path);
        return ticketSocketUrl(url);
      },
    },
    identity: { current: currentOperator, subscribe: onIdentityChange },
    theme: {
      current: () => theme,
      subscribe: themeSignal.subscribe,
      set(next) {
        theme = next;
        writeStored(themeKey, next);
        applyTheme();
        themeSignal.emit();
      },
    },
    i18n: {
      language: () => language,
      subscribe: lang.subscribe,
      set(next) {
        language = next;
        writeStored(langKey, next);
        lang.emit();
      },
    },
    setTitle(title) {
      if (typeof document !== "undefined") document.title = title;
    },
    setActions(next) {
      actions = next;
      actionSignal.emit();
    },
    openSession() {},
    openFolder() {},
    navigateDashboard() {},
    openStandalone() {},
    requestFullscreen(el) {
      if (typeof document === "undefined") return;
      void ((el ?? document.documentElement) as HTMLElement).requestFullscreen?.();
    },
    actions: () => actions,
    subscribeActions: actionSignal.subscribe,
  };
  return host;
}

/**
 * Standalone chrome: brand, the app's `HeaderContext` (project selector…),
 * language segmented control + theme toggle, and `children` (sign-in / user
 * chip). Embedded hosts render their own top bar and never this.
 */
export function StandaloneBar({ app, children }: { app: DashboardAppDefinition; children?: ReactNode }) {
  const host = useAppHost();
  const language = useHostValue(host.i18n.subscribe, host.i18n.language);
  const theme = useHostValue(host.theme.subscribe, host.theme.current);
  const Ctx = app.HeaderContext;
  useEffect(() => {
    host.setTitle(app.title);
  }, [host, app.title]);
  return (
    <header
      role="banner"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 1rem",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-secondary)",
      }}
    >
      <strong>{app.title}</strong>
      {Ctx ? <Ctx /> : null}
      <span style={{ flex: 1 }} />
      <div role="group" aria-label="Language">
        {["hu", "en"].map((l) => (
          <button key={l} type="button" aria-pressed={language === l} onClick={() => host.i18n.set?.(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={() => host.theme.set?.(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
      {children}
    </header>
  );
}
