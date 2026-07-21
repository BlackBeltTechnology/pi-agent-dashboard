/**
 * Settings ▸ Plugins tab — activation list.
 *
 * Renders every discovered plugin with: status pill, toggle, settings-cog
 * affordance, and (when expanded) the plugin's own `settings-section` claim
 * inline.
 *
 * Surfaces `missingRequirements` from PluginStatus with a one-click
 * `[Install]` button that reuses the existing package-operations install
 * pipeline when the missing requirement matches a `RECOMMENDED_EXTENSIONS.id`.
 *
 * Errors (e.g. failed-to-load plugins, id conflicts, bridge probe failures)
 * render their full message inline in a copy-on-click block beneath the row.
 *
 * Shows a Restart-required banner whenever a toggle has been issued since the
 * server's last `startedAt` (ISO timestamp from `/api/health`).
 *
 * See change: add-plugin-activation-ui.
 */

import {
  buildGraph,
  computeToggleImpact,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { RECOMMENDED_EXTENSIONS } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import {
  mdiAlert,
  mdiCheck,
  mdiClose,
  mdiCogOutline,
  mdiContentCopy,
  mdiPackageVariantClosed,
  mdiRestart,
} from "@mdi/js";
import Icon from "@mdi/react";
import { useEffect, useMemo, useState } from "react";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  listPlugins,
  type PluginRow,
  TogglePluginBlockedError,
  togglePlugin,
} from "../../lib/package/plugins-api.js";
import { PluginSettingsHost } from "./PluginSettingsHost.js";

interface RowState {
  expanded: boolean;
  toggling: boolean;
  toggleError?: string;
}

interface CascadePrompt {
  id: string;
  displayName: string;
  target: boolean;
  /** Other plugin ids this toggle would also flip. */
  cascade: string[];
}

// Theme-aware fragments built on the dashboard's `--accent-*` CSS vars
// (defined in packages/client/src/index.css for both dark and light :root).
// Uses the same `color-mix(in_srgb, var(--accent-X) NN%, transparent)` pattern
// the rest of the codebase uses (EditToolRenderer, DiffView, etc).
const WARN_FG = "text-[var(--accent-yellow)]";
const WARN_BG = "bg-[color-mix(in_srgb,var(--accent-yellow)_12%,transparent)]";
const WARN_BORDER = "border-[color-mix(in_srgb,var(--accent-yellow)_40%,transparent)]";
const ERR_FG = "text-[var(--accent-red)]";
const ERR_BG = "bg-[color-mix(in_srgb,var(--accent-red)_12%,transparent)]";
const ERR_BORDER = "border-[color-mix(in_srgb,var(--accent-red)_40%,transparent)]";
const OK_FG = "text-[var(--accent-green)]";
const OK_BG = "bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)]";
const OK_BORDER = "border-[color-mix(in_srgb,var(--accent-green)_40%,transparent)]";
const LINK_FG = "text-[var(--accent-blue)]";
const LINK_BG = "bg-[color-mix(in_srgb,var(--accent-blue)_12%,transparent)]";
const LINK_BG_HOVER = "hover:bg-[color-mix(in_srgb,var(--accent-blue)_22%,transparent)]";
const LINK_BORDER = "border-[color-mix(in_srgb,var(--accent-blue)_40%,transparent)]";

