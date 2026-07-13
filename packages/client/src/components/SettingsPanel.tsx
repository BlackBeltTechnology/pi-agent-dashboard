import { type RegisteredSource, SettingsDraftProvider, type SettingsDraftRegistry, SettingsSectionSlot, useSettingsDraftSource } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { VALID_SETTINGS_TABS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import { DISPLAY_PRESETS, type DisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiAlert, mdiArrowLeft, mdiBookOpenPageVariant, mdiCheckCircle, mdiClipboardText, mdiCloseCircle, mdiCog, mdiContentSave, mdiDelete, mdiFileDocumentEditOutline, mdiKey, mdiLoading, mdiLock, mdiPackageVariant, mdiPalette, mdiPlay, mdiPlus, mdiPuzzle, mdiPuzzleOutline, mdiRestart, mdiRobotOutline, mdiServer, mdiTextBoxOutline, mdiTunnel, mdiUpdate, mdiViewDashboard, mdiWeb, mdiWrench } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useAsyncAction } from "../hooks/useAsyncAction.js";
import { useDebugToolsVisible } from "../hooks/useDebugToolsVisible.js";
import { useInstalledPackages } from "../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../hooks/usePackageOperations.js";
import { usePiResources } from "../hooks/usePiResources.js";
import { useResourceActivation } from "../hooks/useResourceActivation.js";
import { getApiBase } from "../lib/api-context.js";
import { useDisplayPrefsContext } from "../lib/DisplayPrefsContext.js";
import { type BlockEvent, getBlockEvents } from "../lib/gateway-api.js";
import { suggestTrustEntries } from "../lib/gateway-config-ops.js";
import { fetchAutoInitWorktreePref, setAutoInitWorktreePref } from "../lib/git-api.js";
import { t as i18nT } from "../lib/i18n";
import { LANGUAGE_OPTIONS, type Language, useI18n } from "../lib/i18n.js";
import { type TestProviderResult, testProvider } from "../lib/providers-api.js";
import { buildPiResourceFileUrl } from "../lib/route-builders.js";
import { DiagnosticsSection } from "./DiagnosticsSection.js";
import { DialogPortal } from "./DialogPortal.js";
import { InstructionsPage } from "./DirectorySettings/InstructionsPage.js";
import { GatewayPage } from "./Gateway/GatewayPage.js";
import { KnownServersSection } from "./KnownServersSection.js";
import { ModelProxySection } from "./ModelProxySection.js";
import { ModelSelector } from "./ModelSelector.js";
import { NetworkDiscoverySection } from "./NetworkDiscoverySection.js";
import { OpenSpecProfileSection } from "./OpenSpecProfileSection.js";
import { PackageBrowser } from "./PackageBrowser.js";
import { PackageInstallConfirmDialog } from "./PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "./PackageReadmeDialog.js";
import { PairedDevicesSection } from "./PairedDevicesSection.js";
import { PairingView } from "./PairingView.js";
import { PiVersionAdvisory } from "./PiVersionAdvisory.js";
import { PluginsSection } from "./PluginsSection.js";
import { ProviderAuthSection } from "./ProviderAuthSection.js";
import type { ResourceType } from "./ResourceCardGrid.js";
import { ResourceGridPanel } from "./ResourceGridPanel.js";
import { SpawnFailuresSection, ToolsSection } from "./ToolsSection.js";
import { UnifiedPackagesSection } from "./UnifiedPackagesSection.js";

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  issuerUrl?: string;
  name?: string;
}

interface LlmProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;
  isNew?: boolean; // true for newly added providers (name is editable)
}

interface AuthConfig {
  secret: string;
  providers: Record<string, ProviderConfig>;
  allowedUsers?: string[];
  bypassUrls?: string[];
  bypassHosts?: string[];
}

interface MemoryLimitsConfig {
  maxEventsPerSession: number;
  maxStringFieldSize: number;
  maxWsBufferBytes: number;
}

interface NetworkInterfaceInfo {
  name: string;
  address: string;
  netmask: string;
  cidr: string;
}

interface Config {
  port: number;
  piPort: number;
  /** Listen interface for HTTP + pi gateway. Default "127.0.0.1". See change: configurable-bind-host. */
  bindHost?: string;
  autoStart: boolean;
  autoShutdown: boolean;
  shutdownIdleSeconds: number;
  spawnStrategy: string;
  /** Reattach placement policy. See change: reattach-move-to-front. */
  reattachPlacement?: "preserve" | "streaming-only" | "always";
  reopenSessionsAfterShutdown?: "off" | "ask" | "auto";
  /** Move completed/ended sessions to front of their tier. See change: simplify-session-card-ordering. */
  completedFirst?: boolean;
  /** Move ask_user sessions to front of active tier. See change: simplify-session-card-ordering. */
  questionFirst?: boolean;
  /** Timeout for ask_user prompts in seconds; -1 (or <=0) disables timeout. */
  askUserPromptTimeoutSeconds?: number;
  /** How long (ms) to wait for spawned pi to connect before a warning. Default 30000. See change: spawn-failure-diagnostics. */
  spawnRegisterTimeoutMs?: number;
  tunnel: {
    enabled: boolean;
    reservedToken?: string;
    watchdog?: {
      enabled: boolean;
      intervalMs: number;
      failureThreshold: number;
      probeTimeoutMs: number;
    };
  };
  devBuildOnReload: boolean;
  defaultModel: string;
  /** Display name for the PWA app label. See change: add-dynamic-pwa-manifest-naming. */
  dashboardName?: string;
  auth?: AuthConfig;
  memoryLimits: MemoryLimitsConfig;
  trustedNetworks?: string[];
  editor?: {
    binary?: string;
    idleTimeoutMinutes?: number;
    maxInstances?: number;
    stopOnDashboardExit?: boolean;
  };
  openspec?: {
    enabled?: boolean;
    pollIntervalSeconds?: number;
    maxConcurrentSpawns?: number;
    changeDetection?: "mtime" | "always";
    jitterSeconds?: number;
  };
  /** Dashboard model proxy config. See change: add-dashboard-model-proxy. */
  modelProxy?: Record<string, any>;
  /** UI preference: show worktree spawn buttons in folder + OpenSpec rows. Default true. See change: openspec-worktree-spawn-button. */
  gitWorktreeEnabled?: boolean;
  /** Windows-only git/bash source. See change: embed-git-bash-on-windows. */
  windowsGitSource?: "auto" | "host" | "bundled";
  /** Keeper log behavior — gates capture of pi stdout/stderr into keeper-<id>.log. Default off. See change: add-keeper-output-capture-toggle. */
  keeperLog?: { capturePiOutput?: boolean };
}

const DEFAULT_OPENSPEC_UI = {
  enabled: true,
  pollIntervalSeconds: 30,
  maxConcurrentSpawns: 3,
  changeDetection: "mtime" as const,
  jitterSeconds: 5,
};

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  keycloak: "Keycloak",
  oidc: "OIDC (Generic)",
};

const NEEDS_ISSUER = new Set(["keycloak", "oidc"]);

// Maps each config-diff key to the settings page it renders on, so the nav
// rail can show a per-page dirty dot. See change: unify-settings-save-contract.
const CONFIG_FIELD_PAGE: Record<string, string> = {
  port: "server", piPort: "server", bindHost: "server", autoShutdown: "server", shutdownIdleSeconds: "server",
  tunnel: "server", memoryLimits: "server",
  spawnStrategy: "sessions", reattachPlacement: "sessions", reopenSessionsAfterShutdown: "sessions", completedFirst: "sessions",
  questionFirst: "sessions", askUserPromptTimeoutSeconds: "sessions", spawnRegisterTimeoutMs: "sessions",
  gitWorktreeEnabled: "sessions", dashboardName: "sessions", defaultModel: "sessions",
  windowsGitSource: "sessions", autoStart: "sessions",
  trustedNetworks: "security", auth: "security",
  modelProxy: "providers",
  openspec: "openspec",
  devBuildOnReload: "developer", keeperLog: "developer", editor: "developer",
};

/**
 * Compute the changed-fields partial for `PUT /api/config` by diffing the
 * working draft against the loaded baseline. Pure — used both to render live
 * dirty state and to build the Save payload. See change:
 * unify-settings-save-contract.
 */
function computeConfigPartial(config: Config, original: Config): Record<string, any> {
  const partial: Record<string, any> = {};
  if (config.port !== original.port) partial.port = config.port;
  if (config.piPort !== original.piPort) partial.piPort = config.piPort;
  if ((config.bindHost ?? "127.0.0.1") !== (original.bindHost ?? "127.0.0.1")) {
    partial.bindHost = config.bindHost ?? "127.0.0.1";
  }
  if (config.autoStart !== original.autoStart) partial.autoStart = config.autoStart;
  if (config.autoShutdown !== original.autoShutdown) partial.autoShutdown = config.autoShutdown;
  if (config.shutdownIdleSeconds !== original.shutdownIdleSeconds) partial.shutdownIdleSeconds = config.shutdownIdleSeconds;
  if (config.spawnStrategy !== original.spawnStrategy) partial.spawnStrategy = config.spawnStrategy;
  if (config.reattachPlacement !== original.reattachPlacement) {
    partial.reattachPlacement = config.reattachPlacement ?? "always";
  }
  if ((config.reopenSessionsAfterShutdown ?? "ask") !== (original.reopenSessionsAfterShutdown ?? "ask")) {
    partial.reopenSessionsAfterShutdown = config.reopenSessionsAfterShutdown ?? "ask";
  }
  if ((config.completedFirst ?? false) !== (original.completedFirst ?? false)) {
    partial.completedFirst = config.completedFirst ?? false;
  }
  if ((config.questionFirst ?? false) !== (original.questionFirst ?? false)) {
    partial.questionFirst = config.questionFirst ?? false;
  }
  if (config.askUserPromptTimeoutSeconds !== original.askUserPromptTimeoutSeconds) {
    partial.askUserPromptTimeoutSeconds = config.askUserPromptTimeoutSeconds ?? 300;
  }
  if (config.spawnRegisterTimeoutMs !== original.spawnRegisterTimeoutMs) {
    partial.spawnRegisterTimeoutMs = config.spawnRegisterTimeoutMs ?? 30000;
  }
  if ((config.windowsGitSource ?? "auto") !== (original.windowsGitSource ?? "auto")) {
    partial.windowsGitSource = config.windowsGitSource ?? "auto";
  }
  if ((config.gitWorktreeEnabled ?? true) !== (original.gitWorktreeEnabled ?? true)) {
    partial.gitWorktreeEnabled = config.gitWorktreeEnabled ?? true;
  }
  {
    const tunnelPartial: Record<string, any> = {};
    if (config.tunnel.enabled !== original.tunnel.enabled) {
      tunnelPartial.enabled = config.tunnel.enabled;
    }
    if (JSON.stringify(config.tunnel.watchdog ?? null) !== JSON.stringify(original.tunnel.watchdog ?? null)) {
      tunnelPartial.watchdog = config.tunnel.watchdog;
    }
    if (Object.keys(tunnelPartial).length > 0) partial.tunnel = tunnelPartial;
  }
  if (config.devBuildOnReload !== original.devBuildOnReload) partial.devBuildOnReload = config.devBuildOnReload;
  if (config.defaultModel !== original.defaultModel) partial.defaultModel = config.defaultModel;
  if ((config.dashboardName ?? "") !== (original.dashboardName ?? "")) {
    const trimmed = (config.dashboardName ?? "").trim();
    partial.dashboardName = trimmed.length > 0 ? trimmed : "";
  }
  if (JSON.stringify(config.trustedNetworks) !== JSON.stringify(original.trustedNetworks)) {
    partial.trustedNetworks = config.trustedNetworks ?? [];
  }
  if (JSON.stringify(config.memoryLimits) !== JSON.stringify(original.memoryLimits)) {
    partial.memoryLimits = config.memoryLimits;
  }
  if (JSON.stringify(config.openspec) !== JSON.stringify(original.openspec)) {
    partial.openspec = config.openspec ?? DEFAULT_OPENSPEC_UI;
  }
  if (JSON.stringify(config.keeperLog) !== JSON.stringify(original.keeperLog)) {
    partial.keeperLog = config.keeperLog ?? { capturePiOutput: false };
  }
  if (JSON.stringify(config.editor) !== JSON.stringify(original.editor)) {
    partial.editor = config.editor || null;
  }
  if (JSON.stringify(config.auth) !== JSON.stringify(original.auth)) {
    partial.auth = config.auth || null;
  }
  if (JSON.stringify(config.modelProxy) !== JSON.stringify(original.modelProxy)) {
    partial.modelProxy = config.modelProxy;
  }
  return partial;
}

