/**
 * KbSettingsPanel — per-folder KB path management (design §6b).
 *
 * Edits the v1 path fields only — `sources[]` (add / remove / reorder
 * priority), `include` / `exclude` globs, `dbPath` — and round-trips every
 * other KbConfig field untouched (the server preserves them). Shows the config
 * `origin` + live count. Worktrees with no project file get Create-config /
 * Copy-from-parent bootstrap affordances.
 *
 * See change: add-kb-folder-slot.
 */

import {
  mdiArrowDown,
  mdiArrowLeft,
  mdiArrowUp,
  mdiClose,
  mdiPlus,
  mdiRefresh,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { KbConfig, SourceConfig } from "../shared/kb-plugin-types.js";
import { fetchKbConfig } from "./kb-api.js";
import { useKbConfig } from "./useKbConfig.js";
import { useKbStats } from "./useKbStats.js";

/** Best-effort parent repo path for a worktree checked out under `.worktrees/`
 *  or `worktrees/`. Returns null when no such segment is present. */
export function parentRepoOf(cwd: string): string | null {
  const m = cwd.match(/^(.*)\/(?:\.worktrees|worktrees)\/[^/]+$/);
  return m ? m[1] : null;
}

interface EditState {
  sources: SourceConfig[];
  include: string[];
  exclude: string[];
  dbPath: string;
}

function seedFrom(config: KbConfig): EditState {
  return {
    sources: (config.sources ?? []).map((s) => ({ ...s })),
    include: [...(config.include ?? [])],
    exclude: [...(config.exclude ?? [])],
    dbPath: config.dbPath ?? "",
  };
}

/** Inline add-input + removable chips for a string[] (include / exclude). */
function ChipList({
  items,
  onChange,
  tone,
  testid,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  tone: "include" | "exclude";
  testid: string;
}): React.ReactElement {
  const [draft, setDraft] = useState("");
  const add = (): void => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  };
  const chip =
    tone === "exclude"
      ? "text-red-300 border-red-500/30 bg-red-500/5"
      : "text-indigo-300 border-indigo-500/30 bg-indigo-500/10";
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testid}>
      {items.map((it) => (
        <span key={it} className={`text-[11px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 ${chip}`}>
          {it}
          <button onClick={() => onChange(items.filter((x) => x !== it))} className="hover:text-white" title="Remove">
            <Icon path={mdiClose} size={0.4} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
        }}
        placeholder="add glob…"
        className="text-[11px] font-mono bg-transparent border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[var(--text-secondary)] w-28 focus:outline-none focus:border-indigo-500/60"
      />
    </div>
  );
}

