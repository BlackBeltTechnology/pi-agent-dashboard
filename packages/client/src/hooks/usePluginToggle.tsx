/**
 * Shared plugin list + enable/disable machinery.
 *
 * `usePluginList()` owns the `GET /api/plugins` fetch and the
 * `plugin-config-update` subscription. `usePluginToggle(list)` owns the toggle
 * path extracted verbatim from `PluginsSection.tsx`: cascade preview, the
 * confirm dialog, per-row toggling/error state, and the restart-required
 * banner state.
 *
 * Both the activation index (`PluginsSection`) and the per-plugin settings page
 * (`PluginSettingsPage`) consume these, so the toggle exists once (design D9).
 *
 * See change: plugin-settings-pages.
 */

import {
  buildGraph,
  computeToggleImpact,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LINK_BG, LINK_BG_HOVER, LINK_BORDER, LINK_FG } from "../components/packages/plugin-row-parts.js";
import { getApiBase } from "../lib/api/api-context.js";
import { t as i18nT } from "../lib/i18n/i18n.js";
import {
  listPlugins,
  type PluginRow,
  TogglePluginBlockedError,
  togglePlugin,
} from "../lib/package/plugins-api.js";

export interface PluginList {
  rows: PluginRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /**
   * Record the desired `enabled` for a plugin id. Called on a successful
   * toggle so the UI does not wait on the `plugin_config_update` round-trip
   * (and does not depend on a refetch that cannot see the flip).
   */
  setDesiredEnabled: (id: string, enabled: boolean) => void;
}

/**
 * Apply desired-state overrides onto fetched rows.
 *
 * `PluginStatus.enabled` from `GET /api/plugins` is the RUNTIME load state,
 * captured when the server booted — `POST /api/plugins/:id/toggle` writes
 * `config.plugins.<id>.enabled` and returns `restartRequired: true`, so neither
 * `/api/plugins` nor `/api/health` reflects the flip until a restart. The
 * authoritative desired state travels on the `plugin_config_update` broadcast
 * instead, which is what the toggle checkbox binds to and what the rail and the
 * page's disabled-notice key on (design D6).
 *
 * `loaded` is left untouched: it stays the runtime truth the restart-required
 * banner explains. Exported for the unit test.
 */
export function applyDesiredEnabled(
  rows: PluginRow[],
  desired: Record<string, boolean>,
): PluginRow[] {
  if (Object.keys(desired).length === 0) return rows;
  return rows.map((r) => {
    const want = desired[r.id];
    if (want === undefined || r.status?.enabled === want) return r;
    return { ...r, status: { ...r.status, enabled: want } as PluginRow["status"] };
  });
}

/**
 * Fetch the plugin list and keep it live across `plugin-config-update` events.
 * Every consumer that needs plugin rows (activation index, plugin settings
 * page, settings nav rail) mounts this.
 */
export function usePluginList(): PluginList {
  const [fetched, setFetched] = useState<PluginRow[]>([]);
  const [desiredEnabled, setDesiredEnabled] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listPlugins();
      setFetched(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Seed the desired state from the PERSISTED config so a disabled plugin
  // still reads as disabled after a reload (the in-memory overrides below only
  // cover the current document). `config.plugins.<id>.enabled` is exactly what
  // the toggle route writes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/config`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { plugins?: Record<string, { enabled?: boolean }> };
        };
        if (cancelled) return;
        const seeded: Record<string, boolean> = {};
        for (const [id, cfg] of Object.entries(body.data?.plugins ?? {})) {
          if (typeof cfg?.enabled === "boolean") seeded[id] = cfg.enabled;
        }
        if (Object.keys(seeded).length > 0) {
          // Live overrides win: they are newer than this fetch.
          setDesiredEnabled((prev) => ({ ...seeded, ...prev }));
        }
      } catch {
        /* network failure — fall back to the reported runtime state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdate = (e: Event) => {
      // The broadcast carries the config that was just written; record the
      // desired `enabled` before refetching, since the refetch cannot see it.
      const detail = (e as CustomEvent).detail as
        | { id?: string; config?: { enabled?: boolean } }
        | undefined;
      if (detail?.id && typeof detail.config?.enabled === "boolean") {
        const { id, config } = detail;
        setDesiredEnabled((prev) => ({ ...prev, [id]: config.enabled as boolean }));
      }
      void refresh();
    };
    window.addEventListener("plugin-config-update", onUpdate);
    return () => window.removeEventListener("plugin-config-update", onUpdate);
  }, [refresh]);

  const setDesired = useCallback((id: string, enabled: boolean) => {
    setDesiredEnabled((prev) => (prev[id] === enabled ? prev : { ...prev, [id]: enabled }));
  }, []);

  const rows = useMemo(
    () => applyDesiredEnabled(fetched, desiredEnabled),
    [fetched, desiredEnabled],
  );

  return { rows, loading, error, refresh, setDesiredEnabled: setDesired };
}

interface CascadePrompt {
  id: string;
  displayName: string;
  target: boolean;
  /** Other plugin ids this toggle would also flip. */
  cascade: string[];
}