// Legacy page-id aliases applied before validation so old links/bookmarks land
// on the new page homes. See change: reorganize-settings-into-pages.
const SETTINGS_PAGE_ALIASES: Record<string, string> = {
  advanced: "developer",
  servers: "remote",
};
// `instructions` is a built-in global Instructions page, not a plugin-claimable
// settings tab — so it is added to the client-side route whitelist only, NOT to
// the shared VALID_SETTINGS_TABS (which gates the plugin slot contract).
// See change: directory-settings-page-and-scoped-md-editing.
// `gateway` is a built-in Network-group page (tunnel providers UI), added to
// the client route whitelist only (not a plugin-claimable slot).
// See change: add-tunnel-providers.
const VALID_PAGES = new Set<string>([...VALID_SETTINGS_TABS, "instructions", "gateway"]);

// Global-scope resource card pages. Page id → the singular `PiResource.type` its
// grid renders. See change: resources-card-tabs.
const RESOURCE_TAB_TYPE: Record<string, ResourceType> = {
  skills: "skill",
  agents: "agent",
  extensions: "extension",
  prompts: "prompt",
  themes: "theme",
};

/** Resolve a raw id (route param or ?tab=) to a canonical page id, or null if invalid. */
function resolveSettingsPage(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const aliased = SETTINGS_PAGE_ALIASES[raw] ?? raw;
  return VALID_PAGES.has(aliased) ? aliased : null;
}

/**
 * Pending-nav sentinel meaning "resolve via the depth-aware back action"
 * (not a literal route). Routes never start with "@@".
 * See change: fix-settings-back-to-launching-route.
 */
const BACK_SENTINEL = "@@back";