function StatusPill({ row }: { row: PluginRow }) {
  const status = row.status;
  if (!status) {
    return (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border border-[var(--border-secondary)]">
        unknown
      </span>
    );
  }
  if (status.error) {
    return (
      <span
        className={`px-1.5 py-0.5 text-[10px] rounded ${ERR_BG} ${ERR_FG} border ${ERR_BORDER}`}
        title={status.error}
      >
        error
      </span>
    );
  }
  if (!status.enabled) {
    return (
      <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-[var(--border-secondary)]">
        disabled
      </span>
    );
  }
  if (!status.loaded) {
    return (
      <span className={`px-1.5 py-0.5 text-[10px] rounded ${WARN_BG} ${WARN_FG} border ${WARN_BORDER}`}>
        {i18nT("common.notLoaded", undefined, "not loaded")}
      </span>
    );
  }
  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded ${OK_BG} ${OK_FG} border ${OK_BORDER}`}>
      enabled
    </span>
  );
}

function CopyableErrorBlock({ text, testId }: { text: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded ${ERR_BG} ${ERR_FG} border ${ERR_BORDER} text-xs`}
      data-testid={testId}
    >
      <Icon path={mdiAlert} size={0.6} className="shrink-0 mt-0.5" />
      <pre className="flex-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
        {text}
      </pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard denied — keep button visible */
          }
        }}
        title={i18nT("status.copyErrorToClipboard", undefined, "Copy error to clipboard")}
        className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${ERR_BORDER} hover:opacity-80`}
        data-testid={`${testId}-copy`}
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.45} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function MissingRequirementsBlock({ row }: { row: PluginRow }) {
  const missing = row.status?.missingRequirements ?? [];
  const operations = usePackageOperations("global");
  if (!missing.length) return null;

  const piExtMissing = row.status?.requirements?.piExtensions
    ?.filter((p) => !p.satisfied)
    .map((p) => p.name) ?? [];
  const binMissing = row.status?.requirements?.binaries
    ?.filter((p) => !p.satisfied)
    .map((p) => p.name) ?? [];
  const svcMissing = row.status?.requirements?.services
    ?.filter((p) => !p.satisfied)
    .map((p) => p.name) ?? [];

  function recommendedFor(name: string): { source: string } | null {
    const found = RECOMMENDED_EXTENSIONS.find((e) => e.id === name);
    return found ? { source: found.source } : null;
  }

  return (
    <div className="mt-2 space-y-1.5">
      {piExtMissing.map((name) => {
        const rec = recommendedFor(name);
        return (
          <div
            key={`pi:${name}`}
            className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
            data-testid={`missing-piExtension-${name}`}
          >
            <Icon path={mdiAlert} size={0.5} />
            <span>
              {i18nT("packages.requiresPiExtension", undefined, "requires pi extension")}{" "}
              <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                {name}
              </code>
            </span>
            {rec ? (
              <button
                type="button"
                onClick={() => operations.install(rec.source)}
                className={`px-2 py-0.5 rounded text-[10px] ${LINK_BG} ${LINK_BG_HOVER} ${LINK_FG} border ${LINK_BORDER}`}
                data-testid={`install-piExtension-${name}`}
              >
                {i18nT("common.install2", undefined, "Install")}
              </button>
            ) : (
              <a
                href="/settings/packages"
                className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
                data-testid={`install-piExtension-link-${name}`}
              >
                {i18nT("packages.installViaPackagesTab", undefined, "Install via Packages tab")}
              </a>
            )}
          </div>
        );
      })}
      {binMissing.map((name) => (
        <div
          key={`bin:${name}`}
          className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
          data-testid={`missing-binary-${name}`}
        >
          <Icon path={mdiAlert} size={0.5} />
          <span>
            {i18nT("common.requiresBinaryOnPath", undefined, "requires binary on PATH:")}{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
              {name}
            </code>
          </span>
        </div>
      ))}
      {svcMissing.map((name) => (
        <div
          key={`svc:${name}`}
          className={`flex items-center gap-2 text-[11px] ${WARN_FG}`}
          data-testid={`missing-service-${name}`}
        >
          <Icon path={mdiAlert} size={0.5} />
          <span>
            {i18nT("common.requiresService", undefined, "requires service:")}{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
              {name}
            </code>
          </span>
        </div>
      ))}
    </div>
  );
}

export function PluginsSection() {
  const [rows, setRows] = useState<PluginRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [serverStartedAt, setServerStartedAt] = useState<string | null>(null);
  const [pendingToggleStartedAt, setPendingToggleStartedAt] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [globalErrorCopied, setGlobalErrorCopied] = useState(false);

  async function refresh() {
    try {
      const list = await listPlugins();
      setRows(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshStartedAt() {
    try {
      const res = await fetch(`${getApiBase()}/api/health`);
      const body = await res.json();
      if (typeof body.startedAt === "string") setServerStartedAt(body.startedAt);
    } catch {
      /* keep previous */
    }
  }

  useEffect(() => {
    refresh();
    refreshStartedAt();
    const onUpdate = () => {
      void refresh();
    };
    window.addEventListener("plugin-config-update", onUpdate);
    return () => window.removeEventListener("plugin-config-update", onUpdate);
  }, []);

  const restartRequired = useMemo(() => {
    if (!pendingToggleStartedAt || !serverStartedAt) return false;
    return pendingToggleStartedAt === serverStartedAt;
  }, [pendingToggleStartedAt, serverStartedAt]);

  // Pre-toggle cascade preview. The route handler is authoritative; this is
  // purely for the confirm dialog UX so the user knows what else will flip.
  function previewCascade(row: PluginRow, next: boolean): {
    cascade: string[];
    blockers: string[];
  } {
    const graph = buildGraph(
      rows.map((r) => ({ id: r.id, dependsOn: r.dependsOn ?? [] })),
      (id) => rows.find((r) => r.id === id)?.status?.enabled !== false,
    );
    const impact = computeToggleImpact(graph, row.id, next);
    const cascade = next
      ? impact.cascadeEnable
      : impact.cascadeDisable;
    return { cascade, blockers: impact.blockers };
  }

  async function performToggle(row: PluginRow, next: boolean) {
    const id = row.id;
    setRowState((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { expanded: false }), toggling: true, toggleError: undefined },
    }));
    try {
      const result = await togglePlugin(id, next);
      if (serverStartedAt) setPendingToggleStartedAt(serverStartedAt);
      void result; // result.cascade ignored — refresh() picks up the new state
      await refresh();
    } catch (e) {
      let msg: string;
      if (e instanceof TogglePluginBlockedError) {
        msg = `Cannot enable: missing dep(s) — ${e.blockers.join(", ")}`;
      } else {
        msg = e instanceof Error ? e.message : String(e);
      }
      setRowState((s) => ({
        ...s,
        [id]: {
          ...(s[id] ?? { expanded: false }),
          toggling: false,
          toggleError: msg,
        },
      }));
      return;
    }
    setRowState((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { expanded: false }), toggling: false, toggleError: undefined },
    }));
  }

  const [cascadePrompt, setCascadePrompt] = useState<CascadePrompt | null>(null);

  async function handleToggle(row: PluginRow, next: boolean) {
    const { cascade, blockers } = previewCascade(row, next);
    if (next && blockers.length > 0) {
      setRowState((s) => ({
        ...s,
        [row.id]: {
          ...(s[row.id] ?? { expanded: false }),
          toggling: false,
          toggleError: `Cannot enable: missing dep(s) — ${blockers.join(", ")}`,
        },
      }));
      return;
    }
    if (cascade.length > 0) {
      setCascadePrompt({
        id: row.id,
        displayName: row.displayName,
        target: next,
        cascade,
      });
      return;
    }
    await performToggle(row, next);
  }

  function toggleExpanded(id: string) {
    setRowState((s) => ({
      ...s,
      [id]: { ...(s[id] ?? { toggling: false }), expanded: !(s[id]?.expanded ?? false) },
    }));
  }

  async function handleRestart() {
    setRestarting(true);
    try {
      await fetch(`${getApiBase()}/api/restart`, { method: "POST" });
    } catch {
      // expected: fetch fails when server exits
    }
    const start = Date.now();
    const wasStartedAt = serverStartedAt;
    while (Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(`${getApiBase()}/api/health`);
        if (!res.ok) continue;
        const body = await res.json();
        if (typeof body.startedAt === "string" && body.startedAt !== wasStartedAt) {
          setServerStartedAt(body.startedAt);
          setPendingToggleStartedAt(null);
          await refresh();
          break;
        }
      } catch {
        /* keep polling */
      }
    }
    setRestarting(false);
  }

  function CascadeDialog() {
    if (!cascadePrompt) return null;
    const c = cascadePrompt;
    const verb = c.target ? "enable" : "disable";
    const cascadeLabels = c.cascade.map(
      (id) => rows.find((r) => r.id === id)?.displayName ?? id,
    );
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)]"
        data-testid="plugins-cascade-dialog"
      >
        <div className="max-w-md w-full mx-4 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded shadow-lg">
          <div className="px-4 py-3 border-b border-[var(--border-secondary)] text-sm font-medium text-[var(--text-primary)]">
            {i18nT("git.cascadeRequired", undefined, "Cascade required")}
          </div>
          <div className="px-4 py-3 text-sm text-[var(--text-secondary)] space-y-2">
            <p>
              {c.target ? "Enabling" : "Disabling"}{" "}
              <strong>{c.displayName}</strong> {i18nT("common.willAlso", undefined, "will also")} {verb} {i18nT("packages.theFollowingPlugin", undefined, "the following\n              plugin")}{c.cascade.length > 1 ? "s" : ""}:
            </p>
            <ul className="list-disc pl-5 space-y-0.5 text-[var(--text-primary)]">
              {cascadeLabels.map((label, i) => (
                <li key={c.cascade[i]} className="text-xs">
                  {label}{" "}
                  <code className="text-[10px] text-[var(--text-muted)]">
                    {c.cascade[i]}
                  </code>
                </li>
              ))}
            </ul>
          </div>
          <div className="px-4 py-3 border-t border-[var(--border-secondary)] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCascadePrompt(null)}
              className="px-3 py-1 rounded text-xs bg-[var(--bg-tertiary)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
              data-testid="plugins-cascade-cancel"
            >
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button
              type="button"
              onClick={async () => {
                const row = rows.find((r) => r.id === c.id);
                setCascadePrompt(null);
                if (row) await performToggle(row, c.target);
              }}
              className={`px-3 py-1 rounded text-xs ${LINK_BG} ${LINK_BG_HOVER} ${LINK_FG} border ${LINK_BORDER}`}
              data-testid="plugins-cascade-confirm"
            >
              {c.target ? "Enable all" : "Disable all"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)]">{i18nT("packages.loadingPlugins", undefined, "Loading plugins…")}</div>;
  }
  if (error) {
    return (
      <div className="space-y-2" data-testid="plugins-section-error">
        <CopyableErrorBlock text={`Failed to load plugins: ${error}`} testId="plugins-load-error" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="plugins-section">
      <CascadeDialog />
      {restartRequired && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded ${WARN_BG} border ${WARN_BORDER} ${WARN_FG} text-sm`}
          data-testid="plugins-restart-required-banner"
        >
          <Icon path={mdiRestart} size={0.6} />
          <span className="flex-1">
            {i18nT("packages.pluginChangesTakeEffectAfterA", undefined, "Plugin changes take effect after a server restart.")}
          </span>
          <button
            type="button"
            onClick={handleRestart}
            disabled={restarting}
            className={`px-2 py-1 rounded text-xs ${WARN_BG} hover:opacity-80 ${WARN_FG} border ${WARN_BORDER} disabled:opacity-50`}
            data-testid="plugins-restart-now-btn"
          >
            {restarting ? "Restarting…" : "Restart now"}
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.length === 0 && (
          <div
            className="px-3 py-4 text-sm text-[var(--text-muted)] border border-dashed border-[var(--border-secondary)] rounded"
            data-testid="plugins-empty-state"
          >
            {i18nT("packages.noPluginsInstalled", undefined, "No plugins installed.")}
            <span className="block mt-1 text-[11px] text-[var(--text-tertiary)]">
              {i18nT("packages.pluginsAreDiscoveredFromTheMonorepo", undefined, "Plugins are discovered from the monorepo,")}{" "}
              <code>~/.pi/dashboard/plugins/</code>{i18nT("common.orTheBundledSet", undefined, ", or the bundled set.")}
            </span>
          </div>
        )}
        {rows.map((row) => {
          const state = rowState[row.id] ?? { expanded: false, toggling: false };
          const hasSettings = row.claims.some((c) => c.slot === "settings-section");
          const isEnabled = row.status?.enabled !== false;
          const statusError = row.status?.error;
          const expandTitle = hasSettings
            ? state.expanded
              ? "Hide plugin settings"
              : "Open plugin settings"
            : "No settings for this plugin";
          return (
            <div
              key={row.id}
              className="border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)]"
              data-testid={`plugin-row-${row.id}`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <Icon path={mdiPackageVariantClosed} size={0.6} className="text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] font-medium truncate">
                    {row.displayName}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] truncate">{row.id}</div>
                </div>
                <StatusPill row={row} />
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    disabled={state.toggling}
                    onChange={(e) => handleToggle(row, e.target.checked)}
                    data-testid={`plugin-toggle-${row.id}`}
                    className="accent-blue-500"
                  />
                  <span className="text-[10px] text-[var(--text-secondary)]">enable</span>
                </label>
                <button
                  type="button"
                  onClick={() => hasSettings && toggleExpanded(row.id)}
                  disabled={!hasSettings}
                  className={`p-1.5 rounded transition-colors ${
                    hasSettings
                      ? "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                      : "text-[var(--text-tertiary)] opacity-40 cursor-not-allowed"
                  } ${state.expanded ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : ""}`}
                  title={expandTitle}
                  data-testid={`plugin-expand-${row.id}`}
                  aria-pressed={state.expanded}
                  aria-label={expandTitle}
                >
                  <Icon path={mdiCogOutline} size={0.65} />
                </button>
              </div>
              {(row.dependsOn?.length ?? 0) > 0 || (row.dependents?.length ?? 0) > 0 ? (
                <div className="px-3 pb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {(row.dependsOn?.length ?? 0) > 0 && (
                    <>
                      <span className="text-[var(--text-muted)]">{i18nT("common.dependsOn", undefined, "depends on:")}</span>
                      {row.dependsOn!.map((d) => (
                        <code
                          key={`d-${d}`}
                          className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
                          data-testid={`plugin-depends-on-${row.id}-${d}`}
                        >
                          {d}
                        </code>
                      ))}
                    </>
                  )}
                  {(row.dependents?.length ?? 0) > 0 && (
                    <>
                      <span className="text-[var(--text-muted)] ml-2">{i18nT("common.requiredBy", undefined, "required by:")}</span>
                      {row.dependents!.map((d) => (
                        <code
                          key={`r-${d}`}
                          className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
                          data-testid={`plugin-required-by-${row.id}-${d}`}
                        >
                          {d}
                        </code>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
              {state.toggleError && (
                <div className="px-3 pb-2">
                  <CopyableErrorBlock
                    text={state.toggleError}
                    testId={`plugin-toggle-error-${row.id}`}
                  />
                </div>
              )}
              {statusError && (
                <div className="px-3 pb-2">
                  <CopyableErrorBlock
                    text={statusError}
                    testId={`plugin-status-error-${row.id}`}
                  />
                </div>
              )}
              <div className="px-3 pb-2">
                <MissingRequirementsBlock row={row} />
              </div>
              {state.expanded && hasSettings && (
                <div
                  className="border-t border-[var(--border-secondary)] px-3 py-3 bg-[var(--bg-primary)]"
                  data-testid={`plugin-settings-${row.id}`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] mb-2">
                    <Icon path={mdiCogOutline} size={0.5} />
                    {i18nT("packages.pluginSettings", undefined, "Plugin settings")}
                  </div>
                  <PluginSettingsHost pluginId={row.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
