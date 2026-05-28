import React, { useState, useEffect, useCallback } from "react";
import { getApiBase } from "../lib/api-context.js";
import { useDebugToolsVisible } from "../hooks/useDebugToolsVisible.js";
import { Icon } from "@mdi/react";
import { mdiArrowLeft, mdiContentSave, mdiAlert, mdiPlus, mdiDelete, mdiRestart, mdiUpdate, mdiCheckCircle, mdiCloseCircle, mdiPlay, mdiLoading } from "@mdi/js";
import { testProvider, type TestProviderResult } from "../lib/providers-api.js";
import { useLocation } from "wouter";
import { ProviderAuthSection } from "./ProviderAuthSection.js";
import { ModelSelector } from "./ModelSelector.js";
import { KnownServersSection } from "./KnownServersSection.js";
import { NetworkDiscoverySection } from "./NetworkDiscoverySection.js";
import { PackageBrowser } from "./PackageBrowser.js";
import { ToolsSection, SpawnFailuresSection } from "./ToolsSection.js";
import { DiagnosticsSection } from "./DiagnosticsSection.js";
import { ModelProxySection } from "./ModelProxySection.js";
import { PackageInstallConfirmDialog } from "./PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "./PackageReadmeDialog.js";
import { useInstalledPackages } from "../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../hooks/usePackageOperations.js";
import { UnifiedPackagesSection } from "./UnifiedPackagesSection.js";
import { PluginsSection } from "./PluginsSection.js";
import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

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
  autoStart: boolean;
  autoShutdown: boolean;
  shutdownIdleSeconds: number;
  spawnStrategy: string;
  /** Reattach placement policy. See change: reattach-move-to-front. */
  reattachPlacement?: "preserve" | "streaming-only" | "always";
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