export function SettingsPanel({ availableModels, onMessage, onBack }: {
  availableModels?: Array<{ provider: string; id: string }>;
  /** WS bus subscribe (from App) used to correlate the confirm:"ws" restart. */
  onMessage?: (handler: (msg: ServerToBrowserMessage) => void) => () => void;
  /**
   * Depth-aware back action (App's `goBack`) — returns to the launching route
   * instead of the card list. Falls back to `navigate("/")` when omitted.
   * See change: fix-settings-back-to-launching-route.
   */
  onBack?: () => void;
}) {
  const { language, setLanguage, t } = useI18n();
  const [, navigate] = useLocation();
  const [config, setConfig] = useState<Config | null>(null);
  const [original, setOriginal] = useState<Config | null>(null);
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([]);
  // Detect upstream pi-model-proxy extension for ModelProxySection coexistence advisory.
  // See change: add-dashboard-model-proxy task 14.1.
  const installedTopLevel = useInstalledPackages("global");
  const upstreamPiModelProxyInstalled = installedTopLevel.packages.some(
    (p) => p.source === "npm:@blackbelt-technology/pi-model-proxy",
  );
  const [originalLlmProviders, setOriginalLlmProviders] = useState<LlmProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [spawnTimeoutInvalid, setSpawnTimeoutInvalid] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  // Restart is a slow op: the HTTP ack returns immediately but the effect lands
  // when the server re-broadcasts `server_restarting` with our requestId. Hold
  // pending until that correlated event (confirm:"ws"), with a timeout fallback.
  // See change: add-async-action-feedback.
  const restartReqIdRef = useRef<string>("");
  const restart = useAsyncAction(
    async () => {
      const requestId = crypto.randomUUID();
      restartReqIdRef.current = requestId;
      // The server returns {ok:true} then exits ~200ms later; a rejected fetch
      // (socket closed mid-response on exit) is also a success signal, so swallow
      // it. Only an explicit ok:false from a completed response is an error.
      let res: Response;
      try {
        res = await fetch(`${getApiBase()}/api/restart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        });
      } catch {
        return; // socket closed on exit → restart underway
      }
      const data = await res.json().catch(() => ({ ok: true }));
      if (data && data.ok === false) throw new Error(data.error || "Restart failed");
    },
    {
      confirm: "ws",
      onMessage,
      confirmEvent: (msg) =>
        msg.type === "server_restarting" && msg.requestId === restartReqIdRef.current,
      onSuccess: () => {
        setMessage({ type: "success", text: "Server restarting…" });
        setTimeout(() => navigate("/"), 1500);
      },
      // Route the hook's outcome toasts into the existing settings banner.
      showToast: (text, variant) =>
        setMessage({ type: variant === "info" ? "warn" : variant === "success" ? "success" : "error", text }),
    },
  );
  const restarting = restart.pending;
  // Dual-URL routing: canonical `/settings/:page?`, legacy `/settings?tab=<id>`.
  // A single mounted panel resolves the active page from the URL so the shared
  // unsaved draft survives page changes. See change: reorganize-settings-into-pages.
  const [, routeParams] = useRoute("/settings/:page?");
  const routePage = routeParams?.page;
  const resolvedRoutePage = resolveSettingsPage(routePage);
  const activeTab = resolvedRoutePage ?? "general";

  // Global-scope resource card pages (Resources nav group). One fetch backs the
  // nav count pills + the active page grid. See change: resources-card-tabs.
  const piResources = usePiResources(null, { globalOnly: true });
  const resourceActivation = useResourceActivation();
  const resourceCounts = useMemo(() => {
    const empty: Record<string, number> = { skills: 0, agents: 0, extensions: 0, prompts: 0, themes: 0 };
    const scope = piResources.data?.global;
    if (scope) {
      empty.skills = scope.skills.length;
      empty.agents = scope.agents.length;
      empty.extensions = scope.extensions.length;
      empty.prompts = scope.prompts.length;
      // themes are not scanned into PiResourceScope yet.
    }
    for (const pkg of piResources.data?.packages ?? []) {
      if ((pkg.scope ?? "local") !== "global") continue;
      empty.skills += pkg.resources.skills.length;
      empty.agents += pkg.resources.agents.length;
      empty.extensions += pkg.resources.extensions.length;
      empty.prompts += pkg.resources.prompts.length;
    }
    return empty;
  }, [piResources.data]);

  useEffect(() => {
    // 1) valid route param → nothing to do (already canonical).
    if (resolvedRoutePage) {
      if (resolvedRoutePage !== routePage) {
        navigate(`/settings/${resolvedRoutePage}`, { replace: true });
      }
      return;
    }
    // 2) a route param was given but invalid → fall back to general.
    if (routePage) {
      navigate("/settings/general", { replace: true });
      return;
    }
    // 3) no route param → upgrade legacy ?tab=<id> or default to general.
    const legacy = new URLSearchParams(window.location.search).get("tab");
    const resolvedLegacy = resolveSettingsPage(legacy);
    navigate(`/settings/${resolvedLegacy ?? "general"}`, { replace: true });
  }, [routePage, resolvedRoutePage, navigate]);

  // Windows-only live git/sh source readout from /api/health. null on
  // macOS/Linux (section hidden). See change: embed-git-bash-on-windows.
  const [gitSourceReadout, setGitSourceReadout] = useState<{
    setting: string; source: string; gitPath: string | null;
    gitVersion: string | null; shellPath: string | null;
  } | null>(null);
  const refreshGitSourceReadout = useCallback(() => {
    return fetch(`${getApiBase()}/api/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((h) => setGitSourceReadout(h?.gitSource ?? null))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void refreshGitSourceReadout();
  }, [refreshGitSourceReadout]);

  useEffect(() => {
    const configPromise = fetch(`${getApiBase()}/api/config`).then((res) => res.json());
    const providersPromise = fetch(`${getApiBase()}/api/providers`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);

    Promise.all([configPromise, providersPromise])
      .then(([configData, providersData]) => {
        if (configData.success) {
          setConfig(configData.data);
          setOriginal(JSON.parse(JSON.stringify(configData.data)));
        }
        if (providersData?.success && providersData.providers) {
          const list: LlmProvider[] = Object.entries(providersData.providers).map(
            ([name, entry]: [string, any]) => ({
              name,
              baseUrl: entry.baseUrl || "",
              apiKey: entry.apiKey || "",
              api: entry.api || "openai-completions",
            })
          );
          setLlmProviders(list);
          setOriginalLlmProviders(JSON.parse(JSON.stringify(list)));
        }
      })
      .catch(() => setMessage({ type: "error", text: t("settings.failedLoad", undefined, "Failed to load settings") }))
      .finally(() => setLoading(false));
  }, [t]);

  // ── Unified-Save draft registry ──────────────────────────────────────────────
  // Built-in + plugin settings sources register here so a single Save commits
  // every dirty store. See change: unify-settings-save-contract.
  const [draftSources, setDraftSources] = useState<Map<string, RegisteredSource>>(new Map());
  const draftRegistry = useMemo<SettingsDraftRegistry>(() => ({
    upsert: (id, source) => setDraftSources((prev) => {
      const existing = prev.get(id);
      if (existing && existing.page === source.page && existing.isDirty === source.isDirty
        && existing.commit === source.commit && existing.reset === source.reset) return prev;
      const next = new Map(prev);
      next.set(id, source);
      return next;
    }),
    remove: (id) => setDraftSources((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    }),
  }), []);

  // Live diff for the config + providers sources (the rest register via context).
  const configPartial = useMemo(
    () => (config && original ? computeConfigPartial(config, original) : {}),
    [config, original],
  );
  const configDirty = Object.keys(configPartial).length > 0;
  const llmChanged = useMemo(
    () => JSON.stringify(llmProviders) !== JSON.stringify(originalLlmProviders),
    [llmProviders, originalLlmProviders],
  );
  const dirtyDraftCount = useMemo(
    () => Array.from(draftSources.values()).filter((s) => s.isDirty).length,
    [draftSources],
  );
  const unsavedCount = (configDirty ? 1 : 0) + (llmChanged ? 1 : 0) + dirtyDraftCount;
  const isDirty = unsavedCount > 0;
  // Pages with unsaved edits → nav-rail dirty dots.
  const dirtyPages = useMemo(() => {
    const pages = new Set<string>();
    for (const k of Object.keys(configPartial)) {
      const p = CONFIG_FIELD_PAGE[k];
      if (p) pages.add(p);
    }
    if (llmChanged) pages.add("providers");
    for (const s of draftSources.values()) if (s.isDirty) pages.add(s.page);
    return pages;
  }, [configPartial, llmChanged, draftSources]);

  const handleDiscard = useCallback(() => {
    if (original) setConfig(JSON.parse(JSON.stringify(original)));
    setLlmProviders(JSON.parse(JSON.stringify(originalLlmProviders)));
    for (const s of draftSources.values()) s.reset();
    setMessage(null);
  }, [original, originalLlmProviders, draftSources]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!config || !original) return false;
    if (!isDirty) {
      setMessage({ type: "warn", text: t("settings.noChanges", undefined, "No changes to save") });
      return true;
    }
    setSaving(true);
    setMessage(null);

    // One commit task per dirty source. Each is independent — Save does NOT
    // claim cross-store atomicity; failed sources stay dirty for Retry.
    type Task = { label: string; run: () => Promise<{ restartRequired?: boolean }> };
    const tasks: Task[] = [];

    if (configDirty) {
      tasks.push({
        label: t("settings.sourceConfig", undefined, "Settings"),
        run: async () => {
          const res = await fetch(`${getApiBase()}/api/config`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(configPartial),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "config");
          setOriginal(JSON.parse(JSON.stringify(config)));
          if (configPartial.windowsGitSource !== undefined) void refreshGitSourceReadout();
          return { restartRequired: !!data.restartRequired };
        },
      });
    }

    if (llmChanged) {
      tasks.push({
        label: t("settings.sourceProviders", undefined, "LLM providers"),
        run: async () => {
          // Reject blank/whitespace names before building the PUT body so the
          // row is not silently dropped; throwing keeps this source dirty via
          // the Promise.allSettled failure path. See change:
          // fix-custom-provider-save-and-auth.
          if (llmProviders.some((p) => p.name.trim() === "")) {
            throw new Error(
              t("settings.providerNameRequired", undefined, "Provider name is required"),
            );
          }
          const validProviders = llmProviders.filter((p) => p.name.trim() !== "");
          const providersObj: Record<string, any> = {};
          for (const p of validProviders) {
            providersObj[p.name] = { baseUrl: p.baseUrl, apiKey: p.apiKey, api: p.api };
          }
          const res = await fetch(`${getApiBase()}/api/providers`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providers: providersObj }),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "providers");
          const saved = validProviders.map(({ isNew, ...rest }) => rest);
          setLlmProviders(saved);
          setOriginalLlmProviders(JSON.parse(JSON.stringify(saved)));
          return {};
        },
      });
    }

    for (const [id, src] of draftSources) {
      if (!src.isDirty) continue;
      tasks.push({ label: id, run: async () => { await src.commit(); return {}; } });
    }

    const results = await Promise.allSettled(tasks.map((tk) => tk.run()));
    const failed: string[] = [];
    let restartRequired = false;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") restartRequired ||= !!r.value.restartRequired;
      else {
        const reason = r.reason instanceof Error ? r.reason.message : "";
        failed.push(reason ? `${tasks[i].label}: ${reason}` : tasks[i].label);
      }
    });

    if (failed.length > 0) {
      setMessage({
        type: "error",
        text: t("settings.savePartialFail", undefined, "Couldn't save: ") + failed.join(", "),
      });
    } else if (restartRequired) {
      setMessage({ type: "warn", text: t("settings.restartRequired", undefined, "Saved. Some changes require a server restart to take effect.") });
    } else {
      setMessage({ type: "success", text: t("settings.saved", undefined, "Settings saved") });
    }
    setSaving(false);
    return failed.length === 0;
  }, [config, original, isDirty, configDirty, configPartial, llmChanged, llmProviders, draftSources, refreshGitSourceReadout, t]);

  // ── Unsaved-changes navigation guards ─────────────────────────────────────
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // In-app navigation away from Settings: prompt when dirty, else go.
  const requestNavigate = useCallback((to: string) => {
    if (isDirtyRef.current) setPendingNav(to);
    else navigate(to);
  }, [navigate]);

  // Back arrow: resolve through the depth-aware `onBack` (launching route) when
  // provided, else fall back to the card list. Routed through the same dirty
  // guard via the BACK_SENTINEL pending value so unsaved edits still prompt.
  // See change: fix-settings-back-to-launching-route.
  const performBack = useCallback(() => {
    if (onBack) onBack();
    else navigate("/");
  }, [onBack, navigate]);
  const requestBack = useCallback(() => {
    if (isDirtyRef.current) setPendingNav(BACK_SENTINEL);
    else performBack();
  }, [performBack]);

  // Hard exits (tab close / reload / Electron window close): native prompt,
  // registered only while dirty.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Browser back/forward: while dirty, re-push state and prompt instead of
  // losing edits. See change: unify-settings-save-contract.
  useEffect(() => {
    if (!isDirty) return;
    window.history.pushState(null, "", window.location.href);
    const onPop = () => {
      if (isDirtyRef.current) {
        window.history.pushState(null, "", window.location.href);
        setPendingNav("/");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [isDirty]);

  const confirmDiscardLeave = useCallback(() => {
    const to = pendingNav;
    handleDiscard();
    setPendingNav(null);
    if (to === BACK_SENTINEL) performBack();
    else if (to) navigate(to);
  }, [pendingNav, handleDiscard, navigate, performBack]);

  const confirmSaveLeave = useCallback(async () => {
    const to = pendingNav;
    const ok = await handleSave();
    setPendingNav(null);
    if (!ok) return;
    if (to === BACK_SENTINEL) performBack();
    else if (to) navigate(to);
  }, [pendingNav, handleSave, navigate, performBack]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        {t("settings.loading", undefined, "Loading settings...")}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400">
        {t("settings.failedLoad", undefined, "Failed to load settings")}
      </div>
    );
  }

  const update = (fn: (c: Config) => void) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
  };

  const ensureAuth = (): AuthConfig => {
    if (!config.auth) {
      const auth: AuthConfig = { secret: "", providers: {}, allowedUsers: [] };
      update((c) => { c.auth = auth; });
      return auth;
    }
    return config.auth;
  };

  // Left-nav page groups. See change: reorganize-settings-into-pages.
  const navGroups: { label: string; items: { id: string; label: string; icon: string }[] }[] = [
    {
      label: t("settings.groupDashboard", undefined, "Dashboard"),
      items: [
        { id: "general", label: t("settings.general", undefined, "General"), icon: mdiCog },
        { id: "server", label: i18nT("auto.server", undefined, "Server"), icon: mdiServer },
        { id: "sessions", label: t("settings.sessions", undefined, "Sessions"), icon: mdiViewDashboard },
      ],
    },
    {
      label: t("settings.groupNetwork", undefined, "Network"),
      items: [
        { id: "remote", label: t("settings.remoteServers", undefined, "Remote Servers"), icon: mdiWeb },
        { id: "gateway", label: t("settings.gateway", undefined, "Gateway"), icon: mdiTunnel },
        { id: "security", label: t("settings.security", undefined, "Security"), icon: mdiLock },
      ],
    },
    {
      label: t("settings.groupExtensions", undefined, "Extensions"),
      items: [
        { id: "providers", label: t("settings.providers", undefined, "Providers"), icon: mdiKey },
        { id: "packages", label: t("settings.packages", undefined, "Packages"), icon: mdiPackageVariant },
        { id: "plugins", label: t("settings.plugins", undefined, "Plugins"), icon: mdiPuzzle },
        { id: "openspec", label: t("settings.openspec", undefined, "OpenSpec"), icon: mdiClipboardText },
      ],
    },
    {
      label: t("settings.groupResources", undefined, "Resources"),
      items: [
        { id: "skills", label: i18nT("auto.skills", undefined, "Skills"), icon: mdiBookOpenPageVariant },
        { id: "agents", label: i18nT("auto.agents", undefined, "Agents"), icon: mdiRobotOutline },
        { id: "extensions", label: i18nT("auto.extensions", undefined, "Extensions"), icon: mdiPuzzleOutline },
        { id: "prompts", label: i18nT("auto.prompts", undefined, "Prompts"), icon: mdiTextBoxOutline },
        { id: "themes", label: i18nT("auto.themes", undefined, "Themes"), icon: mdiPalette },
      ],
    },
    {
      label: t("settings.groupAdvanced", undefined, "Advanced"),
      items: [
        { id: "developer", label: t("settings.developer", undefined, "Developer"), icon: mdiWrench },
        { id: "instructions", label: i18nT("auto.instructions", undefined, "Instructions"), icon: mdiFileDocumentEditOutline },
      ],
    },
  ];

  return (
    <SettingsDraftProvider registry={draftRegistry}>
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Header */}
      <div data-testid="settings-header" className="flex items-center gap-3 p-4 border-b border-[var(--border-primary)] shrink-0">
        <button
          onClick={() => requestBack()}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={t("common.back", undefined, "Back")}
        >
          <Icon path={mdiArrowLeft} size={0.8} />
        </button>
        <h1 className="text-lg font-bold text-[var(--text-primary)]">{t("common.settings", undefined, "Settings")}</h1>
        <div className="flex-1" />
        <button
          onClick={() => { setMessage(null); restart.run(); }}
          disabled={restarting || saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm font-medium disabled:opacity-50 border border-[var(--border-secondary)]"
          title={t("settings.restartServer", undefined, "Restart server")}
        >
          <Icon path={mdiRestart} size={0.6} />
          {restarting ? t("common.restarting", undefined, "Restarting...") : t("common.restart", undefined, "Restart")}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className={`px-4 py-2 text-sm shrink-0 ${
          message.type === "success" ? "bg-green-600/20 text-green-400" :
          message.type === "warn" ? "bg-amber-600/20 text-amber-400" :
          "bg-red-600/20 text-red-400"
        }`}>
          {message.type === "warn" && <Icon path={mdiAlert} size={0.5} className="inline mr-1" />}
          {message.text}
        </div>
      )}

      {/* Body: left nav rail + page content */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <nav
          data-testid="settings-nav-rail"
          aria-label={t("common.settings", undefined, "Settings")}
          className="shrink-0 w-full md:w-56 flex md:flex-col gap-0.5 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-[var(--border-primary)] p-2"
        >
          {navGroups.map((group) => (
            <div key={group.label} className="contents md:block">
              <div className="hidden md:block px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                {group.label}
              </div>
              {group.items.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate("/settings/" + item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? "bg-blue-600/15 text-[var(--text-primary)] font-semibold"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    <Icon path={item.icon} size={0.65} />
                    {item.label}
                    {dirtyPages.has(item.id) && (
                      <span
                        data-testid={`nav-dirty-${item.id}`}
                        title={t("settings.unsavedOnPage", undefined, "Unsaved changes on this page")}
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Page content. The Instructions page is a full-bleed split editor, so
            it renders directly in the content area (no padded/max-width/scroll
            wrapper that would collapse its height). See change:
            directory-settings-page-and-scoped-md-editing. */}
        <div data-testid="settings-content" className="flex-1 min-h-0 min-w-0 flex flex-col">
          {activeTab === "instructions" ? (
            <InstructionsPage />
          ) : activeTab in RESOURCE_TAB_TYPE ? (
            <div className="flex-1 overflow-y-auto min-w-0">
              <ResourceGridPanel
                data={piResources.data}
                isLoading={piResources.isLoading}
                error={piResources.error}
                refresh={piResources.refresh}
                activation={resourceActivation}
                type={RESOURCE_TAB_TYPE[activeTab]}
                scopes={["global"]}
                showScopeFilter={false}
                globalPill
                onViewFile={(filePath, title) => navigate(buildPiResourceFileUrl(filePath, title))}
              />
              {/* Per-page plugin slot mounts (literal ids for the registry lint). */}
              <div className="px-3">
                {activeTab === "skills" && <SettingsSectionSlot tab="skills" />}
                {activeTab === "agents" && <SettingsSectionSlot tab="agents" />}
                {activeTab === "extensions" && <SettingsSectionSlot tab="extensions" />}
                {activeTab === "prompts" && <SettingsSectionSlot tab="prompts" />}
                {activeTab === "themes" && <SettingsSectionSlot tab="themes" />}
              </div>
            </div>
          ) : (
          <div className="p-4 space-y-6 max-w-3xl overflow-y-auto">

            {activeTab === "general" && (
              <>
                <PiVersionAdvisory />
                <Section title={t("settings.interface", undefined, "Interface")}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">
                    {t("settings.interfaceDescription", undefined, "Choose the dashboard interface language. The selection is saved in this browser.")}
                  </p>
                  <SelectField
                    label={t("settings.language", undefined, "Language")}
                    value={language}
                    options={LANGUAGE_OPTIONS}
                    onChange={(v) => setLanguage(v as Language)}
                  />
                </Section>
                <DisplayPrefsSection />
                <SettingsSectionSlot tab="general" />
              </>
            )}

            {activeTab === "server" && (
              <>
                <Section title={i18nT("auto.server", undefined, "Server")}>
                  <NumberField label={t("settings.httpPort", undefined, "HTTP Port")} value={config.port} onChange={(v) => update((c) => { c.port = v; })} />
                  <NumberField label={t("settings.piGatewayPort", undefined, "Pi Gateway Port")} value={config.piPort} onChange={(v) => update((c) => { c.piPort = v; })} />
                  <ListenInterfaceField
                    bindHost={config.bindHost ?? "127.0.0.1"}
                    hasGuardConfig={hasGuardConfig(config)}
                    onChange={(v) => update((c) => { c.bindHost = v; })}
                  />
                  <ToggleField label={t("settings.autoShutdown", undefined, "Auto Shutdown")} value={config.autoShutdown} onChange={(v) => update((c) => { c.autoShutdown = v; })} />
                  {config.autoShutdown && (
                    <NumberField label={i18nT("auto.idle_seconds_before_shutdown", undefined, "Idle Seconds Before Shutdown")} value={config.shutdownIdleSeconds} onChange={(v) => update((c) => { c.shutdownIdleSeconds = v; })} />
                  )}
                </Section>
                <Section title={t("settings.tunnel", undefined, "Gateway")}>
                  <ToggleField label={t("settings.enableZrokTunnel", undefined, "Enable Gateway")} value={config.tunnel.enabled} onChange={(v) => update((c) => { c.tunnel.enabled = v; })} />
                  <div className="mt-3 pt-3 border-t border-[var(--border-secondary)] space-y-2">
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.watchdog_probes_the_public_tunnel_url", undefined, "Watchdog probes the public Gateway URL periodically and recycles it after consecutive failures (e.g. a zrok edge returning 502).")}
                    </p>
                    <ToggleField
                      label={t("settings.enableWatchdog", undefined, "Enable Watchdog")}
                      value={config.tunnel.watchdog?.enabled ?? true}
                      onChange={(v) => update((c) => {
                        c.tunnel.watchdog = {
                          enabled: v,
                          intervalMs: c.tunnel.watchdog?.intervalMs ?? 60000,
                          failureThreshold: c.tunnel.watchdog?.failureThreshold ?? 2,
                          probeTimeoutMs: c.tunnel.watchdog?.probeTimeoutMs ?? 10000,
                        };
                      })}
                    />
                    <NumberField
                      label={t("settings.probeInterval", undefined, "Probe Interval (seconds)")}
                      value={Math.round((config.tunnel.watchdog?.intervalMs ?? 60000) / 1000)}
                      onChange={(v) => update((c) => {
                        c.tunnel.watchdog = {
                          enabled: c.tunnel.watchdog?.enabled ?? true,
                          intervalMs: Math.max(5, v) * 1000,
                          failureThreshold: c.tunnel.watchdog?.failureThreshold ?? 2,
                          probeTimeoutMs: c.tunnel.watchdog?.probeTimeoutMs ?? 10000,
                        };
                      })}
                    />
                    <NumberField
                      label={i18nT("auto.failure_threshold", undefined, "Failure Threshold")}
                      value={config.tunnel.watchdog?.failureThreshold ?? 2}
                      onChange={(v) => update((c) => {
                        c.tunnel.watchdog = {
                          enabled: c.tunnel.watchdog?.enabled ?? true,
                          intervalMs: c.tunnel.watchdog?.intervalMs ?? 60000,
                          failureThreshold: Math.max(1, v),
                          probeTimeoutMs: c.tunnel.watchdog?.probeTimeoutMs ?? 10000,
                        };
                      })}
                    />
                    <NumberField
                      label={t("settings.probeTimeout", undefined, "Probe Timeout (seconds)")}
                      value={Math.round((config.tunnel.watchdog?.probeTimeoutMs ?? 10000) / 1000)}
                      onChange={(v) => update((c) => {
                        c.tunnel.watchdog = {
                          enabled: c.tunnel.watchdog?.enabled ?? true,
                          intervalMs: c.tunnel.watchdog?.intervalMs ?? 60000,
                          failureThreshold: c.tunnel.watchdog?.failureThreshold ?? 2,
                          probeTimeoutMs: Math.max(1, v) * 1000,
                        };
                      })}
                    />
                  </div>
                </Section>
                <Section title={t("settings.memoryLimits", undefined, "Memory Limits")}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">
                    {t("settings.memoryLimitsDescription", undefined, "Controls for bounding server memory usage. Set to 0 to disable a limit. Requires server restart.")}
                  </p>
                  <NumberField
                    label={i18nT("auto.max_events_per_session", undefined, "Max Events Per Session")}
                    value={config.memoryLimits?.maxEventsPerSession ?? 200}
                    onChange={(v) => update((c) => {
                      if (!c.memoryLimits) c.memoryLimits = { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 };
                      c.memoryLimits.maxEventsPerSession = v;
                    })}
                  />
                  <NumberField
                    label={i18nT("auto.max_string_truncation_chars", undefined, "Max String Truncation (chars)")}
                    value={config.memoryLimits?.maxStringFieldSize ?? 4000}
                    onChange={(v) => update((c) => {
                      if (!c.memoryLimits) c.memoryLimits = { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 };
                      c.memoryLimits.maxStringFieldSize = v;
                    })}
                  />
                  <NumberField
                    label={i18nT("auto.max_websocket_buffer_bytes", undefined, "Max WebSocket Buffer (bytes)")}
                    value={config.memoryLimits?.maxWsBufferBytes ?? 4194304}
                    onChange={(v) => update((c) => {
                      if (!c.memoryLimits) c.memoryLimits = { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 };
                      c.memoryLimits.maxWsBufferBytes = v;
                    })}
                  />
                </Section>
                <SettingsSectionSlot tab="server" />
              </>
            )}

            {activeTab === "sessions" && (
              <>
                <Section title={t("settings.sessions", undefined, "Sessions")}>
                  <SelectField
                    label={t("settings.spawnStrategy", undefined, "+Session Strategy")}
                    value={config.spawnStrategy}
                    options={[{ value: "headless", label: "Headless" }, { value: "tmux", label: "Tmux" }]}
                    onChange={(v) => update((c) => { c.spawnStrategy = v; })}
                  />
                  <div>
                    <SelectField
                      label={i18nT("auto.reattach_placement", undefined, "Reattach Placement")}
                      value={config.reattachPlacement ?? "always"}
                      options={[
                        { value: "always", label: "Always move to top (default)" },
                        { value: "streaming-only", label: "Only when streaming" },
                        { value: "preserve", label: "Preserve drag order" },
                      ]}
                      onChange={(v) => update((c) => { c.reattachPlacement = v as "preserve" | "streaming-only" | "always"; })}
                    />
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.when_the_dashboard_restarts_and_a", undefined, "When the dashboard restarts and a still-alive pi session reconnects, choose where its card goes in the folder list.")}
                    </p>
                  </div>
                  <div>
                    <SelectField
                      label={i18nT("auto.reopen_sessions_after_shutdown", undefined, "Reopen sessions after shutdown")}
                      value={config.reopenSessionsAfterShutdown ?? "ask"}
                      options={[
                        { value: "ask", label: "Ask (default)" },
                        { value: "auto", label: "Reopen automatically" },
                        { value: "off", label: "Never" },
                      ]}
                      onChange={(v) => update((c) => { c.reopenSessionsAfterShutdown = v as "off" | "ask" | "auto"; })}
                    />
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.when_sessions_were_running_at_shutdown", undefined, "When sessions were running when the machine shut down or crashed, offer to reopen them on next launch. Ask shows a prompt; Auto reopens them silently; Never ignores them.")}
                    </p>
                  </div>
                  <div>
                    <ToggleField
                      label={i18nT("auto.put_completed_session_first", undefined, "Put completed session first")}
                      value={config.completedFirst ?? false}
                      onChange={(v) => update((c) => { c.completedFirst = v; })}
                    />
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.when_a_session_finishes_a_turn", undefined, "When a session finishes a turn or ends, move its card to the top of its tier (active, resp. ended). Off keeps the card in place.")}
                    </p>
                  </div>
                  <div>
                    <ToggleField
                      label={i18nT("auto.put_question_session_first", undefined, "Put question session first")}
                      value={config.questionFirst ?? false}
                      onChange={(v) => update((c) => { c.questionFirst = v; })}
                    />
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.when_a_session_asks_a_question", undefined, "When a session asks a question (ask_user), move its card to the top of the active tier. Off keeps the card in place.")}
                    </p>
                  </div>
                  <div>
                    <NumberField
                      label={i18nT("auto.ask_user_prompt_timeout_seconds", undefined, "ask_user Prompt Timeout (seconds)")}
                      value={config.askUserPromptTimeoutSeconds ?? 300}
                      onChange={(v) => update((c) => { c.askUserPromptTimeoutSeconds = v; })}
                    />
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.how_long_an_interactive_ask_user", undefined, "How long an interactive ask_user prompt waits for an answer before auto-cancelling. Use")} <code>-1</code> (or <code>0</code>{i18nT("auto.to_wait_forever_default_300_5", undefined, ") to wait forever. Default: 300 (5 min).")}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-[var(--text-secondary)]">{i18nT("auto.session_register_timeout_ms", undefined, "+Session register timeout (ms)")}</label>
                      <input
                        type="number"
                        className={`w-28 bg-[var(--bg-secondary)] border rounded px-2 py-1 text-sm text-[var(--text-primary)] text-right ${
                          spawnTimeoutInvalid
                            ? "border-red-500 text-red-400"
                            : "border-[var(--border-secondary)]"
                        }`}
                        value={config.spawnRegisterTimeoutMs ?? 30000}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          const invalid = isNaN(v) || v < 5000 || v > 120000;
                          setSpawnTimeoutInvalid(invalid);
                          if (!invalid) update((c) => { c.spawnRegisterTimeoutMs = v; });
                        }}
                      />
                    </div>
                    {spawnTimeoutInvalid && (
                      <p className="mt-1 text-xs text-red-400">{i18nT("auto.must_be_an_integer_between_5000", undefined, "Must be an integer between 5000 and 120000.")}</p>
                    )}
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.how_long_to_wait_for_a", undefined, "How long to wait for a spawned pi session to connect before showing a warning. Default 30000 (30s). Range 5000–120000.")}
                    </p>
                  </div>
                  <div>
                    <ToggleField
                      label={i18nT("auto.show_worktree_spawn_buttons_in_folders", undefined, "Show worktree spawn buttons in folders and OpenSpec rows")}
                      value={config.gitWorktreeEnabled ?? true}
                      onChange={(v) => update((c) => { c.gitWorktreeEnabled = v; })}
                    />
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.ui_preference_only_hides_the_folder", undefined, "UI preference only. Hides the folder")} <code>+Worktree</code> {i18nT("auto.button_and_the_per_change", undefined, "button and the per-change")} <code>⥂2+</code> {i18nT("auto.button_on_openspec_rows_the", undefined, "button on OpenSpec rows. The")} <code>/api/git/worktree*</code> {i18nT("auto.rest_endpoints_stay_reachable_for_tooling", undefined, "REST endpoints stay reachable for tooling. Default on.")}
                    </p>
                  </div>
                  <div>
                    <WorktreeAutoInitToggle />
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.after_spawning_a_worktree_auto_run", undefined, "After spawning a worktree, automatically run its declared")} <code>worktreeInit</code> {i18nT("auto.hook_only_when_already_trusted", undefined, "hook — only when the hook is already trusted. Untrusted hooks still require a manual Initialize click to grant trust. Default off.")}
                    </p>
                  </div>
                  {/* Windows-only: bundled-vs-host git & bash. Hidden on
                      macOS/Linux (gitSourceReadout null). See change:
                      embed-git-bash-on-windows. */}
                  {gitSourceReadout && (
                    <div>
                      <SelectField
                        label={i18nT("auto.git_bash_source", undefined, "Git & Bash source (Windows)")}
                        value={config.windowsGitSource ?? "auto"}
                        options={[
                          { value: "auto", label: "Auto — host when installed, else bundled (default)" },
                          { value: "host", label: "Host only — use the installed Git for Windows" },
                          { value: "bundled", label: "Bundled only — always use the shipped git" },
                        ]}
                        onChange={(v) => update((c) => { c.windowsGitSource = v as "auto" | "host" | "bundled"; })}
                      />
                      <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                        {i18nT("auto.currently_active", undefined, "Currently active:")}{" "}
                        <strong>{gitSourceReadout.source}</strong>
                        {gitSourceReadout.gitPath ? <> — <code>{gitSourceReadout.gitPath}</code></> : null}
                        {gitSourceReadout.gitVersion ? <> ({gitSourceReadout.gitVersion})</> : null}
                        . {i18nT("auto.git_source_takes_effect", undefined, "Takes effect for newly spawned sessions. macOS/Linux ignore this setting.")}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                      <label className="text-sm text-[var(--text-secondary)]">{t("settings.defaultModel", undefined, "Default Model")}</label>
                    <ModelSelector
                      current={config.defaultModel || undefined}
                      models={availableModels}
                      onSelect={(v) => update((c) => { c.defaultModel = v; })}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-[var(--text-secondary)]">{i18nT("auto.pwa_display_name", undefined, "PWA Display Name")}</label>
                      <input
                        type="text"
                        className="w-56 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
                        placeholder={i18nT("auto.auto_from_hostname", undefined, "(auto from hostname)")}
                        value={config.dashboardName ?? ""}
                        onChange={(e) => update((c) => { c.dashboardName = e.target.value; })}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {i18nT("auto.shown_on_the_home_screen_app", undefined, "Shown on the home screen / app drawer when the dashboard is installed as a PWA. Leave blank to auto-derive from the request")} <code>{i18nT("auto.host", undefined, "Host")}</code> {i18nT("auto.header_or_the_server_hostname_distinguishe", undefined, "header (or the server hostname). Distinguishes installs from multiple machines or tunnels.")}
                    </p>
                  </div>
                </Section>
                <SettingsSectionSlot tab="sessions" />
              </>
            )}

            {activeTab === "gateway" && <GatewayPage />}

            {activeTab === "remote" && (
              <>
                <ServersTab />
                <SettingsSectionSlot tab="remote" />
              </>
            )}

            {activeTab === "security" && (
              <>
                <Section title={t("settings.auth", undefined, "Authentication")}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-3">
                    {t("settings.authDescription", undefined, "Configure OAuth providers to protect external (Gateway) access. Localhost is always open.")}
                  </p>
                  {["github", "google", "keycloak", "oidc"].map((key) => (
                    <ProviderSection
                      key={key}
                      providerKey={key}
                      provider={config.auth?.providers[key]}
                      onChange={(p) => update((c) => {
                        if (!c.auth) c.auth = { secret: "", providers: {}, allowedUsers: [] };
                        if (p) {
                          c.auth.providers[key] = p;
                        } else {
                          delete c.auth.providers[key];
                        }
                      })}
                    />
                  ))}
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      {t("settings.allowedUsers", undefined, "Allowed Users")} <span className="text-[var(--text-tertiary)]">({t("settings.allowedUsersHint", undefined, "one per line: username, email, or *@domain")})</span>
                    </label>
                    <textarea
                      className="w-full bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1.5 text-sm text-[var(--text-primary)] font-mono resize-y"
                      rows={3}
                      placeholder={"octocat\nuser@example.com\n*@company.com"}
                      value={(config.auth?.allowedUsers || []).join("\n")}
                      onChange={(e) => {
                        const users = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                        update((c) => {
                          if (!c.auth) c.auth = { secret: "", providers: {}, allowedUsers: [] };
                          c.auth.allowedUsers = users;
                        });
                      }}
                    />
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      {t("settings.bypassUrls", undefined, "Bypass URL Prefixes")} <span className="text-[var(--text-tertiary)]">({t("settings.bypassUrlsHint", undefined, "one per line — requests to these paths skip auth")})</span>
                    </label>
                    <textarea
                      className="w-full bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1.5 text-sm text-[var(--text-primary)] font-mono resize-y"
                      rows={2}
                      data-testid="bypass-urls-textarea"
                      placeholder={"/webhooks/\n/metrics"}
                      value={(config.auth?.bypassUrls || []).join("\n")}
                      onChange={(e) => {
                        const urls = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                        update((c) => {
                          if (!c.auth) c.auth = { secret: "", providers: {} };
                          c.auth.bypassUrls = urls;
                        });
                      }}
                    />
                  </div>
                </Section>
                <TrustedNetworksSection
                  bypassHosts={config.auth?.bypassHosts ?? []}
                  legacyTrustedNetworks={config.trustedNetworks ?? []}
                  onChange={(nets) => update((c) => {
                    if (!c.auth) c.auth = { secret: "", providers: {} };
                    c.auth.bypassHosts = nets;
                  })}
                />
                <Section title={t("settings.pairDevice", undefined, "Pair a device")}>
                  <PairingView />
                </Section>
                <Section title={t("settings.pairedDevices", undefined, "Paired Devices")}>
                  <PairedDevicesSection />
                </Section>
                <SettingsSectionSlot tab="security" />
              </>
            )}

            {activeTab === "providers" && (
              <>
                <Section title={t("settings.providerAuth", undefined, "Provider Authentication")}>
                  <ProviderAuthSection />
                </Section>
                <Section title={t("settings.llmProviders", undefined, "LLM Providers")}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-3">
                    {t("settings.llmProvidersDescription", undefined, "Register custom OpenAI-compatible API endpoints for model access.")}
                  </p>
                  {llmProviders.map((provider, index) => (
                    <LlmProviderCard
                      key={`${provider.name}-${index}`}
                      provider={provider}
                      onChange={(updated) => {
                        setLlmProviders((prev) => prev.map((p, i) => (i === index ? updated : p)));
                      }}
                      onRemove={() => {
                        setLlmProviders((prev) => prev.filter((_, i) => i !== index));
                      }}
                    />
                  ))}
                  <button
                    onClick={() => setLlmProviders((prev) => [...prev, { name: "", baseUrl: "", apiKey: "", api: "openai-completions", isNew: true }])}
                    className="flex items-center gap-1.5 text-sm text-[var(--accent-blue)] hover:text-blue-400 mt-1"
                  >
                    <Icon path={mdiPlus} size={0.6} />
                    {t("settings.addProvider", undefined, "Add Provider")}
                  </button>
                </Section>
                <Section title={t("settings.apiProxy", undefined, "API Proxy")}>
                  <ModelProxySection
                    config={config.modelProxy ?? {}}
                    onChange={(patch) => update((c) => { c.modelProxy = { ...c.modelProxy, ...patch }; })}
                    upstreamExtensionDetected={upstreamPiModelProxyInstalled}
                    availableModels={availableModels}
                  />
                </Section>
                <SettingsSectionSlot tab="providers" />
              </>
            )}

            {activeTab === "packages" && (
              <>
                <UnifiedPackagesSection />
                <GlobalPackagesBrowseAndDialogs />
                <SettingsSectionSlot tab="packages" />
              </>
            )}

            {activeTab === "plugins" && (
              <>
                <PluginsSection />
                <SettingsSectionSlot tab="plugins" />
              </>
            )}

            {activeTab === "openspec" && (
              <>
                <Section title={t("settings.backgroundPolling", undefined, "Background polling (OpenSpec)")}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">
                    {i18nT("auto.controls_how_aggressively_the_server_polls", undefined, "Controls how aggressively the server polls")} <code>{i18nT("auto.openspec_list", undefined, "openspec list")}</code> and <code>{i18nT("auto.openspec_status", undefined, "openspec status")}</code> {i18nT("auto.for_each_known_directory_longer_interval", undefined, "for each known directory. Longer interval → less CPU, slightly staler UI. Lower concurrency → smoother curve. Change detection")} <code>mtime</code> {i18nT("auto.skips_re_polling_unchanged_proposals_recom", undefined, "skips re-polling unchanged proposals (recommended).")}
                  </p>
                  <ToggleField
                    label={t("settings.enableOpenSpec", undefined, "Enable OpenSpec")}
                    value={config.openspec?.enabled ?? DEFAULT_OPENSPEC_UI.enabled}
                    onChange={(v) => update((c) => {
                      if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                      c.openspec.enabled = v;
                    })}
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">
                    {i18nT("auto.when_off_openspec_is_fully_disabled", undefined, "When off, OpenSpec is fully disabled: no polling, no OPENSPEC subcards on session cards. Tuning values below remain but are ignored.")}
                  </p>
                  {(() => {
                    const openspecOff = (config.openspec?.enabled ?? DEFAULT_OPENSPEC_UI.enabled) === false;
                    return (
                      <>
                        <NumberField
                          label={i18nT("auto.poll_interval_seconds_5_3600", undefined, "Poll Interval (seconds, 5–3600)")}
                          disabled={openspecOff}
                          value={config.openspec?.pollIntervalSeconds ?? DEFAULT_OPENSPEC_UI.pollIntervalSeconds}
                          onChange={(v) => update((c) => {
                            if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                            c.openspec.pollIntervalSeconds = v;
                          })}
                        />
                        <NumberField
                          label={i18nT("auto.max_concurrent_sessions_1_16", undefined, "Max Concurrent +Sessions (1–16)")}
                          disabled={openspecOff}
                          value={config.openspec?.maxConcurrentSpawns ?? DEFAULT_OPENSPEC_UI.maxConcurrentSpawns}
                          onChange={(v) => update((c) => {
                            if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                            c.openspec.maxConcurrentSpawns = v;
                          })}
                        />
                        <SelectField
                          label={i18nT("auto.change_detection", undefined, "Change Detection")}
                          disabled={openspecOff}
                          value={config.openspec?.changeDetection ?? DEFAULT_OPENSPEC_UI.changeDetection}
                          options={[
                            { value: "mtime", label: "mtime (skip unchanged proposals)" },
                            { value: "always", label: "always (re-poll every tick)" },
                          ]}
                          onChange={(v) => update((c) => {
                            if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                            c.openspec.changeDetection = v as "mtime" | "always";
                          })}
                        />
                        <NumberField
                          label={i18nT("auto.jitter_seconds_0_60", undefined, "Jitter (seconds, 0–60)")}
                          disabled={openspecOff}
                          value={config.openspec?.jitterSeconds ?? DEFAULT_OPENSPEC_UI.jitterSeconds}
                          onChange={(v) => update((c) => {
                            if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                            c.openspec.jitterSeconds = v;
                          })}
                        />
                      </>
                    );
                  })()}
                </Section>
                {/* See change: add-openspec-profile-settings. */}
                <OpenSpecProfileSection />
                <SettingsSectionSlot tab="openspec" />
              </>
            )}

            {activeTab === "developer" && (
              <>
                <Section title={t("settings.chatDisplay", undefined, "Chat Display")}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">
                    {t("settings.chatDisplayAdvancedDescription", undefined, "Controls what is shown in the chat message stream.")}
                  </p>
                  <DebugToolsToggle />
                </Section>
                {/* Configurable chat display (configurable-chat-display). */}
                <Section title={t("settings.developer", undefined, "Developer")}>
                  <ToggleField label={t("settings.devBuildOnReload", undefined, "Dev Build on Reload")} value={config.devBuildOnReload} onChange={(v) => update((c) => { c.devBuildOnReload = v; })} />
                  <ToggleField
                    label={t("settings.capturePiOutput", undefined, "Capture pi session output (debug)")}
                    value={config.keeperLog?.capturePiOutput ?? false}
                    onChange={(v) => update((c) => { c.keeperLog = { ...c.keeperLog, capturePiOutput: v }; })}
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {t("settings.capturePiOutputHint", undefined, "Archives each session's full pi stdout/stderr into keeper-<id>.log for debugging. Consumes significant disk on long sessions — leave off unless diagnosing a session. Applies to newly spawned sessions.")}
                  </p>
                </Section>
                <DiagnosticsSection />
                <ToolsSection />
                <SpawnFailuresSection />
                <Section title={t("settings.editor", undefined, "Editor (code-server)")}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">
                    {t("settings.editorDescription", undefined, "Configure the embedded VS Code editor powered by code-server.")}
                  </p>
                  <TextField
                    label={i18nT("auto.binary_path_leave_empty_for_auto", undefined, "Binary Path (leave empty for auto-detect)")}
                    value={config.editor?.binary ?? ""}
                    onChange={(v) => update((c) => {
                      if (!c.editor) c.editor = {};
                      c.editor.binary = v || undefined;
                    })}
                    placeholder="code-server"
                  />
                  <NumberField
                    label={i18nT("auto.idle_timeout_minutes", undefined, "Idle Timeout (minutes)")}
                    value={config.editor?.idleTimeoutMinutes ?? 10}
                    onChange={(v) => update((c) => {
                      if (!c.editor) c.editor = {};
                      c.editor.idleTimeoutMinutes = v;
                    })}
                  />
                  <NumberField
                    label={i18nT("auto.max_concurrent_instances", undefined, "Max Concurrent Instances")}
                    value={config.editor?.maxInstances ?? 3}
                    onChange={(v) => update((c) => {
                      if (!c.editor) c.editor = {};
                      c.editor.maxInstances = v;
                    })}
                  />
                  <ToggleField
                    label={i18nT("auto.stop_editors_when_dashboard_exits", undefined, "Stop editors when dashboard exits")}
                    value={config.editor?.stopOnDashboardExit ?? false}
                    onChange={(v) => update((c) => {
                      if (!c.editor) c.editor = {};
                      c.editor.stopOnDashboardExit = v;
                    })}
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {i18nT("auto.leave_off_to_let_tabs_and", undefined, "Leave off to let tabs and dirty buffers survive a dashboard restart.")}
                  </p>
                </Section>
                <SettingsSectionSlot tab="developer" />
              </>
            )}

          </div>
          )}
        </div>
      </div>

      {/* Save Bar — present only while dirty (dirty-gated friction). */}
      {isDirty && (
        <div
          data-testid="settings-save-bar"
          className="shrink-0 flex items-center gap-3 px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]"
        >
          <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
            <span data-testid="unsaved-count" className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {unsavedCount}{" "}
            {unsavedCount === 1
              ? t("settings.unsavedOne", undefined, "unsaved change")
              : t("settings.unsavedMany", undefined, "unsaved changes")}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleDiscard}
            disabled={saving}
            data-testid="discard-btn"
            className="px-3 py-1.5 rounded text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {t("settings.discard", undefined, "Discard")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || restarting || spawnTimeoutInvalid}
            data-testid="save-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <Icon path={mdiContentSave} size={0.6} />
            {saving ? t("common.saving", undefined, "Saving...") : t("common.save", undefined, "Save changes")}
          </button>
        </div>
      )}
    </div>

    {pendingNav !== null && (
      <UnsavedChangesDialog
        saving={saving}
        onSave={confirmSaveLeave}
        onDiscard={confirmDiscardLeave}
        onCancel={() => setPendingNav(null)}
      />
    )}
    </SettingsDraftProvider>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// Unsaved-changes confirm dialog shown when navigating away from a dirty
// panel. Offers Save / Discard / Cancel. See change: unify-settings-save-contract.
function UnsavedChangesDialog({ saving, onSave, onDiscard, onCancel }: {
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <DialogPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onCancel}
      >
        <div
          data-testid="unsaved-changes-dialog"
          className="w-full max-w-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">
            {t("settings.unsavedTitle", undefined, "Unsaved changes")}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            {t("settings.unsavedBody", undefined, "You have unsaved settings changes. Save them before leaving?")}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              data-testid="unsaved-cancel"
              onClick={onCancel}
              disabled={saving}
              className="px-3 py-1.5 rounded text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
            >
              {t("settings.keepEditing", undefined, "Cancel")}
            </button>
            <button
              data-testid="unsaved-discard"
              onClick={onDiscard}
              disabled={saving}
              className="px-3 py-1.5 rounded text-sm font-medium text-red-400 border border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
            >
              {t("settings.discard", undefined, "Discard")}
            </button>
            <button
              data-testid="unsaved-save"
              onClick={onSave}
              disabled={saving}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? t("common.saving", undefined, "Saving...") : t("settings.saveChanges", undefined, "Save changes")}
            </button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}

function DebugToolsToggle() {
  const { t } = useI18n();
  const [visible, setVisible] = useDebugToolsVisible();
  return (
    <ToggleField
      label={t("settings.showDebugEvents", undefined, "Show debug events (raw events, flow:list-flows, resources_discover)")}
      value={visible}
      onChange={setVisible}
    />
  );
}

// ── Worktree auto-init toggle (auto-init-worktree-on-spawn) ───────────────
// Self-contained: reads the preference on mount, PATCHes immediately on
// toggle (decoupled from the config Save button). Fail-safe to OFF.
function WorktreeAutoInitToggle() {
  // Buffered source: the toggle edits a local draft; the preference persists
  // only on the unified Save. See change: unify-settings-save-contract.
  const [baseline, setBaseline] = useState<boolean | null>(null);
  const [draft, setDraft] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchAutoInitWorktreePref().then((v) => { if (alive) { setBaseline(v); setDraft(v); } });
    return () => { alive = false; };
  }, []);
  const isDirty = baseline !== null && draft !== baseline;
  const draftRef = useRef(draft); draftRef.current = draft;
  const baseRef = useRef(baseline); baseRef.current = baseline;
  const commit = useCallback(async () => {
    const persisted = await setAutoInitWorktreePref(draftRef.current);
    setBaseline(persisted);
    setDraft(persisted);
  }, []);
  const reset = useCallback(() => { if (baseRef.current !== null) setDraft(baseRef.current); }, []);
  useSettingsDraftSource({ id: "worktree-auto-init", page: "sessions", isDirty, commit, reset });
  return (
    <ToggleField
      label={i18nT("auto.initialize_on_worktree", undefined, "Initialize on worktree")}
      value={draft}
      onChange={setDraft}
    />
  );
}

// ── Display preferences (configurable-chat-display) ───────────────────────────────
function DisplayPrefsSection() {
  const { t } = useI18n();
  const { global } = useDisplayPrefsContext();
  // Buffered source: toggles edit a local draft and persist on the unified
  // Save (the per-session View popover keeps instant apply). See change:
  // unify-settings-save-contract.
  const baselineKey = JSON.stringify(global ?? DISPLAY_PRESETS.standard);
  const [draft, setDraft] = useState<DisplayPrefs>(() => JSON.parse(baselineKey));
  const isDirty = JSON.stringify(draft) !== baselineKey;
  const dirtyRef = useRef(isDirty); dirtyRef.current = isDirty;
  const baselineRef = useRef(baselineKey); baselineRef.current = baselineKey;
  const draftRef = useRef(draft); draftRef.current = draft;
  // Adopt a new baseline (e.g. cross-tab broadcast) only while clean.
  useEffect(() => { if (!dirtyRef.current) setDraft(JSON.parse(baselineKey)); }, [baselineKey]);

  type ToolCallPatch = Partial<DisplayPrefs["toolCalls"]>;
  type DisplayPrefsPatch = Partial<Omit<DisplayPrefs, "toolCalls">> & { toolCalls?: ToolCallPatch };
  const patch = useCallback((partial: DisplayPrefsPatch) => {
    setDraft((prev) => ({
      ...prev,
      ...partial,
      toolCalls: { ...prev.toolCalls, ...(partial.toolCalls ?? {}) },
    }));
  }, []);
  const commit = useCallback(async () => {
    const res = await fetch("/api/preferences/display", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftRef.current),
      credentials: "include",
    });
    if (!res.ok) throw new Error("display prefs");
  }, []);
  const reset = useCallback(() => setDraft(JSON.parse(baselineRef.current)), []);
  useSettingsDraftSource({ id: "display-prefs", page: "general", isDirty, commit, reset });

  const resetToDefaults = useCallback(() => {
    patch(DISPLAY_PRESETS.standard);
  }, [patch]);
  const prefs = draft;

  return (
    <Section title={t("settings.chatDisplay", undefined, "Chat display")}>
      <p className="text-xs text-[var(--text-tertiary)] mb-2">
        {t("settings.chatDisplayDescription", undefined, "Hide chat elements you don't need. Per-session overrides live in the chat view's View popover.")}
      </p>
      <ToggleField label={t("settings.tokenStatsBar", undefined, "Token stats bar")} value={prefs.tokenStatsBar} onChange={(v) => patch({ tokenStatsBar: v })} />
      <ToggleField label={t("settings.contextUsageBar", undefined, "Context usage bar")} value={prefs.contextUsageBar} onChange={(v) => patch({ contextUsageBar: v })} />
      <ToggleField label={t("settings.reasoningBlocks", undefined, "Reasoning blocks")} value={prefs.reasoning} onChange={(v) => patch({ reasoning: v })} />
      <NumberField
        label={t("settings.reasoningAutoCollapse", undefined, "Reasoning auto-collapse (seconds, 0 = never)")}
        value={Math.round(prefs.reasoningAutoCollapseMs / 1000)}
        onChange={(v) => patch({ reasoningAutoCollapseMs: Math.max(0, v) * 1000 })}
        disabled={!prefs.reasoning}
      />
      <ToggleField
        label={t("settings.keepReasoningOpenUntilTurnEnds", undefined, "Keep reasoning open until turn ends")}
        value={prefs.keepReasoningOpenUntilTurnEnds}
        onChange={(v) => patch({ keepReasoningOpenUntilTurnEnds: v })}
        disabled={!prefs.reasoning}
      />
      <ToggleField
        label={t("settings.toolGroupDefaultCollapsed", undefined, "Keep tool groups collapsed by default")}
        value={prefs.toolGroupDefaultCollapsed}
        onChange={(v) => patch({ toolGroupDefaultCollapsed: v })}
      />
      <ToggleField label={t("settings.toolResultBodies", undefined, "Tool result bodies")} value={prefs.toolResults} onChange={(v) => patch({ toolResults: v })} />
      <ToggleField label={t("settings.turnMetadata", undefined, "Turn metadata separators")} value={prefs.turnMetadata} onChange={(v) => patch({ turnMetadata: v })} />
      <ToggleField label={t("settings.changeSummaryTable", undefined, "Per-turn change summary")} value={prefs.changeSummaryTable} onChange={(v) => patch({ changeSummaryTable: v })} />
      <ToggleField label={t("settings.debugEvents", undefined, "Debug events")} value={prefs.debugTools} onChange={(v) => patch({ debugTools: v })} />
      <div className="pt-2">
        <h3 className="text-xs font-semibold text-[var(--text-primary)] mb-2">{t("settings.toolCallsHeader", undefined, "Tool calls - show these types")}</h3>
        <ToggleField label={t("settings.toolRead", undefined, "Read")} value={prefs.toolCalls.read} onChange={(v) => patch({ toolCalls: { read: v } })} />
        <ToggleField label={t("settings.toolBash", undefined, "Bash")} value={prefs.toolCalls.bash} onChange={(v) => patch({ toolCalls: { bash: v } })} />
        <ToggleField label={t("settings.toolEdit", undefined, "Edit / Write")} value={prefs.toolCalls.edit} onChange={(v) => patch({ toolCalls: { edit: v } })} />
        <ToggleField label={t("settings.toolAgent", undefined, "Agent")} value={prefs.toolCalls.agent} onChange={(v) => patch({ toolCalls: { agent: v } })} />
        <ToggleField label={t("settings.toolOther", undefined, "Other")} value={prefs.toolCalls.generic} onChange={(v) => patch({ toolCalls: { generic: v } })} />
      </div>
      <div className="pt-2">
        <button
          type="button"
          onClick={resetToDefaults}
          className="text-xs text-blue-400 hover:text-blue-300 underline"
        >
          {t("settings.resetDefaults", undefined, "Reset to defaults")}
        </button>
      </div>
    </Section>
  );
}

