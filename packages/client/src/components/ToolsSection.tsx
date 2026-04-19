/**
 * Tools settings section — inspect, override, and rescan every tool the
 * dashboard resolves (pi, pi-coding-agent, openspec, npm, node, git, …).
 *
 * Rendered inside the SettingsPanel General tab. Talks to /api/tools*.
 * See change: consolidate-tool-resolution (specs/tool-settings-ui).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import {
  mdiCheck, mdiClose, mdiAlert, mdiRefresh, mdiChevronDown, mdiChevronRight,
  mdiContentSaveEdit, mdiDownload, mdiBackspaceOutline,
} from "@mdi/js";
import type { Resolution } from "../lib/tools-api.js";
import {
  fetchTools,
  rescanAll,
  rescanOne,
  setOverride,
  clearOverride,
  downloadDiagnostics,
} from "../lib/tools-api.js";

export function ToolsSection() {
  const [tools, setTools] = useState<Resolution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [globalBusy, setGlobalBusy] = useState<"rescan" | "reset" | "export" | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setTools(await fetchTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onRescanOne = useCallback(async (name: string) => {
    setBusyName(name);
    try { setTools(await rescanOne(name)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyName(null); }
  }, []);

  const onRescanAll = useCallback(async () => {
    setGlobalBusy("rescan");
    try { setTools(await rescanAll()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setGlobalBusy(null); }
  }, []);

  const onResetOverrides = useCallback(async () => {
    const overridden = tools.filter((t) => t.source === "override" ||
      t.tried.some((x) => x.strategy === "override" && x.result.startsWith("invalid:")));
    if (overridden.length === 0) return;
    if (!window.confirm(`Clear ${overridden.length} override(s)?`)) return;
    setGlobalBusy("reset");
    try {
      for (const t of overridden) await clearOverride(t.name);
      setTools(await rescanAll());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGlobalBusy(null);
    }
  }, [tools]);

  const onExport = useCallback(async () => {
    setGlobalBusy("export");
    try { await downloadDiagnostics(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setGlobalBusy(null); }
  }, []);

  const onSetOverride = useCallback(async (name: string, path: string) => {
    setBusyName(name);
    try {
      await setOverride(name, path);
      setTools(await fetchTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  }, []);

  const onClearOverride = useCallback(async (name: string) => {
    setBusyName(name);
    try {
      await clearOverride(name);
      setTools(await fetchTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  }, []);

  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        Tools
      </h2>
      <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--text-secondary)]">
          External binaries and modules the dashboard resolves. Click a row to see the full resolution trail or set an override.
        </div>
        <div className="flex gap-1 flex-shrink-0 ml-2">
          <button
            onClick={onRescanAll}
            disabled={globalBusy !== null}
            className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
            title="Re-run every tool's strategy chain"
          >
            <Icon path={mdiRefresh} size={0.6} /> Rescan
          </button>
          <button
            onClick={onResetOverrides}
            disabled={globalBusy !== null}
            className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
            title="Clear every per-tool path override"
          >
            <Icon path={mdiBackspaceOutline} size={0.6} /> Reset
          </button>
          <button
            onClick={onExport}
            disabled={globalBusy !== null}
            className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
            title="Download a text file with every tool's resolution trail"
          >
            <Icon path={mdiDownload} size={0.6} /> Export
          </button>
        </div>
      </div>

      {loading && <div className="text-xs text-[var(--text-secondary)]">Loading tool resolutions…</div>}
      {error && (
        <div className="text-xs text-red-500 border border-red-500/40 rounded px-2 py-1">
          {error}
        </div>
      )}

      {!loading && tools.length > 0 && (
        <div className="divide-y divide-[var(--border-secondary)]">
          {tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              busy={busyName === t.name}
              onRescan={() => onRescanOne(t.name)}
              onSetOverride={(p) => onSetOverride(t.name, p)}
              onClearOverride={() => onClearOverride(t.name)}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

interface ToolRowProps {
  tool: Resolution;
  busy: boolean;
  onRescan: () => void;
  onSetOverride: (path: string) => void;
  onClearOverride: () => void;
}

function ToolRow({ tool, busy, onRescan, onSetOverride, onClearOverride }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftPath, setDraftPath] = useState("");

  const invalidOverride = tool.tried.some(
    (x) => x.strategy === "override" && typeof x.result === "string" && x.result.startsWith("invalid:"),
  );
  const hasOverride = tool.source === "override" || invalidOverride;

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <button
          className="flex-shrink-0 p-0.5 hover:bg-[var(--bg-hover)] rounded"
          onClick={() => setExpanded((x) => !x)}
          title={expanded ? "Collapse" : "Show resolution trail"}
        >
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.55} />
        </button>
        <StatusBadge tool={tool} invalidOverride={invalidOverride} />
        <span className="font-mono font-medium flex-shrink-0 w-32 truncate">{tool.name}</span>
        <span className="text-[var(--text-secondary)] flex-shrink-0 w-24 truncate">
          {tool.source ?? "—"}
        </span>
        <span className="font-mono text-[var(--text-secondary)] truncate flex-1" title={tool.path ?? "not found"}>
          {tool.path ?? "not found"}
        </span>
        <button
          onClick={onRescan}
          disabled={busy}
          className="flex-shrink-0 px-1.5 py-0.5 border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
          title="Re-run this tool's strategy chain"
        >
          <Icon path={mdiRefresh} size={0.55} />
        </button>
      </div>

      {expanded && (
        <div className="pl-8 pr-2 pt-2 space-y-2">
          {/* Trail */}
          <div className="text-[11px] font-mono space-y-0.5">
            {tool.tried.map((entry, i) => (
              <div key={i} className={entry.result === "ok" ? "text-green-500" : "text-[var(--text-secondary)]"}>
                <span className="inline-block w-20">{entry.strategy}</span>
                <span>{entry.result}</span>
              </div>
            ))}
          </div>

          {/* Override input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draftPath}
              onChange={(e) => setDraftPath(e.target.value)}
              placeholder={hasOverride ? "Current override in use" : "Set override path…"}
              className="flex-1 px-2 py-1 text-xs font-mono bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded"
            />
            <button
              onClick={() => { if (draftPath.trim()) { onSetOverride(draftPath.trim()); setDraftPath(""); } }}
              disabled={busy || !draftPath.trim()}
              className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
              title="Save override"
            >
              <Icon path={mdiContentSaveEdit} size={0.55} /> Save
            </button>
            {hasOverride && (
              <button
                onClick={onClearOverride}
                disabled={busy}
                className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
                title="Remove override"
              >
                <Icon path={mdiClose} size={0.55} /> Clear
              </button>
            )}
          </div>

          {invalidOverride && (
            <div className="text-[11px] text-amber-500 flex items-center gap-1">
              <Icon path={mdiAlert} size={0.5} />
              Override path didn't validate — fell through to the next strategy.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ tool, invalidOverride }: { tool: Resolution; invalidOverride: boolean }) {
  if (tool.ok && invalidOverride) {
    return (
      <span className="flex-shrink-0 text-amber-500" title="Override invalid; using fallback">
        <Icon path={mdiAlert} size={0.6} />
      </span>
    );
  }
  if (tool.ok) {
    return (
      <span className="flex-shrink-0 text-green-500" title={`Resolved via ${tool.source}`}>
        <Icon path={mdiCheck} size={0.6} />
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 text-red-500" title="Not found">
      <Icon path={mdiClose} size={0.6} />
    </span>
  );
}
