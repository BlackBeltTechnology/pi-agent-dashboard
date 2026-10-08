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

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { isAbsolutePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import {
  mdiArrowDown,
  mdiArrowLeft,
  mdiArrowUp,
  mdiClose,
  mdiDatabaseRefreshOutline,
  mdiRefresh,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KbConfig, KbSourceStatus, SourceConfig } from "../shared/kb-plugin-types.js";
import { KbSourceAdd } from "./KbSourceAdd.js";
import { KbTestSearch } from "./KbTestSearch.js";
import { KbTrustDialog } from "./KbTrustDialog.js";
import { fetchKbConfig, grantSourceTrust } from "./kb-api.js";
import { isOutside, isRemoteKind } from "./source-ref.js";
import { useKbConfig } from "./useKbConfig.js";
import { useKbSources } from "./useKbSources.js";
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
  /** Refs of remote sources the user consented to trust in the NEXT save (`trustRefs`). */
  pendingTrust: string[];
}

/** A trust prompt: a freshly added remote spec, or an already-saved untrusted row. */
interface TrustPrompt {
  spec: SourceConfig;
  mode: "add" | "existing";
}

function seedFrom(config: KbConfig): EditState {
  return {
    sources: (config.sources ?? []).map((s) => ({ ...s })),
    include: [...(config.include ?? [])],
    exclude: [...(config.exclude ?? [])],
    dbPath: config.dbPath ?? "",
    pendingTrust: [],
  };
}