/** Pure: append a trimmed entry to the list if non-empty and not a duplicate. Exported for tests. */
export function addTrustedEntry(current: string[], entry: string): string[] {
  const trimmed = entry.trim();
  if (!trimmed) return current;
  if (current.includes(trimmed)) return current;
  return [...current, trimmed];
}

/** Pure: remove an entry (exact match). Exported for tests. */
export function removeTrustedEntry(current: string[], entry: string): string[] {
  return current.filter((n) => n !== entry);
}

/**
 * "This device was refused — Trust this network?" banner (task 7.2). Surfaces
 * recent guard denials from the anti-poisoning ring buffer; only `trustable`
 * (non-loopback, non-proxied socket-peer) IPs get a Trust action. A one-click
 * add appends the exact host (default) or a wider subnet to the trusted list;
 * the blast-radius warning is stated inline (one entry bypasses auth for every
 * host it covers). Advisory only — never auto-adds. See change: add-tunnel-providers.
 */
function BlockEventTrustBanner({
  trusted,
  onTrust,
}: {
  trusted: string[];
  onTrust: (entry: string) => void;
}) {
  const [events, setEvents] = useState<BlockEvent[]>([]);
  // IPs the operator has acted on this session. A wide-subnet trust (e.g.
  // 10.0.0.0/8) does not contain the exact IP string, so `trusted.includes`
  // alone would leave the banner up — track the dismissal explicitly.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    getBlockEvents()
      .then((evs) => { if (alive) setEvents(evs); })
      .catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, []);

  const trust = (ip: string, entry: string) => {
    setDismissed((prev) => new Set(prev).add(ip));
    onTrust(entry);
  };

  const pending = events.filter((e) => e.trustable && !trusted.includes(e.ip) && !dismissed.has(e.ip));
  if (pending.length === 0) return null;

  return (
    <div className="space-y-1.5 mb-2" data-testid="block-event-banner">
      {pending.map((ev) => {
        const suggestions = suggestTrustEntries(ev.ip);
        return (
          <div
            key={ev.ip}
            className="flex flex-wrap items-center gap-2 rounded border border-[#4a3c14] bg-[var(--amber-soft,#3a2e10)] px-2.5 py-1.5"
            data-testid={`block-event-${ev.ip}`}
          >
            <span className="flex-1 text-xs text-[var(--text-secondary)]">
              <b className="font-mono text-[var(--amber,#e2b24a)]">{ev.ip}</b> refused — not trusted
              {ev.count > 1 ? ` (${ev.count}×)` : ""}.
            </span>
            {suggestions.map((s) => (
              <button
                key={s.value}
                type="button"
                data-testid={`block-event-trust-${s.value}`}
                title={
                  s.wide
                    ? `Grants unauthenticated access to the whole ${s.value} range`
                    : "Grants unauthenticated access to this exact host"
                }
                onClick={() => trust(ev.ip, s.value)}
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                  s.wide
                    ? "border-[#4a3c14] text-[var(--amber,#e2b24a)] hover:bg-[var(--amber-soft,#3a2e10)]"
                    : "border-[#23502f] bg-[var(--green-soft,#132d1c)] text-[#5dd67f]"
                }`}
              >
                + Trust {s.wide ? s.value : "host"}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Pure: should the legacy-hint be visible? Exported for tests. */
export function shouldShowLegacyHint(legacyTrustedNetworks: string[]): boolean {
  return legacyTrustedNetworks.length > 0;
}

function TrustedNetworksSection({
  bypassHosts,
  legacyTrustedNetworks,
  onChange,
}: {
  bypassHosts: string[];
  legacyTrustedNetworks: string[];
  onChange: (nets: string[]) => void;
}) {
  const { t } = useI18n();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualEntry, setManualEntry] = useState("");
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const fetchInterfaces = async () => {
    if (dropdownOpen) { setDropdownOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/network-interfaces`);
      const data = await res.json();
      if (data.success) setInterfaces(data.data);
    } catch { /* ignore */ }
    setLoading(false);
    setDropdownOpen(true);
  };

  const addNetwork = (entry: string) => {
    const next = addTrustedEntry(bypassHosts, entry);
    if (next !== bypassHosts) onChange(next);
    setDropdownOpen(false);
  };

  const removeNetwork = (entry: string) => {
    onChange(removeTrustedEntry(bypassHosts, entry));
  };

  const handleManualAdd = () => {
    const value = manualEntry.trim();
    if (!value) return;
    addNetwork(value);
    setManualEntry("");
  };

  return (
    <Section title={t("settings.trustedNetworks", undefined, "Trusted Networks")}>
      <p className="text-xs text-[var(--text-tertiary)] mb-2">
        {t("settings.trustedNetworksDescription", undefined, "Devices matching these networks or hosts can access the dashboard without authentication. Accepts exact IP, wildcard, or CIDR.")}
      </p>

      {/* Block-event "Trust this network?" banner (task 7.2). */}
      <BlockEventTrustBanner trusted={bypassHosts} onTrust={addNetwork} />

      {bypassHosts.length > 0 && (
        <div className="space-y-1 mb-2" data-testid="trusted-networks-list">
          {bypassHosts.map((net) => (
            <div key={net} className="flex items-center justify-between bg-[var(--bg-secondary)] rounded px-2 py-1">
              <span className="text-sm text-[var(--text-primary)] font-mono">{net}</span>
              <button
                onClick={() => removeNetwork(net)}
                className="text-red-400 hover:text-red-300 text-xs px-1 cursor-pointer"
                title={t("common.remove", undefined, "Remove")}
                data-testid={`trusted-networks-remove-${net}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={fetchInterfaces}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            data-testid="trusted-networks-add-local"
          >
            {loading ? t("settings.detecting", undefined, "Detecting...") : t("settings.addLocalNetwork", undefined, "+ Add Local Network")}
          </button>
          {dropdownOpen && interfaces.length > 0 && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[260px] bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1">
              {interfaces.map((iface) => (
                <button
                  key={`${iface.name}-${iface.cidr}`}
                  onClick={() => addNetwork(iface.cidr)}
                  disabled={bypassHosts.includes(iface.cidr)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer ${
                    bypassHosts.includes(iface.cidr) ? "opacity-40" : ""
                  }`}
                >
                  <span className="font-mono text-[var(--text-primary)]">{iface.cidr}</span>
                  <span className="text-[var(--text-tertiary)] ml-2">{iface.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          type="text"
          value={manualEntry}
          onChange={(e) => setManualEntry(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleManualAdd(); } }}
          placeholder={i18nT("auto.ip_wildcard_or_cidr", undefined, "IP, wildcard, or CIDR")}
          className="flex-1 min-w-[160px] bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-xs font-mono text-[var(--text-primary)]"
          data-testid="trusted-networks-manual-input"
        />
        <button
          onClick={handleManualAdd}
          disabled={!manualEntry.trim()}
          className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="trusted-networks-manual-add"
        >
          {t("common.add", undefined, "Add")}
        </button>
      </div>

      {shouldShowLegacyHint(legacyTrustedNetworks) && (
        <p
          className="text-xs text-[var(--text-tertiary)] mt-2"
          data-testid="trusted-networks-legacy-hint"
        >
          {legacyTrustedNetworks.length} {legacyTrustedNetworks.length === 1 ? "entry" : "entries"} from <code>config.json</code> → <code>{i18nT("auto.trustednetworks", undefined, "trustedNetworks")}</code>
          {" "}{i18nT("auto.are_also_active_edit_them_directly", undefined, "are also active. Edit them directly in that file.")}
        </p>
      )}

      <p className="text-xs text-amber-400/80 mt-2">
        {t("settings.trustedNetworksWarning", undefined, "Anyone on a trusted network has full access to the dashboard without authentication. Only use on private networks you control.")}
      </p>
    </Section>
  );
}

function ServersTab() {
  const { t } = useI18n();
  const [knownServers, setKnownServers] = useState<import("@blackbelt-technology/pi-dashboard-shared/config.js").KnownServer[]>([]);
  const [loadCount, setLoadCount] = useState(0);

  const reload = useCallback(async () => {
    try {
      const { listKnownServers } = await import("../lib/known-servers-api.js");
      const data = await listKnownServers();
      setKnownServers(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { reload(); }, [reload, loadCount]);

  return (
    <>
      <Section title={t("settings.knownServers", undefined, "Known Servers")}>
        <KnownServersSection onChange={() => setLoadCount((c) => c + 1)} />
      </Section>
      <Section title={t("settings.networkDiscovery", undefined, "Network Discovery")}>
        <NetworkDiscoverySection
          knownServers={knownServers}
          onServerAdded={() => setLoadCount((c) => c + 1)}
        />
      </Section>
    </>
  );
}

/**
 * True when the request guard has at least one line of defense configured:
 * an OAuth provider, or a trusted network / bypass host. Drives the
 * all-interfaces exposure warning. See change: configurable-bind-host.
 */
function hasGuardConfig(config: Config): boolean {
  const hasProviders = Object.keys(config.auth?.providers ?? {}).length > 0;
  const hasTrusted = (config.trustedNetworks ?? []).length > 0;
  const hasBypassHosts = (config.auth?.bypassHosts ?? []).length > 0;
  return hasProviders || hasTrusted || hasBypassHosts;
}

type ListenMode = "local" | "all" | "specific";

function bindHostToMode(host: string): ListenMode {
  if (host === "127.0.0.1") return "local";
  if (host === "0.0.0.0") return "all";
  return "specific";
}

/**
 * 3-way listen-interface picker bound to `bindHost`: Local only (127.0.0.1),
 * All interfaces (0.0.0.0), or a specific detected NIC. Options for the
 * specific mode come from GET /api/network-interfaces. Shows an advisory
 * exposure warning when All interfaces is selected without guard config.
 * See change: configurable-bind-host.
 */
function ListenInterfaceField({
  bindHost,
  hasGuardConfig: guarded,
  onChange,
}: {
  bindHost: string;
  hasGuardConfig: boolean;
  onChange: (host: string) => void;
}) {
  const { t } = useI18n();
  const mode = bindHostToMode(bindHost);
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/network-interfaces`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.success) setInterfaces(data.data as NetworkInterfaceInfo[]);
      })
      .catch(() => { /* ignore — picker still offers local/all */ });
    return () => { cancelled = true; };
  }, []);

  const selectMode = (next: ListenMode) => {
    if (next === "local") onChange("127.0.0.1");
    else if (next === "all") onChange("0.0.0.0");
    else onChange(interfaces[0]?.address ?? bindHost);
  };

  const radioId = (m: ListenMode) => `listen-mode-${m}`;

  return (
    <div className="space-y-2" data-testid="listen-interface-field">
      <label className="text-sm text-[var(--text-secondary)]">
        {t("settings.listenInterface", undefined, "Listen Interface")}
      </label>
      <div className="space-y-1">
        <label htmlFor={radioId("local")} className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
          <input id={radioId("local")} type="radio" name="listen-interface" checked={mode === "local"} onChange={() => selectMode("local")} />
          {t("settings.listenLocalOnly", undefined, "Local only")} <code className="text-xs text-[var(--text-tertiary)]">127.0.0.1</code>
        </label>
        <label htmlFor={radioId("all")} className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
          <input id={radioId("all")} type="radio" name="listen-interface" checked={mode === "all"} onChange={() => selectMode("all")} />
          {t("settings.listenAllInterfaces", undefined, "All interfaces")} <code className="text-xs text-[var(--text-tertiary)]">0.0.0.0</code>
        </label>
        <label htmlFor={radioId("specific")} className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
          <input id={radioId("specific")} type="radio" name="listen-interface" checked={mode === "specific"} onChange={() => selectMode("specific")} disabled={interfaces.length === 0} />
          {t("settings.listenSpecificInterface", undefined, "Specific interface")}
          {mode === "specific" && (
            <select
              data-testid="listen-interface-select"
              className="bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
              value={bindHost}
              onChange={(e) => onChange(e.target.value)}
            >
              {interfaces.map((iface) => (
                <option key={iface.address} value={iface.address}>{iface.name} — {iface.address}</option>
              ))}
            </select>
          )}
        </label>
      </div>
      {mode === "all" && !guarded && (
        <div data-testid="listen-exposure-warning" className="flex items-start gap-2 text-xs text-yellow-500 bg-yellow-500/10 rounded px-2 py-1.5">
          <Icon path={mdiAlert} size={0.7} className="mt-0.5 shrink-0" />
          <span>{t("settings.listenExposureWarning", undefined, "All interfaces exposes the dashboard on your LAN. No authentication or trusted networks are configured — anyone who can reach this host can access it.")}</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        {title}
      </h2>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${disabled ? "opacity-50" : ""}`}>
      <label className="text-sm text-[var(--text-secondary)]">{label}</label>
      <input
        type="number"
        disabled={disabled}
        className="w-24 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)] text-right disabled:cursor-not-allowed"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      />
    </div>
  );
}

function ToggleField({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${disabled ? "opacity-50" : ""}`}>
      <label className="text-sm text-[var(--text-secondary)]">{label}</label>
      <button
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors disabled:cursor-not-allowed ${value ? "bg-blue-600" : "bg-[var(--bg-tertiary)]"}`}
      >
        <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function SelectField({ label, value, options, onChange, disabled }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${disabled ? "opacity-50" : ""}`}>
      <label className="text-sm text-[var(--text-secondary)]">{label}</label>
      <select
        disabled={disabled}
        className="bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ProviderSection({ providerKey, provider, onChange }: {
  providerKey: string;
  provider?: ProviderConfig;
  onChange: (p: ProviderConfig | null) => void;
}) {
  const { t } = useI18n();
  const enabled = !!provider;
  const label = PROVIDER_LABELS[providerKey] || providerKey;
  const needsIssuer = NEEDS_ISSUER.has(providerKey);

  return (
    <div className="border border-[var(--border-secondary)] rounded p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
        <button
          onClick={() => {
            if (enabled) {
              onChange(null);
            } else {
              onChange({ clientId: "", clientSecret: "", ...(needsIssuer ? { issuerUrl: "" } : {}) });
            }
          }}
          className={`text-xs px-2 py-0.5 rounded ${enabled ? "bg-red-600/20 text-red-400 hover:bg-red-600/30" : "bg-green-600/20 text-green-400 hover:bg-green-600/30"}`}
        >
          {enabled ? t("common.remove", undefined, "Remove") : t("common.enable", undefined, "Enable")}
        </button>
      </div>
      {enabled && (
        <div className="space-y-2">
          <TextField
            label={i18nT("auto.client_id", undefined, "Client ID")}
            value={provider!.clientId}
            onChange={(v) => onChange({ ...provider!, clientId: v })}
          />
          <TextField
            label={i18nT("auto.client_secret", undefined, "Client Secret")}
            value={provider!.clientSecret}
            onChange={(v) => onChange({ ...provider!, clientSecret: v })}
            type="password"
          />
          {needsIssuer && (
            <TextField
              label={i18nT("auto.issuer_url", undefined, "Issuer URL")}
              value={provider!.issuerUrl || ""}
              onChange={(v) => onChange({ ...provider!, issuerUrl: v })}
              placeholder="https://keycloak.example.com/realms/myrealm"
            />
          )}
        </div>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-[var(--text-tertiary)] mb-0.5">{label}</label>
      <input
        type={type}
        className="w-full bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

const API_TYPE_OPTIONS = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "azure-openai-responses", label: "Azure OpenAI" },
  { value: "mistral-conversations", label: "Mistral" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
  { value: "google-generative-ai", label: "Google Gemini" },
  { value: "google-vertex", label: "Google Vertex AI" },
];

// ─── Global Packages Browse + Confirm-install Dialog ──────────────────────────
//
// The unified packages section above handles the installed-rows view
// and the README dialog. This section keeps only the Browse Packages
// search UI and its install-confirm dialog. See change:
// consolidate-packages-settings-ui.

function GlobalPackagesBrowseAndDialogs() {
  const { t } = useI18n();
  const installed = useInstalledPackages("global");
  const operations = usePackageOperations("global", undefined, installed.refresh);
  const [confirmInstall, setConfirmInstall] = useState<{ source: string; pkg?: NpmPackageResult } | null>(null);
  const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);

  const handleConfirmInstall = (source: string, pkg?: NpmPackageResult) => {
    setConfirmInstall({ source, pkg });
  };

  const doInstall = () => {
    if (!confirmInstall) return;
    operations.install(confirmInstall.source);
    setConfirmInstall(null);
  };

  return (
    <>
      <Section title={t("common.browsePackages", undefined, "Browse Packages")}>
        <PackageBrowser
          scope="global"
          onViewReadme={setReadmePkg}
          onConfirmInstall={handleConfirmInstall}
          // UnifiedPackagesSection above already shows global installed packages.
          // See change: unify-workspace-package-management.
          showInstalledSection={false}
        />
      </Section>

      {confirmInstall && (
        <PackageInstallConfirmDialog
          source={confirmInstall.source}
          packageName={confirmInstall.pkg?.name}
          scope="global"
          lockScope="global"
          onConfirm={doInstall}
          onCancel={() => setConfirmInstall(null)}
        />
      )}
      {readmePkg && (
        <PackageReadmeDialog
          pkg={readmePkg}
          installed={installed.packages.some((p) => p.source === `npm:${readmePkg.name}`)}
          onInstall={() => { handleConfirmInstall(`npm:${readmePkg.name}`, readmePkg); setReadmePkg(null); }}
          onUninstall={() => { operations.remove(`npm:${readmePkg.name}`); setReadmePkg(null); }}
          onClose={() => setReadmePkg(null)}
        />
      )}
    </>
  );
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; modelCount: number; sample: string[] }
  | { kind: "err"; status?: number; message: string };

export function LlmProviderCard({ provider, onChange, onRemove }: {
  provider: LlmProvider;
  onChange: (p: LlmProvider) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });

  const handleChange = (update: LlmProvider) => {
    // Any change to baseUrl / apiKey / api clears a stale test result.
    if (
      update.baseUrl !== provider.baseUrl ||
      update.apiKey !== provider.apiKey ||
      update.api !== provider.api
    ) {
      setTestState({ kind: "idle" });
    }
    onChange(update);
  };

  const canTest =
    provider.baseUrl.trim().length > 0 &&
    provider.apiKey.trim().length > 0 &&
    testState.kind !== "testing";

  const handleTest = async () => {
    if (!canTest) return;
    setTestState({ kind: "testing" });
    const result: TestProviderResult = await testProvider({
      name: provider.isNew ? undefined : provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      api: provider.api,
    });
    if (result.ok) {
      setTestState({ kind: "ok", modelCount: result.modelCount, sample: result.sample ?? [] });
    } else {
      const firstLine = (result.error ?? "Test failed").split("\n")[0].trim();
      setTestState({ kind: "err", status: result.status, message: firstLine || "Test failed" });
    }
  };

  return (
    <div className="border border-[var(--border-secondary)] rounded p-3 mb-2">
      <div className="flex items-center justify-between mb-2 gap-2">
        {provider.isNew ? (
          <input
            type="text"
            className="bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-0.5 text-sm font-medium text-[var(--text-primary)] w-48"
            placeholder={t("settings.providerName", undefined, "Provider name")}
            value={provider.name}
            onChange={(e) => onChange({ ...provider, name: e.target.value })}
            autoFocus
          />
        ) : (
          <span className="text-sm font-medium text-[var(--text-primary)]">{provider.name}</span>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={!canTest}
            title={
              !canTest && testState.kind !== "testing"
                ? t("settings.baseUrlFirst", undefined, "Enter Base URL and API Key first")
                : t("settings.pingModels", undefined, "Ping the provider's /models endpoint")
            }
            className="text-xs px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="test-provider-button"
          >
            {testState.kind === "testing" ? (
              <>
                <Icon path={mdiLoading} size={0.45} className="animate-spin" />
                {t("common.testing", undefined, "Testing...")}
              </>
            ) : (
              <>
                <Icon path={mdiPlay} size={0.45} />
                {t("common.test", undefined, "Test")}
              </>
            )}
          </button>
          <button
            onClick={onRemove}
            className="text-xs px-2 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 flex items-center gap-1"
          >
            <Icon path={mdiDelete} size={0.45} />
            {t("common.remove", undefined, "Remove")}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <TextField
          label={i18nT("auto.base_url", undefined, "Base URL")}
          value={provider.baseUrl}
          onChange={(v) => handleChange({ ...provider, baseUrl: v })}
          placeholder="https://api.example.com/v1"
        />
        <TextField
          label={i18nT("auto.api_key", undefined, "API Key")}
          value={provider.apiKey}
          onChange={(v) => handleChange({ ...provider, apiKey: v })}
          type="password"
          placeholder={i18nT("auto.sk_or_env_var_name", undefined, "sk-... or $ENV_VAR_NAME")}
        />
        <div>
          <label className="block text-xs text-[var(--text-tertiary)] mb-0.5">{i18nT("auto.api_type", undefined, "API Type")}</label>
          <select
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
            value={provider.api}
            onChange={(e) => handleChange({ ...provider, api: e.target.value })}
          >
            {API_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {testState.kind !== "idle" && <TestPill state={testState} />}
      </div>
    </div>
  );
}

function TestPill({ state }: { state: TestState }) {
  const { t } = useI18n();
  if (state.kind === "testing") {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
        data-testid="test-pill"
        data-state="testing"
      >
        <Icon path={mdiLoading} size={0.45} className="animate-spin" />
        {t("common.testing", undefined, "Testing...")}
      </div>
    );
  }
  if (state.kind === "ok") {
    const label = state.modelCount > 0
      ? t("settings.connectedModels", { count: state.modelCount }, `Connected · ${state.modelCount} models`)
      : t("settings.connectedOnly", undefined, "Connected");
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-green-400"
        data-testid="test-pill"
        data-state="ok"
        title={state.sample.length > 0 ? `Sample: ${state.sample.join(", ")}` : undefined}
      >
        <Icon path={mdiCheckCircle} size={0.5} />
        {label}
      </div>
    );
  }
  if (state.kind === "err") {
    const prefix = state.status ? `${state.status} — ` : "";
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-red-400"
        data-testid="test-pill"
        data-state="err"
      >
        <Icon path={mdiCloseCircle} size={0.5} />
        <span className="truncate" title={`${prefix}${state.message}`}>{prefix}{state.message}</span>
      </div>
    );
  }
  // idle — parent guards against rendering, but keep a safe default.
  return null;
}