export function SettingsPanel({ availableModels }: { availableModels?: Array<{ provider: string; id: string }> }) {
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
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    return tab && ["general", "servers", "packages", "plugins", "providers", "security", "advanced"].includes(tab) ? tab : "general";
  });

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
      .catch(() => setMessage({ type: "error", text: "Failed to load settings" }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    if (!config || !original) return;
    setSaving(true);
    setMessage(null);

    // Build partial diff
    const partial: Record<string, any> = {};
    if (config.port !== original.port) partial.port = config.port;
    if (config.piPort !== original.piPort) partial.piPort = config.piPort;
    if (config.autoStart !== original.autoStart) partial.autoStart = config.autoStart;
    if (config.autoShutdown !== original.autoShutdown) partial.autoShutdown = config.autoShutdown;
    if (config.shutdownIdleSeconds !== original.shutdownIdleSeconds) partial.shutdownIdleSeconds = config.shutdownIdleSeconds;
    if (config.spawnStrategy !== original.spawnStrategy) partial.spawnStrategy = config.spawnStrategy;
    if (config.reattachPlacement !== original.reattachPlacement) {
      partial.reattachPlacement = config.reattachPlacement ?? "always";
    }
    if (config.askUserPromptTimeoutSeconds !== original.askUserPromptTimeoutSeconds) {
      partial.askUserPromptTimeoutSeconds = config.askUserPromptTimeoutSeconds ?? 300;
    }
    if (config.spawnRegisterTimeoutMs !== original.spawnRegisterTimeoutMs) {
      partial.spawnRegisterTimeoutMs = config.spawnRegisterTimeoutMs ?? 30000;
    }
    if ((config.gitWorktreeEnabled ?? true) !== (original.gitWorktreeEnabled ?? true)) {
      partial.gitWorktreeEnabled = config.gitWorktreeEnabled ?? true;
    }
    // Tunnel diff (top-level enabled + nested watchdog)
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
    // PWA display name. Empty/whitespace clears the override (server falls
    // back to Host header → os.hostname()). See change:
    // add-dynamic-pwa-manifest-naming.
    if ((config.dashboardName ?? "") !== (original.dashboardName ?? "")) {
      const trimmed = (config.dashboardName ?? "").trim();
      partial.dashboardName = trimmed.length > 0 ? trimmed : "";
    }

    // Trusted networks diff
    if (JSON.stringify(config.trustedNetworks) !== JSON.stringify(original.trustedNetworks)) {
      partial.trustedNetworks = config.trustedNetworks ?? [];
    }

    // Memory limits diff
    if (JSON.stringify(config.memoryLimits) !== JSON.stringify(original.memoryLimits)) {
      partial.memoryLimits = config.memoryLimits;
    }

    // OpenSpec poll diff
    if (JSON.stringify(config.openspec) !== JSON.stringify(original.openspec)) {
      partial.openspec = config.openspec ?? DEFAULT_OPENSPEC_UI;
    }

    // Editor config diff
    if (JSON.stringify(config.editor) !== JSON.stringify(original.editor)) {
      partial.editor = config.editor || null;
    }

    // Auth diff
    if (JSON.stringify(config.auth) !== JSON.stringify(original.auth)) {
      partial.auth = config.auth || null;
    }

    // Check if LLM providers changed
    const llmChanged = JSON.stringify(llmProviders) !== JSON.stringify(originalLlmProviders);

    if (Object.keys(partial).length === 0 && !llmChanged) {
      setMessage({ type: "warn", text: "No changes to save" });
      setSaving(false);
      return;
    }

    try {
      let restartRequired = false;

      // Save config changes
      if (Object.keys(partial).length > 0) {
        const res = await fetch(`${getApiBase()}/api/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });
        const data = await res.json();
        if (!data.success) {
          setMessage({ type: "error", text: data.error || "Failed to save config" });
          setSaving(false);
          return;
        }
        restartRequired = data.restartRequired;
        setOriginal(JSON.parse(JSON.stringify(config)));
      }

      // Save LLM providers
      if (llmChanged) {
        const validProviders = llmProviders.filter((p) => p.name.trim() !== "");
        const providersObj: Record<string, any> = {};
        for (const p of validProviders) {
          providersObj[p.name] = {
            baseUrl: p.baseUrl,
            apiKey: p.apiKey,
            api: p.api,
          };
        }
        const res = await fetch(`${getApiBase()}/api/providers`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: providersObj }),
        });
        const data = await res.json();
        if (!data.success) {
          setMessage({ type: "error", text: data.error || "Failed to save providers" });
          setSaving(false);
          return;
        }
        // Update state: strip isNew flag, update original
        const saved = validProviders.map(({ isNew, ...rest }) => rest);
        setLlmProviders(saved);
        setOriginalLlmProviders(JSON.parse(JSON.stringify(saved)));
      }

      if (restartRequired) {
        setMessage({ type: "warn", text: "Saved. Some changes require a server restart to take effect." });
      } else {
        setMessage({ type: "success", text: "Settings saved" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }, [config, original, llmProviders, originalLlmProviders]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        Loading settings...
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400">
        Failed to load settings
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

  const tabs = [
    { id: "general", label: "General" },
    { id: "servers", label: "Servers" },
    { id: "packages", label: "Packages" },
    { id: "plugins", label: "Plugins" },
    { id: "providers", label: "Providers" },
    { id: "security", label: "Security" },
    { id: "advanced", label: "Advanced" },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Header */}
      <div data-testid="settings-header" className="flex items-center gap-3 p-4 border-b border-[var(--border-primary)] shrink-0">
        <button
          onClick={() => navigate("/")}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title="Back"
        >
          <Icon path={mdiArrowLeft} size={0.8} />
        </button>
        <h1 className="text-lg font-bold text-[var(--text-primary)]">Settings</h1>
        <div className="flex-1" />
        <button
          onClick={async () => {
            setRestarting(true);
            setMessage(null);
            try {
              const res = await fetch(`${getApiBase()}/api/restart`, { method: "POST" });
              const data = await res.json();
              if (data.ok) {
                setMessage({ type: "success", text: "Server restarting…" });
                setTimeout(() => navigate("/"), 1500);
              } else {
                setMessage({ type: "error", text: data.error || "Restart failed" });
                setRestarting(false);
              }
            } catch {
              // fetch fails when server exits — that's expected
              setMessage({ type: "success", text: "Server restarting…" });
              setTimeout(() => navigate("/"), 1500);
            }
          }}
          disabled={restarting || saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm font-medium disabled:opacity-50 border border-[var(--border-secondary)]"
          title="Restart server"
        >
          <Icon path={mdiRestart} size={0.6} />
          {restarting ? "Restarting…" : "Restart"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || restarting || spawnTimeoutInvalid}
          data-testid="save-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50"
        >
          <Icon path={mdiContentSave} size={0.6} />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Tab Bar */}
      <div data-testid="settings-tab-bar" className="flex gap-0 border-b border-[var(--border-primary)] shrink-0 px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer ${
              activeTab === tab.id
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
            )}
          </button>
        ))}
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

      {/* Tab Content */}
      <div data-testid="settings-content" className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-6 max-w-2xl">

          {/* General Tab */}
          {activeTab === "general" && (
            <>
              <Section title="Server">
                <NumberField label="HTTP Port" value={config.port} onChange={(v) => update((c) => { c.port = v; })} />
                <NumberField label="Pi Gateway Port" value={config.piPort} onChange={(v) => update((c) => { c.piPort = v; })} />
                <ToggleField label="Auto Shutdown" value={config.autoShutdown} onChange={(v) => update((c) => { c.autoShutdown = v; })} />
                {config.autoShutdown && (
                  <NumberField label="Idle Seconds Before Shutdown" value={config.shutdownIdleSeconds} onChange={(v) => update((c) => { c.shutdownIdleSeconds = v; })} />
                )}
              </Section>

              <Section title="Sessions">
                <SelectField
                  label="Spawn Strategy"
                  value={config.spawnStrategy}
                  options={[{ value: "headless", label: "Headless" }, { value: "tmux", label: "Tmux" }]}
                  onChange={(v) => update((c) => { c.spawnStrategy = v; })}
                />
                <div>
                  <SelectField
                    label="Reattach Placement"
                    value={config.reattachPlacement ?? "always"}
                    options={[
                      { value: "always", label: "Always move to top (default)" },
                      { value: "streaming-only", label: "Only when streaming" },
                      { value: "preserve", label: "Preserve drag order" },
                    ]}
                    onChange={(v) => update((c) => { c.reattachPlacement = v as "preserve" | "streaming-only" | "always"; })}
                  />
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    When the dashboard restarts and a still-alive pi session reconnects, choose where its card goes in the folder list.
                  </p>
                </div>
                <div>
                  <NumberField
                    label="ask_user Prompt Timeout (seconds)"
                    value={config.askUserPromptTimeoutSeconds ?? 300}
                    onChange={(v) => update((c) => { c.askUserPromptTimeoutSeconds = v; })}
                  />
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    How long an interactive ask_user prompt waits for an answer before auto-cancelling. Use <code>-1</code> (or <code>0</code>) to wait forever. Default: 300 (5&nbsp;min).
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-[var(--text-secondary)]">Spawn register timeout (ms)</label>
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
                    <p className="mt-1 text-xs text-red-400">Must be an integer between 5000 and 120000.</p>
                  )}
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    How long to wait for a spawned pi session to connect before showing a warning. Default 30000 (30s). Range 5000–120000.
                  </p>
                </div>
                <div>
                  <ToggleField
                    label="Show worktree spawn buttons in folders and OpenSpec rows"
                    value={config.gitWorktreeEnabled ?? true}
                    onChange={(v) => update((c) => { c.gitWorktreeEnabled = v; })}
                  />
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    UI preference only. Hides the folder <code>+Worktree</code> button and the per-change <code>⥂2+</code> button on OpenSpec rows. The <code>/api/git/worktree*</code> REST endpoints stay reachable for tooling. Default on.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm text-[var(--text-secondary)]">Default Model</label>
                  <ModelSelector
                    current={config.defaultModel || undefined}
                    models={availableModels}
                    onSelect={(v) => update((c) => { c.defaultModel = v; })}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-[var(--text-secondary)]">PWA Display Name</label>
                    <input
                      type="text"
                      className="w-56 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
                      placeholder="(auto from hostname)"
                      value={config.dashboardName ?? ""}
                      onChange={(e) => update((c) => { c.dashboardName = e.target.value; })}
                    />
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    Shown on the home screen / app drawer when the dashboard is installed as a PWA. Leave blank to auto-derive from the request <code>Host</code> header (or the server hostname). Distinguishes installs from multiple machines or tunnels.
                  </p>
                </div>
              </Section>

              <Section title="Tunnel">
                <ToggleField label="Enable Zrok Tunnel" value={config.tunnel.enabled} onChange={(v) => update((c) => { c.tunnel.enabled = v; })} />
                <div className="mt-3 pt-3 border-t border-[var(--border-secondary)] space-y-2">
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Watchdog probes the public tunnel URL periodically and recycles the tunnel after consecutive failures (e.g. zrok edge returning 502).
                  </p>
                  <ToggleField
                    label="Enable Watchdog"
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
                    label="Probe Interval (seconds)"
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
                    label="Failure Threshold"
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
                    label="Probe Timeout (seconds)"
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

              <Section title="Developer">
                <ToggleField label="Dev Build on Reload" value={config.devBuildOnReload} onChange={(v) => update((c) => { c.devBuildOnReload = v; })} />
              </Section>

              <DiagnosticsSection />
              <ToolsSection />
              <SpawnFailuresSection />
              {/* Plugin-contributed settings consolidated under Settings ▸ Plugins.
                  Legacy `claim.tab` rendering removed.
                  See change: add-plugin-activation-ui (settings-consolidation). */}
            </>
          )}

          {/* Servers Tab */}
          {activeTab === "servers" && (
            <>
              <ServersTab />
              {/* Plugin-contributed settings consolidated under Settings ▸ Plugins. */}
            </>
          )}

          {/* Providers Tab */}
          {activeTab === "providers" && (
            <>
              <Section title="Provider Authentication">
                <ProviderAuthSection />
              </Section>

              <Section title="LLM Providers">
                <p className="text-xs text-[var(--text-tertiary)] mb-3">
                  Register custom OpenAI-compatible API endpoints for model access.
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
                  Add Provider
                </button>
              </Section>
              <Section title="API Proxy">
                <ModelProxySection
                  config={config.modelProxy ?? {}}
                  onChange={(patch) => update((c) => { c.modelProxy = { ...c.modelProxy, ...patch }; })}
                  upstreamExtensionDetected={upstreamPiModelProxyInstalled}
                />
              </Section>
              {/* Plugin-contributed settings consolidated under Settings ▸ Plugins. */}
            </>
          )}

          {/* Security Tab */}
          {activeTab === "security" && (
            <>
              <Section title="Authentication">
                <p className="text-xs text-[var(--text-tertiary)] mb-3">
                  Configure OAuth providers to protect external (tunnel) access. Localhost is always open.
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
                    Allowed Users <span className="text-[var(--text-tertiary)]">(one per line: username, email, or *@domain)</span>
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
                    Bypass URL Prefixes <span className="text-[var(--text-tertiary)]">(one per line — requests to these paths skip auth)</span>
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
              {/* Plugin-contributed settings consolidated under Settings ▸ Plugins. */}
            </>
          )}

          {/* Advanced Tab */}
          {activeTab === "packages" && (
            <div className="space-y-6">
              <UnifiedPackagesSection />
              <GlobalPackagesBrowseAndDialogs />
            </div>
          )}

          {activeTab === "plugins" && (
            /* Plugins activation list — see change: add-plugin-activation-ui. */
            <PluginsSection />
          )}

          {activeTab === "advanced" && (
            <>
              <Section title="Chat Display">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">
                  Controls what is shown in the chat message stream.
                </p>
                <DebugToolsToggle />
              </Section>
              <Section title="Memory Limits">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">
                  Controls for bounding server memory usage. Set to 0 to disable a limit.
                  Requires server restart.
                </p>
                <NumberField
                  label="Max Events Per Session"
                  value={config.memoryLimits?.maxEventsPerSession ?? 200}
                  onChange={(v) => update((c) => {
                    if (!c.memoryLimits) c.memoryLimits = { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 };
                    c.memoryLimits.maxEventsPerSession = v;
                  })}
                />
                <NumberField
                  label="Max String Truncation (chars)"
                  value={config.memoryLimits?.maxStringFieldSize ?? 4000}
                  onChange={(v) => update((c) => {
                    if (!c.memoryLimits) c.memoryLimits = { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 };
                    c.memoryLimits.maxStringFieldSize = v;
                  })}
                />
                <NumberField
                  label="Max WebSocket Buffer (bytes)"
                  value={config.memoryLimits?.maxWsBufferBytes ?? 4194304}
                  onChange={(v) => update((c) => {
                    if (!c.memoryLimits) c.memoryLimits = { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 };
                    c.memoryLimits.maxWsBufferBytes = v;
                  })}
                />
              </Section>
              <Section title="Background polling (OpenSpec)">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">
                  Controls how aggressively the server polls <code>openspec list</code> and <code>openspec status</code> for each known directory. Longer interval → less CPU, slightly staler UI. Lower concurrency → smoother curve. Change detection <code>mtime</code> skips re-polling unchanged proposals (recommended).
                </p>
                <ToggleField
                  label="Enable OpenSpec"
                  value={config.openspec?.enabled ?? DEFAULT_OPENSPEC_UI.enabled}
                  onChange={(v) => update((c) => {
                    if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                    c.openspec.enabled = v;
                  })}
                />
                <p className="text-xs text-[var(--text-tertiary)] mb-2">
                  When off, OpenSpec is fully disabled: no polling, no OPENSPEC subcards on session cards. Tuning values below remain but are ignored.
                </p>
                {(() => {
                  const openspecOff = (config.openspec?.enabled ?? DEFAULT_OPENSPEC_UI.enabled) === false;
                  return (
                    <>
                      <NumberField
                        label="Poll Interval (seconds, 5–3600)"
                        disabled={openspecOff}
                        value={config.openspec?.pollIntervalSeconds ?? DEFAULT_OPENSPEC_UI.pollIntervalSeconds}
                        onChange={(v) => update((c) => {
                          if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                          c.openspec.pollIntervalSeconds = v;
                        })}
                      />
                      <NumberField
                        label="Max Concurrent Spawns (1–16)"
                        disabled={openspecOff}
                        value={config.openspec?.maxConcurrentSpawns ?? DEFAULT_OPENSPEC_UI.maxConcurrentSpawns}
                        onChange={(v) => update((c) => {
                          if (!c.openspec) c.openspec = { ...DEFAULT_OPENSPEC_UI };
                          c.openspec.maxConcurrentSpawns = v;
                        })}
                      />
                      <SelectField
                        label="Change Detection"
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
                        label="Jitter (seconds, 0–60)"
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
              <Section title="Editor (code-server)">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">
                  Configure the embedded VS Code editor powered by code-server.
                </p>
                <TextField
                  label="Binary Path (leave empty for auto-detect)"
                  value={config.editor?.binary ?? ""}
                  onChange={(v) => update((c) => {
                    if (!c.editor) c.editor = {};
                    c.editor.binary = v || undefined;
                  })}
                  placeholder="code-server"
                />
                <NumberField
                  label="Idle Timeout (minutes)"
                  value={config.editor?.idleTimeoutMinutes ?? 10}
                  onChange={(v) => update((c) => {
                    if (!c.editor) c.editor = {};
                    c.editor.idleTimeoutMinutes = v;
                  })}
                />
                <NumberField
                  label="Max Concurrent Instances"
                  value={config.editor?.maxInstances ?? 3}
                  onChange={(v) => update((c) => {
                    if (!c.editor) c.editor = {};
                    c.editor.maxInstances = v;
                  })}
                />
              </Section>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DebugToolsToggle() {
  const [visible, setVisible] = useDebugToolsVisible();
  return (
    <ToggleField
      label="Show debug events (raw events, flow:list-flows, resources_discover)"
      value={visible}
      onChange={setVisible}
    />
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
    <Section title="Trusted Networks">
      <p className="text-xs text-[var(--text-tertiary)] mb-2">
        Devices matching these networks or hosts can access the dashboard without authentication.
        Accepts exact IP (<code>10.0.0.5</code>), wildcard (<code>10.0.0.*</code>), or CIDR (<code>192.168.1.0/24</code>).
      </p>

      {bypassHosts.length > 0 && (
        <div className="space-y-1 mb-2" data-testid="trusted-networks-list">
          {bypassHosts.map((net) => (
            <div key={net} className="flex items-center justify-between bg-[var(--bg-secondary)] rounded px-2 py-1">
              <span className="text-sm text-[var(--text-primary)] font-mono">{net}</span>
              <button
                onClick={() => removeNetwork(net)}
                className="text-red-400 hover:text-red-300 text-xs px-1 cursor-pointer"
                title="Remove"
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
            {loading ? "Detecting…" : "+ Add Local Network"}
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
          placeholder="IP, wildcard, or CIDR"
          className="flex-1 min-w-[160px] bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-xs font-mono text-[var(--text-primary)]"
          data-testid="trusted-networks-manual-input"
        />
        <button
          onClick={handleManualAdd}
          disabled={!manualEntry.trim()}
          className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="trusted-networks-manual-add"
        >
          Add
        </button>
      </div>

      {shouldShowLegacyHint(legacyTrustedNetworks) && (
        <p
          className="text-xs text-[var(--text-tertiary)] mt-2"
          data-testid="trusted-networks-legacy-hint"
        >
          {legacyTrustedNetworks.length} {legacyTrustedNetworks.length === 1 ? "entry" : "entries"} from <code>config.json</code> → <code>trustedNetworks</code>
          {" "}are also active. Edit them directly in that file.
        </p>
      )}

      <p className="text-xs text-amber-400/80 mt-2">
        ⚠ Anyone on a trusted network has full access to the dashboard without authentication. Only use on private networks you control.
      </p>
    </Section>
  );
}

function ServersTab() {
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
      <Section title="Known Servers">
        <KnownServersSection onChange={() => setLoadCount((c) => c + 1)} />
      </Section>
      <Section title="Network Discovery">
        <NetworkDiscoverySection
          knownServers={knownServers}
          onServerAdded={() => setLoadCount((c) => c + 1)}
        />
      </Section>
    </>
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
          {enabled ? "Remove" : "Enable"}
        </button>
      </div>
      {enabled && (
        <div className="space-y-2">
          <TextField
            label="Client ID"
            value={provider!.clientId}
            onChange={(v) => onChange({ ...provider!, clientId: v })}
          />
          <TextField
            label="Client Secret"
            value={provider!.clientSecret}
            onChange={(v) => onChange({ ...provider!, clientSecret: v })}
            type="password"
          />
          {needsIssuer && (
            <TextField
              label="Issuer URL"
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
      <Section title="Browse Packages">
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
            placeholder="Provider name"
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
                ? "Enter Base URL and API Key first"
                : "Ping the provider's /models endpoint"
            }
            className="text-xs px-2 py-0.5 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="test-provider-button"
          >
            {testState.kind === "testing" ? (
              <>
                <Icon path={mdiLoading} size={0.45} className="animate-spin" />
                Testing…
              </>
            ) : (
              <>
                <Icon path={mdiPlay} size={0.45} />
                Test
              </>
            )}
          </button>
          <button
            onClick={onRemove}
            className="text-xs px-2 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 flex items-center gap-1"
          >
            <Icon path={mdiDelete} size={0.45} />
            Remove
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <TextField
          label="Base URL"
          value={provider.baseUrl}
          onChange={(v) => handleChange({ ...provider, baseUrl: v })}
          placeholder="https://api.example.com/v1"
        />
        <TextField
          label="API Key"
          value={provider.apiKey}
          onChange={(v) => handleChange({ ...provider, apiKey: v })}
          type="password"
          placeholder="sk-... or $ENV_VAR_NAME"
        />
        <div>
          <label className="block text-xs text-[var(--text-tertiary)] mb-0.5">API Type</label>
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
  if (state.kind === "testing") {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
        data-testid="test-pill"
        data-state="testing"
      >
        <Icon path={mdiLoading} size={0.45} className="animate-spin" />
        Testing…
      </div>
    );
  }
  if (state.kind === "ok") {
    const label = state.modelCount > 0 ? `Connected · ${state.modelCount} models` : "Connected";
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