export function KbSettingsPanel({ cwd, onBack }: { cwd: string; onBack: () => void }): React.ReactElement {
  const { data, loading, error, saving, save } = useKbConfig(cwd);
  const { stats, refetch: refetchStats } = useKbStats(cwd);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [newSource, setNewSource] = useState("");
  const [bootstrapErr, setBootstrapErr] = useState<string | null>(null);

  useEffect(() => {
    if (data?.config) setEdit(seedFrom(data.config));
  }, [data?.config]);

  const origin = data?.origin ?? "defaults";
  const isProject = origin === "project";
  const baseline = useMemo(() => (data?.config ? seedFrom(data.config) : null), [data?.config]);
  const dirty = useMemo(
    () => (edit && baseline ? JSON.stringify(edit) !== JSON.stringify(baseline) : false),
    [edit, baseline],
  );

  if (loading && !edit) {
    return <Shell cwd={cwd} onBack={onBack}><div className="p-4 text-xs text-[var(--text-muted)]">Loading KB config…</div></Shell>;
  }
  if (error && !edit) {
    return <Shell cwd={cwd} onBack={onBack}><div className="p-4 text-xs text-red-400">{error}</div></Shell>;
  }
  if (!edit) {
    return <Shell cwd={cwd} onBack={onBack}><div className="p-4 text-xs text-[var(--text-muted)]">No config.</div></Shell>;
  }

  const patch = () => ({
    sources: edit.sources,
    include: edit.include,
    exclude: edit.exclude,
    dbPath: edit.dbPath,
  });

  const addSource = (): void => {
    const ref = newSource.trim();
    if (!ref) return;
    if (edit.sources.some((s) => s.ref === ref)) { setNewSource(""); return; }
    setEdit({ ...edit, sources: [...edit.sources, { kind: "filesystem", ref, priority: 0 }] });
    setNewSource("");
  };
  const removeSource = (i: number): void =>
    setEdit({ ...edit, sources: edit.sources.filter((_, idx) => idx !== i) });
  const moveSource = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= edit.sources.length) return;
    const next = [...edit.sources];
    [next[i], next[j]] = [next[j], next[i]];
    setEdit({ ...edit, sources: next });
  };
  const setPriority = (i: number, priority: number): void =>
    setEdit({ ...edit, sources: edit.sources.map((s, idx) => (idx === i ? { ...s, priority } : s)) });

  const doSave = async (reindex: boolean): Promise<void> => {
    await save({ ...patch(), reindex });
    if (reindex) setTimeout(() => refetchStats(), 300);
  };

  const createProjectConfig = async (): Promise<void> => {
    setBootstrapErr(null);
    try {
      await save({ ...patch(), reindex: false });
    } catch (e) {
      setBootstrapErr(e instanceof Error ? e.message : String(e));
    }
  };

  const copyFromParent = async (): Promise<void> => {
    setBootstrapErr(null);
    const parent = parentRepoOf(cwd);
    if (!parent) { setBootstrapErr("Parent repo not detected (folder is not under a .worktrees/ path)."); return; }
    try {
      const parentCfg = await fetchKbConfig(parent);
      const next: EditState = {
        // Relative refs resolve against each cwd, so they carry over as-is; a
        // future rewrite would remap absolute refs. Sources come from parent.
        sources: (parentCfg.config.sources ?? []).map((s) => ({ ...s })),
        include: [...(parentCfg.config.include ?? edit.include)],
        exclude: [...(parentCfg.config.exclude ?? edit.exclude)],
        dbPath: edit.dbPath,
      };
      setEdit(next);
      await save({ sources: next.sources, include: next.include, exclude: next.exclude, dbPath: next.dbPath, reindex: true });
      setTimeout(() => refetchStats(), 300);
    } catch (e) {
      setBootstrapErr(e instanceof Error ? e.message : String(e));
    }
  };

  const countLabel = stats
    ? stats.indexed ? `${stats.chunks.toLocaleString()} chunks · ${stats.files} files` : "0 chunks · not indexed"
    : "…";

  return (
    <Shell cwd={cwd} onBack={onBack}>
      <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
        <span
          data-testid="kb-config-origin"
          className={`px-1.5 py-px rounded border text-[10px] uppercase tracking-wide ${
            isProject ? "text-green-400 border-green-500/40" : "text-amber-400 border-amber-500/40"
          }`}
        >
          {origin}
        </span>
        <span data-testid="kb-config-count">{countLabel}</span>
        {isProject && <code className="ml-auto text-[10px] text-[var(--text-muted)] truncate">{data?.projectPath}</code>}
      </div>

      {!isProject && (
        <div className="px-4 py-2 text-[12px] text-teal-400 border-b border-[var(--border-subtle)]" data-testid="kb-bootstrap-note">
          No project config — this folder indexes nothing until you define sources.
        </div>
      )}

      {/* Sources */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">Sources</div>
        <div data-testid="kb-sources">
          {edit.sources.length === 0 && (
            <div className="text-[11px] italic text-[var(--text-muted)] mb-2">(no sources — nothing will be indexed)</div>
          )}
          {edit.sources.map((s, i) => (
            <div key={`${s.ref}-${i}`} className="flex items-center gap-2 px-2 py-1.5 mb-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)]" data-testid="kb-source-row">
              <span className="flex-1 font-mono text-[12px] text-[var(--text-secondary)] truncate">{s.ref}</span>
              <label className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
                prio
                <input
                  type="number"
                  value={s.priority ?? 0}
                  onChange={(e) => setPriority(i, Number(e.target.value) || 0)}
                  className="w-12 bg-transparent border border-[var(--border-subtle)] rounded px-1 text-[var(--text-secondary)]"
                />
              </label>
              <button onClick={() => moveSource(i, -1)} disabled={i === 0} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30" title="Move up">
                <Icon path={mdiArrowUp} size={0.5} />
              </button>
              <button onClick={() => moveSource(i, 1)} disabled={i === edit.sources.length - 1} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30" title="Move down">
                <Icon path={mdiArrowDown} size={0.5} />
              </button>
              <button onClick={() => removeSource(i)} className="text-[var(--text-muted)] hover:text-red-400" title="Remove" data-testid="kb-source-remove">
                <Icon path={mdiClose} size={0.5} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <input
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSource(); } }}
            placeholder="path relative to folder, e.g. docs"
            data-testid="kb-source-input"
            className="flex-1 text-[12px] font-mono bg-transparent border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-secondary)] focus:outline-none focus:border-indigo-500/60"
          />
          <button onClick={addSource} data-testid="kb-source-add" className="text-[11px] px-2 py-1 rounded border text-indigo-400 border-indigo-500/40 bg-indigo-500/5 hover:border-indigo-500/70 flex items-center gap-1">
            <Icon path={mdiPlus} size={0.5} />Add path
          </button>
        </div>
      </div>

      {/* Include / Exclude / DB path */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">Include</div>
        <ChipList items={edit.include} onChange={(include) => setEdit({ ...edit, include })} tone="include" testid="kb-include" />
      </div>
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">Exclude</div>
        <ChipList items={edit.exclude} onChange={(exclude) => setEdit({ ...edit, exclude })} tone="exclude" testid="kb-exclude" />
      </div>
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">DB path</div>
        <input
          value={edit.dbPath}
          onChange={(e) => setEdit({ ...edit, dbPath: e.target.value })}
          data-testid="kb-dbpath"
          className="w-full text-[12px] font-mono bg-transparent border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-secondary)] focus:outline-none focus:border-indigo-500/60"
        />
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 flex items-center gap-2 bg-[var(--bg-secondary)]">
        {isProject ? (
          <>
            <button
              onClick={() => void doSave(true)}
              disabled={saving || !dirty}
              data-testid="kb-save-reindex"
              className="text-[12px] px-3 py-1.5 rounded border font-semibold text-indigo-300 border-indigo-500/60 bg-indigo-500/10 hover:border-indigo-400 disabled:opacity-40 flex items-center gap-1"
            >
              <Icon path={mdiRefresh} size={0.5} />Save + Reindex
            </button>
            <button
              onClick={() => void doSave(false)}
              disabled={saving || !dirty}
              data-testid="kb-save"
              className="text-[12px] px-3 py-1.5 rounded border text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              Save
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => void copyFromParent()}
              disabled={saving}
              data-testid="kb-copy-parent"
              className="text-[12px] px-3 py-1.5 rounded border text-teal-300 border-teal-500/50 bg-teal-500/5 hover:border-teal-400 disabled:opacity-40"
            >
              Copy from parent repo
            </button>
            <button
              onClick={() => void createProjectConfig()}
              disabled={saving}
              data-testid="kb-create-config"
              className="text-[12px] px-3 py-1.5 rounded border text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              Create project config
            </button>
          </>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-muted)]" data-testid="kb-dirty">
          {saving ? "saving…" : dirty ? "unsaved changes" : "no changes"}
        </span>
      </div>

      {(error || bootstrapErr) && (
        <div className="px-4 py-2 text-[11px] text-red-400" data-testid="kb-settings-error">{bootstrapErr ?? error}</div>
      )}
    </Shell>
  );
}

function Shell({ cwd, onBack, children }: { cwd: string; onBack: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col h-full overflow-y-auto" data-testid="kb-settings-page">
      <div className="px-4 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center gap-2 flex-shrink-0 sticky top-0 z-10">
        <button onClick={onBack} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title="Back" data-testid="kb-settings-back">
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
          {cwd.split("/").pop() || cwd} · Knowledge Base
        </span>
      </div>
      {children}
    </div>
  );
}
