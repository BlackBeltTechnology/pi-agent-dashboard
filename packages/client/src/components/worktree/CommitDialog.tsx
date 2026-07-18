/**
 * Placement-agnostic commit dialog: takes a `cwd` + `sessionId` and does not
 * care whether it was launched from a solo card (`GitSubcard`) or a folder
 * header (`GroupGitInfo`). File picker (checkbox + `+adds −dels`,
 * select-all/none), subject+body message, an AI-draft button, and
 * Commit / Cancel gated on ≥1 file + non-empty subject.
 *
 * A `CommitDialogProvider` mounts ONE instance at the app root; any surface
 * calls `useCommitDialog().open(cwd, sessionId)`. Self-contained + plugin-ready.
 * See change: add-session-uncommitted-indicator-and-commit.
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { GitChangedFile } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { commitFiles, draftCommitMessage, fetchChangedFiles } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface CommitDialogProps {
  cwd: string;
  sessionId: string;
  onClose: () => void;
  /** Fired after a successful commit with the short hash. */
  onCommitted?: (shortHash: string, cwd: string) => void;
}

export function CommitDialog({ cwd, sessionId, onClose, onCommitted }: CommitDialogProps) {
  const [files, setFiles] = useState<GitChangedFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftUnavailable, setDraftUnavailable] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchChangedFiles(cwd)
      .then((f) => {
        if (cancelled) return;
        setFiles(f);
        setSelected(new Set(f.map((x) => x.path))); // default: all selected
        setLoadError(null);
      })
      .catch((e) => { if (!cancelled) setLoadError(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd]);

  const toggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const allSelected = files.length > 0 && selected.size === files.length;
  const selectAllNone = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.path)));
  }, [allSelected, files]);

  const message = useMemo(
    () => (body.trim() ? `${subject.trim()}\n\n${body.trim()}` : subject.trim()),
    [subject, body],
  );
  const canCommit = selected.size > 0 && subject.trim().length > 0 && !committing;

  const onDraft = async () => {
    setDrafting(true);
    setDraftUnavailable(false);
    const res = await draftCommitMessage({ cwd, files: [...selected], sessionId });
    setDrafting(false);
    if (!res.message) { setDraftUnavailable(true); return; }
    const [first, ...rest] = res.message.split("\n");
    setSubject(first.trim());
    setBody(rest.join("\n").replace(/^\n+/, "").trim());
  };

  const onCommit = async () => {
    setCommitting(true);
    setCommitError(null);
    const res = await commitFiles({ cwd, message, files: [...selected] });
    setCommitting(false);
    if (res.ok) {
      onCommitted?.(res.data.commitHash.slice(0, 7), cwd);
      onClose();
      return;
    }
    setCommitError(codeToMessage(res.code, res.error));
  };

  return (
    <Dialog open onClose={onClose} title={i18nT("common.commitChanges", undefined, "Commit changes")} size="lg" testId="commit-dialog">
      {/* File picker */}
      {loading ? (
        <p className="text-xs text-[var(--text-muted)]">{i18nT("status.loadingChanges", undefined, "Loading changes…")}</p>
      ) : loadError ? (
        <p className="text-xs text-red-400" data-testid="commit-load-error">{loadError}</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]" data-testid="commit-no-changes">{i18nT("common.noChanges", undefined, "No changes to commit.")}</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
            <span>{selected.size} / {files.length} {i18nT("common.selected", undefined, "selected")}</span>
            <button type="button" data-testid="commit-select-all" className="hover:text-[var(--text-secondary)]" onClick={selectAllNone}>
              {allSelected ? i18nT("common.selectNone", undefined, "Select none") : i18nT("common.selectAll", undefined, "Select all")}
            </button>
          </div>
          <ul className="max-h-48 overflow-y-auto space-y-0.5" data-testid="commit-file-list">
            {files.map((f) => (
              <li key={f.path} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  data-testid={`commit-file-${f.path}`}
                  checked={selected.has(f.path)}
                  onChange={() => toggle(f.path)}
                />
                <span className="truncate flex-1" title={f.path}>{f.path}</span>
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{f.state[0]}</span>
                {f.additions != null && <span className="text-green-500">+{f.additions}</span>}
                {f.deletions != null && <span className="text-red-500">−{f.deletions}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Message */}
      <div className="space-y-1 mt-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-[var(--text-muted)]">{i18nT("session.message", undefined, "Message")}</label>
          <button
            type="button"
            data-testid="commit-ai-draft"
            className="text-[11px] text-blue-400 hover:underline disabled:opacity-50"
            onClick={onDraft}
            disabled={drafting || selected.size === 0}
          >
            {drafting ? i18nT("common.drafting", undefined, "Drafting…") : i18nT("common.aiDraft", undefined, "AI draft")}
          </button>
        </div>
        <input
          type="text"
          data-testid="commit-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={i18nT("common.subjectLine", undefined, "Subject line")}
          maxLength={100}
          className="w-full px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]"
        />
        <div className="flex justify-end text-[9px] text-[var(--text-muted)]">{subject.trim().length}/72</div>
        <textarea
          data-testid="commit-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={i18nT("common.bodyOptional", undefined, "Body (optional)")}
          rows={3}
          className="w-full px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] resize-y"
        />
        {draftUnavailable && (
          <p className="text-[10px] text-[var(--text-muted)]" data-testid="commit-draft-unavailable">
            {i18nT("common.aiDraftUnavailable", undefined, "AI draft unavailable — enter a message manually.")}
          </p>
        )}
      </div>

      {commitError && (
        <p className="text-xs text-red-400 mt-1" data-testid="commit-error">{commitError}</p>
      )}

      <Dialog.Footer>
        <Dialog.Cancel onClick={onClose} testId="commit-cancel" />
        <Dialog.Action onClick={onCommit} disabled={!canCommit} testId="commit-submit">
          {committing ? i18nT("common.committing", undefined, "Committing…") : i18nT("git.commit", undefined, "Commit")}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}

function codeToMessage(code: string, fallback: string): string {
  switch (code) {
    case "no-files": return "No files selected.";
    case "empty-message": return "Commit message is empty.";
    case "path-escape": return "A selected path is outside the repository.";
    case "not-a-repo": return "Not a git repository.";
    case "stage-failed": return `Staging failed: ${fallback}`;
    case "commit-failed": return `Commit failed: ${fallback}`;
    default: return fallback || "Commit failed.";
  }
}

// ── Provider: one dialog instance for the whole app ──────────────────────────

interface CommitDialogContextValue {
  /** Open the commit dialog for a cwd + the session whose context seeds AI-draft. */
  open: (cwd: string, sessionId: string) => void;
}

const CommitDialogContext = createContext<CommitDialogContextValue | null>(null);

export function useCommitDialog(): CommitDialogContextValue {
  const ctx = useContext(CommitDialogContext);
  // No-op fallback so surfaces render safely outside the provider (e.g. tests).
  return ctx ?? { open: () => {} };
}

export function CommitDialogProvider({
  children,
  onCommitted,
}: {
  children: React.ReactNode;
  onCommitted?: (shortHash: string, cwd: string) => void;
}) {
  const [target, setTarget] = useState<{ cwd: string; sessionId: string } | null>(null);
  const value = useMemo<CommitDialogContextValue>(
    () => ({ open: (cwd, sessionId) => setTarget({ cwd, sessionId }) }),
    [],
  );
  return (
    <CommitDialogContext.Provider value={value}>
      {children}
      {target && (
        <CommitDialog
          cwd={target.cwd}
          sessionId={target.sessionId}
          onClose={() => setTarget(null)}
          onCommitted={onCommitted}
        />
      )}
    </CommitDialogContext.Provider>
  );
}