/** Compact status badges for one source row (kind, files, outside, trust, outcome). */
function SourceBadges({ spec, status, cwd, onTrust }: { spec: SourceConfig; status?: KbSourceStatus; cwd: string; onTrust: () => void }): React.ReactElement {
  const t = useT();
  const kind = status?.kind ?? spec.kind ?? "filesystem";
  const outside = status?.outside ?? (kind === "filesystem" && isAbsolutePath(spec.ref) && isOutside(cwd, spec.ref));
  const chip = "text-[10px] px-1.5 py-px rounded border";
  return (
    <span className="flex items-center gap-1 shrink-0" data-testid="kb-source-badges">
      <span className={`${chip} border-[var(--border-subtle)] text-[var(--text-tertiary)]`} data-testid="kb-source-kind">{kind}</span>
      {outside && (
        <span className={`${chip} border-amber-500/40 text-amber-400`} data-testid="kb-source-outside">{t("outsideFolder", undefined, "outside folder")}</span>
      )}
      {status && (
        <span className={`${chip} border-[var(--border-subtle)] text-[var(--text-muted)]`} data-testid="kb-source-files">
          {t("filesCount", { count: status.files }, `${status.files} files`)}
        </span>
      )}
      {status?.revision && <span className={`${chip} border-[var(--border-subtle)] text-[var(--text-muted)] font-mono`} data-testid="kb-source-revision">{status.revision}</span>}
      {status?.trusted === true && <span className={`${chip} border-green-500/40 text-green-400`} data-testid="kb-source-trusted">{t("trusted", undefined, "trusted")}</span>}
      {status?.trusted === false && (
        <>
          <span className={`${chip} border-amber-500/40 text-amber-400`} data-testid="kb-source-untrusted">⚠ {t("notTrusted", undefined, "not trusted")}</span>
          <button type="button" onClick={onTrust} className={`${chip} border-indigo-500/40 text-indigo-300 hover:border-indigo-400`} data-testid="kb-source-trust">{t("trustAction", undefined, "Trust…")}</button>
        </>
      )}
      {status?.lastStatus === "error" && (
        <span className={`${chip} border-red-500/40 text-red-400`} title={status.lastError} data-testid="kb-source-error">{t("failed", undefined, "failed")}</span>
      )}
    </span>
  );
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
  const t = useT();
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
          <button onClick={() => onChange(items.filter((x) => x !== it))} className="hover:text-white" title={t("remove", undefined, "Remove")}>
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
        placeholder={t("addGlobPlaceholder", undefined, "add glob…")}
        className="text-[11px] font-mono bg-transparent border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[var(--text-secondary)] w-28 focus:outline-none focus:border-indigo-500/60"
      />
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the branches mirror the spec'd state partition (footer actions per origin, notice variants keyed on canIndex, four-channel error precedence) — extracting them would scatter that mapping. See change: fix-kb-settings-reindex-gate.
export function KbSettingsPanel({ cwd, onBack }: { cwd: string; onBack: () => void }): React.ReactElement {
  const t = useT();
  const { data, loading, error, saving, save } = useKbConfig(cwd);
  // `error` is already bound from useKbConfig above, so the stats poll-outage
  // channel binds as `statsError`. See change: fix-kb-settings-reindex-gate.
  const { stats, loading: statsLoading, refetch: refetchStats, reindex, pending, reindexError, error: statsError } = useKbStats(cwd);
  const [edit, setEdit] = useState<EditState | null>(null);
  const { sources: sourceStatus, refetch: refetchSources } = useKbSources(cwd);
  const [trustPrompt, setTrustPrompt] = useState<TrustPrompt | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);
  const [trustError, setTrustError] = useState<string | null>(null);
  const [untrustedNote, setUntrustedNote] = useState<string | null>(null);
  const [bootstrapErr, setBootstrapErr] = useState<string | null>(null);

  useEffect(() => {
    if (data?.config) setEdit(seedFrom(data.config));
  }, [data?.config]);

  // Refresh per-source status when a reindex job settles (running → idle) — never on a timer.
  const wasIndexing = useRef(false);
  useEffect(() => {
    const now = stats?.indexing === true;
    if (wasIndexing.current && !now) refetchSources();
    wasIndexing.current = now;
  }, [stats?.indexing, refetchSources]);

  const origin = data?.origin ?? "defaults";
  const isProject = origin === "project";
  const baseline = useMemo(() => (data?.config ? seedFrom(data.config) : null), [data?.config]);
  const dirty = useMemo(
    () => (edit && baseline ? JSON.stringify(edit) !== JSON.stringify(baseline) : false),
    [edit, baseline],
  );
  // The reindex job walks cfg.allSourceSpecs (every saved spec, any kind) loaded
  // FROM DISK, so that is what the gate reads — never the form's (possibly
  // unsaved) source list, and not the config origin. See change:
  // fix-kb-settings-reindex-gate (design D1), improve-kb-settings-sources-and-search (D9).
  // `statsLoading` keeps the action disabled through the stats hand-offs (initial
  // mount and the post-save refetch): an unobserved in-flight job must not
  // invite a redundant POST (CodeRabbit, PR #568). The poll-outage settled
  // state (statsLoading=false, stats=null) stays enabled — X4's settled observable.
  const busy = pending || statsLoading || stats?.indexing === true;
  const canIndex = (data?.config.allSourceSpecs?.length ?? 0) > 0;

  if (loading && !edit) {
    return <Shell cwd={cwd} onBack={onBack}><div className="p-4 text-xs text-[var(--text-muted)]">{t("loadingConfig", undefined, "Loading KB config…")}</div></Shell>;
  }
  if (error && !edit) {
    return <Shell cwd={cwd} onBack={onBack}><div className="p-4 text-xs text-red-400">{error}</div></Shell>;
  }
  if (!edit) {
    return <Shell cwd={cwd} onBack={onBack}><div className="p-4 text-xs text-[var(--text-muted)]">{t("noConfig", undefined, "No config.")}</div></Shell>;
  }

  const patch = () => ({
    sources: edit.sources,
    include: edit.include,
    exclude: edit.exclude,
    dbPath: edit.dbPath,
    // Only refs still in the form can be granted; the server re-checks against the SAVED config.
    ...(edit.pendingTrust.length > 0 ? { trustRefs: edit.pendingTrust.filter((r) => edit.sources.some((s) => s.ref === r)) } : {}),
  });

  const appendSource = (spec: SourceConfig, trust: boolean): void =>
    setEdit({ ...edit, sources: [...edit.sources, spec], pendingTrust: trust ? [...edit.pendingTrust, spec.ref] : edit.pendingTrust });
  const addSource = (spec: SourceConfig): void => {
    if (isRemoteKind(spec.kind)) setTrustPrompt({ spec, mode: "add" });
    else appendSource(spec, false);
  };
  const confirmTrust = async (): Promise<void> => {
    if (!trustPrompt) return;
    if (trustPrompt.mode === "add") {
      appendSource(trustPrompt.spec, true);
      setTrustPrompt(null);
      return;
    }
    setTrustBusy(true);
    setTrustError(null);
    try {
      await grantSourceTrust(cwd, trustPrompt.spec.ref);
      setTrustPrompt(null);
      refetchSources();
    } catch (e) {
      setTrustError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrustBusy(false);
    }
  };
  const removeSource = (i: number): void =>
    setEdit({ ...edit, sources: edit.sources.filter((_, idx) => idx !== i), pendingTrust: edit.pendingTrust.filter((r) => r !== edit.sources[i].ref) });
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
    const res = await save({ ...patch(), reindex });
    // A requested grant the server could not make is reported, never assumed.
    setUntrustedNote(
      res?.untrustedRefs?.length
        ? t("untrustedNote", { refs: res.untrustedRefs.join(", ") }, `Not trusted (grant failed): ${res.untrustedRefs.join(", ")}`)
        : null,
    );
    refetchSources();
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
    if (!parent) { setBootstrapErr(t("parentNotDetected", undefined, "Parent repo not detected (folder is not under a .worktrees/ path).")); return; }
    try {
      const parentCfg = await fetchKbConfig(parent);
      const next: EditState = {
        // Relative refs resolve against each cwd, so they carry over as-is; a
        // future rewrite would remap absolute refs. Sources come from parent.
        sources: (parentCfg.config.sources ?? []).map((s) => ({ ...s })),
        include: [...(parentCfg.config.include ?? edit.include)],
        exclude: [...(parentCfg.config.exclude ?? edit.exclude)],
        dbPath: edit.dbPath,
        pendingTrust: [],
      };
      setEdit(next);
      await save({ sources: next.sources, include: next.include, exclude: next.exclude, dbPath: next.dbPath, reindex: true });
      setTimeout(() => refetchStats(), 300);
    } catch (e) {
      setBootstrapErr(e instanceof Error ? e.message : String(e));
    }
  };

  const countLabel = stats
    ? stats.indexed ? t("countChunksFiles", { chunks: stats.chunks.toLocaleString(), files: stats.files }, `${stats.chunks.toLocaleString()} chunks · ${stats.files} files`) : t("countNotIndexed", undefined, "0 chunks · not indexed")
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

      {!isProject && !canIndex && (
        <div className="px-4 py-2 text-[12px] text-teal-400 border-b border-[var(--border-subtle)]" data-testid="kb-bootstrap-note">
          {t("bootstrapNote", undefined, "No project config — this folder indexes nothing until you define sources.")}
        </div>
      )}

      {/* Sources */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">{t("sourcesHeading", undefined, "Sources")}</div>
        <div data-testid="kb-sources">
          {edit.sources.length === 0 && !canIndex && (
            <div className="text-[11px] italic text-[var(--text-muted)] mb-2">{t("noSourcesNothingIndexed", undefined, "(no sources — nothing will be indexed)")}</div>
          )}
          {edit.sources.length === 0 && canIndex && (
            <div className="text-[11px] italic text-[var(--text-muted)] mb-2">{t("noSourcesDefined", undefined, "(no sources defined)")}</div>
          )}
          {edit.sources.map((s, i) => (
            <div key={`${s.ref}-${i}`} className="flex items-center gap-2 px-2 py-1.5 mb-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)]" data-testid="kb-source-row">
              <span className="flex-1 font-mono text-[12px] text-[var(--text-secondary)] truncate" title={s.ref}>{s.ref}</span>
              <SourceBadges
                spec={s}
                status={sourceStatus.find((x) => x.ref === s.ref)}
                cwd={cwd}
                onTrust={() => { setTrustError(null); setTrustPrompt({ spec: s, mode: "existing" }); }}
              />
              <label className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
                {t("prio", undefined, "prio")}
                <input
                  type="number"
                  value={s.priority ?? 0}
                  onChange={(e) => setPriority(i, Number(e.target.value) || 0)}
                  className="w-12 bg-transparent border border-[var(--border-subtle)] rounded px-1 text-[var(--text-secondary)]"
                />
              </label>
              <button onClick={() => moveSource(i, -1)} disabled={i === 0} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30" title={t("moveUp", undefined, "Move up")}>
                <Icon path={mdiArrowUp} size={0.5} />
              </button>
              <button onClick={() => moveSource(i, 1)} disabled={i === edit.sources.length - 1} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30" title={t("moveDown", undefined, "Move down")}>
                <Icon path={mdiArrowDown} size={0.5} />
              </button>
              <button onClick={() => removeSource(i)} className="text-[var(--text-muted)] hover:text-red-400" title={t("remove", undefined, "Remove")} data-testid="kb-source-remove">
                <Icon path={mdiClose} size={0.5} />
              </button>
            </div>
          ))}
        </div>
        <KbSourceAdd cwd={cwd} existingRefs={edit.sources.map((x) => x.ref)} onAdd={addSource} />
        {untrustedNote && <div className="mt-1 text-[11px] text-amber-400" role="alert" data-testid="kb-untrusted-note">{untrustedNote}</div>}
      </div>

      {/* Include / Exclude / DB path */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">{t("includeHeading", undefined, "Include")}</div>
        <ChipList items={edit.include} onChange={(include) => setEdit({ ...edit, include })} tone="include" testid="kb-include" />
      </div>
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">{t("excludeHeading", undefined, "Exclude")}</div>
        <ChipList items={edit.exclude} onChange={(exclude) => setEdit({ ...edit, exclude })} tone="exclude" testid="kb-exclude" />
      </div>
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">{t("dbPathHeading", undefined, "DB path")}</div>
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
              <Icon path={mdiRefresh} size={0.5} />{t("saveReindex", undefined, "Save + Reindex")}
            </button>
            <button
              onClick={() => void doSave(false)}
              disabled={saving || !dirty}
              data-testid="kb-save"
              className="text-[12px] px-3 py-1.5 rounded border text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              {t("save", undefined, "Save")}
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
              {t("copyFromParent", undefined, "Copy from parent repo")}
            </button>
            <button
              onClick={() => void createProjectConfig()}
              disabled={saving}
              data-testid="kb-create-config"
              className="text-[12px] px-3 py-1.5 rounded border text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              {t("createConfig", undefined, "Create project config")}
            </button>
          </>
        )}
        {/* Standalone rebuild from the SAVED config — outside the isProject
            ternary so both footer branches carry it. Not gated on `dirty`: its
            contract is "rebuild what is on disk" (design D2). Same glyph as the
            folder menu item for the same verb (design D5). */}
        <button
          onClick={() => reindex()}
          disabled={saving || busy || !canIndex}
          data-testid="kb-reindex-now"
          className="text-[12px] px-3 py-1.5 rounded border text-indigo-300 border-indigo-500/40 bg-indigo-500/5 hover:border-indigo-400 disabled:opacity-40 flex items-center gap-1"
        >
          <Icon path={mdiDatabaseRefreshOutline} size={0.5} />{t("reindexNow", undefined, "Reindex now")}
        </button>
        {!canIndex && (
          <span className="text-[11px] text-[var(--text-muted)]" data-testid="kb-reindex-unavailable">
            {t("reindexNeedsSource", undefined, "Define at least one source to enable a rebuild.")}
          </span>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-muted)]" data-testid="kb-dirty">
          {saving ? t("saving", undefined, "saving…") : dirty ? t("unsavedChanges", undefined, "unsaved changes") : t("noChanges", undefined, "no changes")}
        </span>
      </div>

      {(bootstrapErr || reindexError || error || statsError) && (
        <div className="px-4 py-2 text-[11px] text-red-400" data-testid="kb-settings-error">
          {bootstrapErr ?? reindexError ?? error ?? statsError}
        </div>
      )}

      <KbTestSearch cwd={cwd} dirty={dirty} />

      {trustPrompt && (
        <KbTrustDialog
          spec={trustPrompt.spec}
          mode={trustPrompt.mode}
          busy={trustBusy}
          error={trustError}
          onTrust={() => void confirmTrust()}
          onAddWithoutTrust={() => { appendSource(trustPrompt.spec, false); setTrustPrompt(null); }}
          onCancel={() => setTrustPrompt(null)}
        />
      )}
    </Shell>
  );
}

function Shell({ cwd, onBack, children }: { cwd: string; onBack: () => void; children: React.ReactNode }): React.ReactElement {
  const t = useT();
  return (
    <div className="flex flex-col h-full overflow-y-auto" data-testid="kb-settings-page">
      <div className="px-4 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center gap-2 flex-shrink-0 sticky top-0 z-10">
        <button onClick={onBack} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title={t("back", undefined, "Back")} data-testid="kb-settings-back">
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
          {t("knowledgeBaseSuffix", { name: cwd.split("/").pop() || cwd }, `${cwd.split("/").pop() || cwd} · Knowledge Base`)}
        </span>
      </div>
      {children}
    </div>
  );
}
