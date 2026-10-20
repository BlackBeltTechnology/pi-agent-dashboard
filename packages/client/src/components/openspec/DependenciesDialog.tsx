import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  activeSignature,
  getArchiveCacheVersion,
  getArchiveState,
  requestArchive,
  subscribeArchiveCache,
} from "../../lib/openspec/archive-cache.js";
import {
  type DeclaredBlocker,
  type DeclaredDependencies,
  DependenciesApiError,
  type DependenciesGet,
  fetchDependencies,
  saveDependencies,
} from "../../lib/openspec/openspec-dependencies-api.js";

/**
 * Per-change dependencies editor. Edits only this change's `dependencies.yaml`:
 * the file's own declared lists (reasons preserved), inferred edges that can be
 * rejected ("Not a dependency"), `related`, and the read-only computed `blocks`
 * (links to the other change's dialog). An invalid file is replaced only after
 * an explicit confirmation; a stale write (409 `modified`) offers a reload and a
 * held lock (409 `locked`) offers a retry.
 *
 * See change: add-openspec-change-dependencies.
 */

const EMPTY: DeclaredDependencies = { blockedBy: [], notBlockedBy: [], related: [] };
const SECTION = "text-[12px] font-semibold text-[var(--text-secondary)]";
const ROW = "flex items-center gap-2 text-[12px] text-[var(--text-primary)]";
const SMALL_BTN =
  "focus-ring text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";

type Failure = { kind: "modified" | "locked" | "other"; message: string };