export interface PluginToggle {
  /** True while a toggle request for this plugin id is in flight. */
  isToggling: (id: string) => boolean;
  /** Last toggle error for this plugin id, if any. */
  toggleErrorFor: (id: string) => string | undefined;
  handleToggle: (row: PluginRow, next: boolean) => Promise<void>;
  /** Cascade-confirm modal. Renders null when no confirm is pending. */
  CascadeDialog: () => React.ReactElement | null;
  restartRequired: boolean;
  restarting: boolean;
  handleRestart: () => Promise<void>;
}

export function usePluginToggle(list: PluginList): PluginToggle {
  const { rows, refresh, setDesiredEnabled } = list;
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [toggleErrors, setToggleErrors] = useState<Record<string, string | undefined>>({});
  const [serverStartedAt, setServerStartedAt] = useState<string | null>(null);
  const [pendingToggleStartedAt, setPendingToggleStartedAt] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [cascadePrompt, setCascadePrompt] = useState<CascadePrompt | null>(null);

  // Guards every async write below: `handleRestart` polls for up to 30s, so
  // without it a closed Settings panel keeps fetching and setting state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    async function refreshStartedAt() {
      try {
        const res = await fetch(`${getApiBase()}/api/health`);
        const body = await res.json();
        if (mounted.current && typeof body.startedAt === "string") {
          setServerStartedAt(body.startedAt);
        }
      } catch {
        /* keep previous */
      }
    }
    void refreshStartedAt();
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
    const cascade = next ? impact.cascadeEnable : impact.cascadeDisable;
    return { cascade, blockers: impact.blockers };
  }

  async function performToggle(row: PluginRow, next: boolean) {
    const id = row.id;
    setToggling((s) => ({ ...s, [id]: true }));
    setToggleErrors((s) => ({ ...s, [id]: undefined }));
    try {
      const result = await togglePlugin(id, next);
      if (serverStartedAt) setPendingToggleStartedAt(serverStartedAt);
      // The server persisted the flip but reports runtime state until a
      // restart, so record the desired state here; `result.cascade` names the
      // other ids the same write flipped.
      setDesiredEnabled(id, next);
      for (const other of result.cascade?.enable ?? []) setDesiredEnabled(other, true);
      for (const other of result.cascade?.disable ?? []) setDesiredEnabled(other, false);
      await refresh();
    } catch (e) {
      let msg: string;
      if (e instanceof TogglePluginBlockedError) {
        msg = `Cannot enable: missing dep(s) — ${e.blockers.join(", ")}`;
      } else {
        msg = e instanceof Error ? e.message : String(e);
      }
      setToggling((s) => ({ ...s, [id]: false }));
      setToggleErrors((s) => ({ ...s, [id]: msg }));
      return;
    }
    setToggling((s) => ({ ...s, [id]: false }));
    setToggleErrors((s) => ({ ...s, [id]: undefined }));
  }

  async function handleToggle(row: PluginRow, next: boolean) {
    const { cascade, blockers } = previewCascade(row, next);
    if (next && blockers.length > 0) {
      setToggling((s) => ({ ...s, [row.id]: false }));
      setToggleErrors((s) => ({
        ...s,
        [row.id]: `Cannot enable: missing dep(s) — ${blockers.join(", ")}`,
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
      // Stop the poll when the panel closed mid-restart.
      if (!mounted.current) return;
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
    if (mounted.current) setRestarting(false);
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

  return {
    isToggling: (id) => toggling[id] ?? false,
    toggleErrorFor: (id) => toggleErrors[id],
    handleToggle,
    CascadeDialog,
    restartRequired,
    restarting,
    handleRestart,
  };
}