export function DependenciesDialog({
  cwd,
  change,
  activeNames,
  onClose,
  onOpenChange,
}: {
  cwd: string;
  change: string;
  /** Names offered by the blocker picker (active changes); archived ones come from the archive cache. */
  activeNames: string[];
  onClose: () => void;
  /** Open another change's dialog (the read-only `blocks` links). */
  onOpenChange?: (name: string) => void;
}) {
  const [loaded, setLoaded] = useState<DependenciesGet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DeclaredDependencies>(EMPTY);
  const [replaceInvalid, setReplaceInvalid] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState("");
  const [pickReason, setPickReason] = useState("");

  // Archived changes satisfy a blocker too, so the picker offers them.
  const sig = useMemo(() => activeSignature(activeNames), [activeNames]);
  useSyncExternalStore(subscribeArchiveCache, getArchiveCacheVersion, getArchiveCacheVersion);
  useEffect(() => {
    requestArchive(cwd, sig);
  }, [cwd, sig]);
  const archiveEntries = getArchiveState(cwd, sig).entries;
  const archivedNames = Array.isArray(archiveEntries) ? archiveEntries.map((e) => e.name.slice(e.date.length + 1)) : [];

  const load = useCallback(() => {
    setLoaded(null);
    setLoadError(null);
    setFailure(null);
    setReplaceInvalid(false);
    const ctrl = new AbortController();
    fetchDependencies(cwd, change, ctrl.signal)
      .then((g) => {
        setLoaded(g);
        setDraft(g.declared ? { blockedBy: [...g.declared.blockedBy], notBlockedBy: [...g.declared.notBlockedBy], related: [...g.declared.related] } : EMPTY);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [cwd, change]);

  useEffect(() => load(), [load]);

  const inferred = useMemo(
    () => (loaded?.dependencies?.blockedBy ?? []).filter((e) => e.source !== "declared" && !draft.notBlockedBy.includes(e.change)),
    [loaded, draft.notBlockedBy],
  );
  const pickable = useMemo(() => {
    const taken = new Set([change, ...draft.blockedBy.map((b) => b.change)]);
    return [...new Set([...activeNames, ...archivedNames])].filter((n) => !taken.has(n)).sort();
  }, [activeNames, archivedNames, change, draft.blockedBy]);

  const invalid = loaded?.declaredError != null;
  const canSave = loaded !== null && !saving && (!invalid || replaceInvalid);

  const save = async () => {
    if (!loaded) return;
    setSaving(true);
    setFailure(null);
    try {
      await saveDependencies({ cwd, change, ...draft, expected: loaded.file });
      onClose();
    } catch (err) {
      if (err instanceof DependenciesApiError && err.reason === "modified") setFailure({ kind: "modified", message: err.message });
      else if (err instanceof DependenciesApiError && err.reason === "locked") setFailure({ kind: "locked", message: err.message });
      else setFailure({ kind: "other", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const removeBlocker = (name: string) => setDraft((d) => ({ ...d, blockedBy: d.blockedBy.filter((b) => b.change !== name) }));
  const reject = (name: string) => setDraft((d) => ({ ...d, notBlockedBy: d.notBlockedBy.includes(name) ? d.notBlockedBy : [...d.notBlockedBy, name] }));
  const unreject = (name: string) => setDraft((d) => ({ ...d, notBlockedBy: d.notBlockedBy.filter((n) => n !== name) }));
  const removeRelated = (name: string) => setDraft((d) => ({ ...d, related: d.related.filter((n) => n !== name) }));
  const addBlocker = () => {
    if (!pick) return;
    const entry: DeclaredBlocker = pickReason.trim() ? { change: pick, reason: pickReason.trim() } : { change: pick };
    setDraft((d) => ({ ...d, blockedBy: [...d.blockedBy, entry] }));
    setPick("");
    setPickReason("");
  };

  return (
    <Dialog open onClose={onClose} title={i18nT("openspec.dependencies.dialogTitle", { name: change }, "Dependencies · {name}")} testId="deps-dialog">
      {loadError ? (
        <p role="alert" className="text-[12px] text-[var(--severity-error-fg)]" data-testid="deps-load-error">
          {loadError}
        </p>
      ) : !loaded ? (
        <p className="text-[12px] text-[var(--text-secondary)]">{i18nT("openspec.dependencies.loading", undefined, "Loading…")}</p>
      ) : (
        <div className="space-y-3">
          {invalid && (
            <div role="alert" className="rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] p-2 text-[12px] text-[var(--severity-warning-fg)]" data-testid="deps-invalid">
              <p>{i18nT("openspec.dependencies.invalidFile", { error: loaded.declaredError ?? "" }, "dependencies.yaml is invalid: {error}")}</p>
              <label className="mt-1 flex items-center gap-1.5">
                <input type="checkbox" checked={replaceInvalid} onChange={(e) => setReplaceInvalid(e.target.checked)} data-testid="deps-replace-confirm" />
                {i18nT("openspec.dependencies.replaceInvalid", undefined, "Replace the invalid file with my changes")}
              </label>
            </div>
          )}

          <section>
            <h3 className={SECTION}>{i18nT("openspec.dependencies.declaredBlockers", undefined, "Blocked by")}</h3>
            {draft.blockedBy.length === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)]">{i18nT("openspec.dependencies.none", undefined, "None")}</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {draft.blockedBy.map((b) => (
                  <li key={b.change} className={ROW} data-testid={`deps-declared-${b.change}`}>
                    <span className="font-mono">{b.change}</span>
                    {b.reason && <span className="text-[var(--text-secondary)]">· {b.reason}</span>}
                    <span className="flex-1" />
                    <button type="button" className={SMALL_BTN} onClick={() => removeBlocker(b.change)} data-testid={`deps-remove-${b.change}`}>
                      {i18nT("openspec.dependencies.remove", undefined, "Remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                aria-label={i18nT("openspec.dependencies.addPlaceholder", undefined, "Add a blocker…")}
                className="bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded text-[12px] px-1.5 py-1 text-[var(--text-primary)]"
                data-testid="deps-picker"
              >
                <option value="">{i18nT("openspec.dependencies.addPlaceholder", undefined, "Add a blocker…")}</option>
                {pickable.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <input
                value={pickReason}
                onChange={(e) => setPickReason(e.target.value)}
                maxLength={500}
                placeholder={i18nT("openspec.dependencies.reasonPlaceholder", undefined, "Reason (optional)")}
                className="bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded text-[12px] px-1.5 py-1 text-[var(--text-primary)] flex-1 min-w-[120px]"
                data-testid="deps-picker-reason"
              />
              <button type="button" className={SMALL_BTN} disabled={!pick} onClick={addBlocker} data-testid="deps-add">
                {i18nT("openspec.dependencies.add", undefined, "Add")}
              </button>
            </div>
          </section>

          {inferred.length > 0 && (
            <section>
              <h3 className={SECTION}>{i18nT("openspec.dependencies.inferred", undefined, "Inferred")}</h3>
              <ul className="m-0 list-none space-y-1 p-0">
                {inferred.map((e) => (
                  <li key={e.change} className={`${ROW} italic`} data-testid={`deps-inferred-${e.change}`} data-source={e.source}>
                    <span className="font-mono">{e.change}</span>
                    {e.reason && <span className="text-[var(--text-secondary)]">· {e.reason}</span>}
                    <span className="flex-1" />
                    <button type="button" className={SMALL_BTN} onClick={() => reject(e.change)} data-testid={`deps-not-dependency-${e.change}`}>
                      {i18nT("openspec.dependencies.notADependency", undefined, "Not a dependency")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {draft.notBlockedBy.length > 0 && (
            <section>
              <h3 className={SECTION}>{i18nT("openspec.dependencies.notBlockedBy", undefined, "Rejected (not a dependency)")}</h3>
              <ul className="m-0 list-none space-y-1 p-0">
                {draft.notBlockedBy.map((n) => (
                  <li key={n} className={ROW} data-testid={`deps-rejected-${n}`}>
                    <span className="font-mono">{n}</span>
                    <span className="flex-1" />
                    <button type="button" className={SMALL_BTN} onClick={() => unreject(n)}>
                      {i18nT("openspec.dependencies.remove", undefined, "Remove")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {draft.related.length > 0 && (
            <section>
              <h3 className={SECTION}>{i18nT("openspec.dependencies.related", undefined, "Related")}</h3>
              <ul className="m-0 list-none space-y-1 p-0">
                {draft.related.map((n) => (
                  <li key={n} className={ROW} data-testid={`deps-related-${n}`}>
                    <span className="font-mono">{n}</span>
                    <span className="flex-1" />
                    <button type="button" className={SMALL_BTN} onClick={() => removeRelated(n)}>
                      {i18nT("openspec.dependencies.remove", undefined, "Remove")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(loaded.dependencies?.blocks.length ?? 0) > 0 && (
            <section>
              <h3 className={SECTION}>{i18nT("openspec.dependencies.blocks", undefined, "Blocks")}</h3>
              <ul className="m-0 list-none space-y-1 p-0" data-testid="deps-blocks">
                {loaded.dependencies!.blocks.map((n) => (
                  <li key={n} className={ROW}>
                    <button type="button" className={`${SMALL_BTN} font-mono`} onClick={() => onOpenChange?.(n)} data-testid={`deps-blocks-${n}`}>
                      {n}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {failure?.kind === "modified" && (
            <div role="alert" className="text-[12px] text-[var(--severity-error-fg)]" data-testid="deps-error-modified">
              <p>{i18nT("openspec.dependencies.modified", undefined, "dependencies.yaml changed on disk since it was loaded.")}</p>
              <button type="button" className={SMALL_BTN} onClick={() => void load()} data-testid="deps-reload">
                {i18nT("openspec.dependencies.reload", undefined, "Reload")}
              </button>
            </div>
          )}
          {failure?.kind === "locked" && (
            <div role="alert" className="text-[12px] text-[var(--severity-error-fg)]" data-testid="deps-error-locked">
              <p>{i18nT("openspec.dependencies.locked", undefined, "Another OpenSpec action is running for this folder.")}</p>
              <button type="button" className={SMALL_BTN} onClick={() => void save()} data-testid="deps-retry">
                {i18nT("openspec.dependencies.retry", undefined, "Retry")}
              </button>
            </div>
          )}
          {failure?.kind === "other" && (
            <p role="alert" className="text-[12px] text-[var(--severity-error-fg)]" data-testid="deps-error-other">
              {i18nT("openspec.dependencies.saveFailed", { error: failure.message }, "Could not save: {error}")}
            </p>
          )}
        </div>
      )}
      <Dialog.Footer>
        <Dialog.Cancel onClick={onClose} testId="deps-cancel" />
        <Dialog.Action intent="primary" testId="deps-save" onClick={() => void save()} disabled={!canSave}>
          {i18nT("openspec.dependencies.save", undefined, "Save")}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
