/**
 * DiffPanel — renders diffs using @git-diff-view/react with syntax highlighting.
 * Handles three modes: Edit change (oldText/newText), Write change (all additions),
 * and git aggregate diff.
 */

import type { EditOperation, FileChangeEvent, FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { highlighter } from "@git-diff-view/lowlight";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { mdiCompare, mdiEyeOutline, mdiFileOutline, mdiViewSequential, mdiViewSplitVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSyntaxTheme } from "../../lib/theme/syntax-theme.js";
import { DiffFilePreview } from "./DiffFilePreview.js";
import type { FileSelection } from "./DiffFileTree.js";
import { getLang, RichDiff } from "./RichDiff.js";
import { useThemeContext } from "../settings/ThemeProvider.js";

/** Map extension to Prism language for SyntaxHighlighter */
const EXT_PRISM_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
  ".json": "json", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".py": "python", ".rb": "ruby", ".rs": "rust", ".go": "go",
  ".java": "java", ".kt": "kotlin", ".swift": "swift",
  ".css": "css", ".scss": "scss", ".html": "markup", ".xml": "markup",
  ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".md": "markdown",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
  ".sql": "sql", ".graphql": "graphql",
  ".dockerfile": "docker", ".lua": "lua", ".r": "r",
};

function getPrismLang(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXT_PRISM_MAP[ext] ?? "text";
}

interface DiffPanelProps {
  file: FileDiffEntry;
  selection: FileSelection;
  sessionId: string;
  /**
   * Absolute session cwd. Threaded from `DiffViewer` (editor-pane tab). When
   * present + the entry is in-cwd, the type-based `Preview` mode is offered
   * (D11). Absent (e.g. the takeover `FileDiffView`) → `Preview` is omitted.
   */
  cwd?: string;
}

// `regions` = the old changed-regions `Preview` (renamed, D11); `filePreview` =
// the NEW type-based Preview of the current on-disk file.
type ViewMode = "diff" | "file" | "regions" | "filePreview";

/** A line rendered in Preview mode: the current file's changed regions. */
interface PreviewLine {
  /** New-file line number. */
  n: number;
  /** True when this line was added by the change (subtly tinted). */
  added: boolean;
  text: string;
}

/**
 * Preview = the current file's changed regions, removed lines omitted
 * (change: collapse-diff-file-tree). Derived from the unified `gitDiff`:
 * keep context (` `) + added (`+`) lines in new-file (`+n`) order, drop
 * removed (`-`). Scoped to hunk regions — NOT the whole file (that is `File`
 * mode). Empty when `gitDiff` is absent or unparseable (binary / non-git).
 */
function buildPreviewLines(gitDiff: string | undefined): PreviewLine[] {
  if (!gitDiff) return [];
  const out: PreviewLine[] = [];
  for (const hunk of extractHunks(gitDiff)) {
    const lines = hunk.split("\n");
    const header = lines[0].match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!header) continue;
    let n = Number.parseInt(header[1], 10);
    for (const line of lines.slice(1)) {
      if (line.startsWith("-")) continue; // removed — omit
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      const added = line.startsWith("+");
      if (added || line.startsWith(" ")) {
        out.push({ n, added, text: line.slice(1) });
        n += 1;
      }
    }
  }
  return out;
}

export function DiffPanel({ file, selection, sessionId, cwd }: DiffPanelProps) {
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = useMemo(() => getSyntaxTheme(theme, themeName), [theme, themeName]);
  const [diffMode, setDiffMode] = useState<DiffModeEnum>(DiffModeEnum.Split);
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const change = selection.changeIndex !== null
    ? file.changes[selection.changeIndex] ?? null
    : null;

  // The change actually rendered by Path A/C: the selected change, else the
  // newest change that carries renderable texts OR is truncated (so a truncated
  // newest change still drives the lazy upgrade). Keying off the SAME change
  // Path C renders keeps the truncation upgrade correct. See change:
  // fix-empty-git-aggregate-diff-tab. When its payload was trimmed in memory
  // (`truncated`), lazily upgrade to the FULL payload from the session JSONL via
  // the session-addressed endpoint (never a path). See change:
  // opt-in-out-of-cwd-session-diffs.
  const activeChange = change ?? pickFallbackChange(file);
  const [fullPayload, setFullPayload] = useState<{ content?: string; edits?: EditOperation[] } | null>(null);
  const [fullFetchError, setFullFetchError] = useState(false);

  useEffect(() => {
    setFullPayload(null);
    setFullFetchError(false);
    const tc = activeChange?.toolCallId;
    if (!activeChange?.truncated || !tc) return;
    let cancelled = false;
    fetch(`${getApiBase()}/api/session-change/${encodeURIComponent(sessionId)}/${encodeURIComponent(tc)}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        // Accept only a well-formed payload (string `content` or an `edits`
        // array). A `{ success:true, data:{} }` miss falls through to the
        // truncation banner rather than silently rendering nothing.
        const data = body?.success ? (body.data as { content?: unknown; edits?: unknown }) : null;
        if (data && (typeof data.content === "string" || Array.isArray(data.edits))) {
          setFullPayload(data as { content?: string; edits?: EditOperation[] });
        } else {
          setFullFetchError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFullFetchError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChange?.toolCallId, activeChange?.truncated, sessionId]);

  // Truncated payload with no successful upgrade → a degradation note (never a
  // blank panel): edits collapsed → "too large inline"; content → "truncated".
  const stillTruncated = !!activeChange?.truncated && !fullPayload;
  const truncationNote =
    stillTruncated && (fullFetchError || !activeChange?.toolCallId)
      ? activeChange?.type === "edit" && !activeChange?.edits?.length
        ? i18nT("diff.tooLargeInline", undefined, "Diff too large to show inline")
        : i18nT("diff.contentTruncated", undefined, "Content truncated — full version unavailable")
      : null;

  // Regions (changed regions of the current file — the old `Preview`, renamed
  // D11). Available only when the gitDiff yields parseable hunks (disabled for
  // non-git / summed / binary).
  const regionsLines = useMemo(() => buildPreviewLines(file.gitDiff), [file.gitDiff]);
  const regionsAvailable = regionsLines.length > 0;

  // New type-based Preview of the current on-disk file (D11). Available when a
  // cwd is threaded in AND the entry is in-cwd; independent of gitDiff.
  const filePreviewAvailable = !!cwd && file.previewable !== false;

  // If refreshed data drops Regions support while it's active, fall back to Diff
  // so the toggle isn't left disabled over an empty body.
  useEffect(() => {
    if (viewMode === "regions" && !regionsAvailable) setViewMode("diff");
  }, [viewMode, regionsAvailable]);

  // If the entry flips out-of-cwd (or cwd goes away) while Preview is active,
  // fall back to Diff.
  useEffect(() => {
    if (viewMode === "filePreview" && !filePreviewAvailable) setViewMode("diff");
  }, [viewMode, filePreviewAvailable]);

  // If a refresh flips this entry to out-of-cwd (previewable:false) while File
  // mode is active, fall back to Diff so the File-view /api/session-file fetch
  // (which 403s for out-of-cwd) can never fire. See change:
  // opt-in-out-of-cwd-session-diffs.
  useEffect(() => {
    if (viewMode === "file" && file.previewable === false) setViewMode("diff");
  }, [viewMode, file.previewable]);

  // Reset file content when file changes
  useEffect(() => {
    setFileContent(null);
    setFileError(null);
  }, [file.path, sessionId]);

  // Fetch file content when in "file" view
  useEffect(() => {
    if (viewMode !== "file") return;
    setFileLoading(true);
    setFileContent(null);
    setFileError(null);
    fetch(`${getApiBase()}/api/session-file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(file.path)}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.success) {
          setFileContent(body.data.content);
        } else {
          setFileError(body.error ?? "Failed to load file");
          setFileContent(null);
        }
      })
      .catch((err) => {
        setFileError(err.message ?? "Failed to load file");
        setFileContent(null);
      })
      .finally(() => setFileLoading(false));
  }, [viewMode, file.path, sessionId]);

  // Build diff data for diff view mode only.
  //
  // Precedence (change: fix-session-diff-open-nongit-and-preview):
  //   A. a specific change is selected      → render that change's texts
  //   B. else `file.gitDiff` present (git)   → render git hunks
  //   C. else (non-git / no gitDiff)         → derive from the file's own
  //      session change payload (last Write/Edit) and render all-additions /
  //      edit diff. NEVER blank when the file exists in `data.files`.
  const diffData = useMemo(() => {
    if (viewMode !== "diff") return null; // file/regions/preview modes render directly

    // Merge the lazily-fetched full payload over a (possibly truncated) change.
    const mergeFull = (c: FileChangeEvent): FileChangeEvent => ({
      ...c,
      ...(fullPayload?.content !== undefined ? { content: fullPayload.content } : {}),
      ...(fullPayload?.edits ? { edits: fullPayload.edits } : {}),
    });

    // Diff view — Path A: change-derived diffs (oldText/newText)
    if (change) {
      const texts = buildChangeDiffTexts(file.path, mergeFull(change));
      return texts ? { richDiff: { ...texts, filePath: file.path } } : null;
    }

    // Path B: git aggregate diff — pass the WHOLE header-bearing diff so
    // @git-diff-view can reconstruct lines from empty file content. A
    // header-stripped bare-hunk payload (extractHunks output) yields zero lines
    // → an empty panel. The extractHunks(...).length > 0 check stays as the
    // "has parseable hunks" gate (non-git / binary / summed → skip). See change:
    // fix-empty-git-aggregate-diff-tab.
    if (file.gitDiff) {
      const lang = getLang(file.path);
      if (extractHunks(file.gitDiff).length > 0) {
        return {
          data: {
            oldFile: { fileName: file.path, fileLang: lang, content: "" },
            newFile: { fileName: file.path, fileLang: lang, content: "" },
            hunks: [file.gitDiff],
          },
        };
      }
    }

    // Path C: non-git / no gitDiff — render the newest change carrying
    // renderable texts (skips detected-on-disk-only type:"tool" events that
    // yield null), merging any lazily-fetched full payload. Only when none
    // qualifies fall through to the "No diff data available" note. See change:
    // fix-empty-git-aggregate-diff-tab.
    const fallback = pickFallbackChange(file);
    if (fallback) {
      const texts = buildChangeDiffTexts(file.path, mergeFull(fallback));
      return texts ? { richDiff: { ...texts, filePath: file.path } } : null;
    }

    return null;
  }, [file, change, viewMode, fileContent, fullPayload]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] text-xs shrink-0">
        <span className="font-mono text-[var(--text-secondary)] truncate flex-1">{file.path}</span>

        {/* View mode toggle */}
        <div className="flex border border-[var(--border-primary)] rounded overflow-hidden">
          <button
            className={`px-2 py-0.5 ${viewMode === "diff" ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
            onClick={() => setViewMode("diff")}
          >
            <Icon path={mdiCompare} size={0.45} className="inline mr-0.5" />{i18nT("diff.diff", undefined, "Diff")}
          </button>
          {/* The File view fetches /api/session-file, which 403s for out-of-cwd
              paths (previewable:false). Hide the toggle so it is unreachable.
              See change: opt-in-out-of-cwd-session-diffs. */}
          {file.previewable !== false && (
            <button
              data-testid="file-view-toggle"
              className={`px-2 py-0.5 ${viewMode === "file" ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
              onClick={() => setViewMode("file")}
            >
              <Icon path={mdiFileOutline} size={0.45} className="inline mr-0.5" />{i18nT("common.file", undefined, "File")}
            </button>
          )}
          <button
            data-testid="regions-toggle"
            disabled={!regionsAvailable}
            className={`px-2 py-0.5 ${viewMode === "regions" ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"} ${!regionsAvailable ? "cursor-not-allowed opacity-40" : ""}`}
            onClick={() => regionsAvailable && setViewMode("regions")}
            title={regionsAvailable ? undefined : i18nT("diff.regionsUnavailable", undefined, "Regions needs a git diff")}
          >
            <Icon path={mdiViewSequential} size={0.45} className="inline mr-0.5" />{i18nT("diff.regions", undefined, "Regions")}
          </button>
          {filePreviewAvailable && (
            <button
              data-testid="file-preview-toggle"
              className={`px-2 py-0.5 ${viewMode === "filePreview" ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
              onClick={() => setViewMode("filePreview")}
            >
              <Icon path={mdiEyeOutline} size={0.45} className="inline mr-0.5" />{i18nT("diff.preview", undefined, "Preview")}
            </button>
          )}
        </div>

        {/* Diff mode toggle (only in diff view) */}
        {viewMode === "diff" && (
          <div className="flex border border-[var(--border-primary)] rounded overflow-hidden">
            <button
              className={`px-2 py-0.5 ${diffMode === DiffModeEnum.Split ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
              onClick={() => setDiffMode(DiffModeEnum.Split)}
            >
              <Icon path={mdiViewSplitVertical} size={0.45} className="inline mr-0.5" />{i18nT("common.split", undefined, "Split")}
            </button>
            <button
              className={`px-2 py-0.5 ${diffMode === DiffModeEnum.Unified ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
              onClick={() => setDiffMode(DiffModeEnum.Unified)}
            >
              <Icon path={mdiViewSequential} size={0.45} className="inline mr-0.5" />{i18nT("diff.unified", undefined, "Unified")}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {truncationNote && (
          <div
            data-testid="diff-truncation-banner"
            className="px-3 py-1.5 text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] border-b border-[var(--border-primary)]"
          >
            {truncationNote}
          </div>
        )}
        {viewMode === "file" && fileLoading && (
          <div className="flex items-center justify-center h-32 text-[var(--text-tertiary)]">
            {i18nT("status.loadingFile", undefined, "Loading file...")}
          </div>
        )}
        {viewMode === "file" && fileError && !fileLoading && (
          <div className="flex items-center justify-center h-32 text-red-400/70">
            {fileError}
          </div>
        )}
        {viewMode === "file" && fileContent != null && !fileLoading && (
          <SyntaxHighlighter
            language={getPrismLang(file.path)}
            style={syntaxStyle}
            showLineNumbers
            customStyle={{ margin: 0, borderRadius: 0, fontSize: "13px", background: "transparent" }}
            lineNumberStyle={{ minWidth: "3em", paddingRight: "1em", color: "var(--text-muted, #555)" }}
          >
            {fileContent}
          </SyntaxHighlighter>
        )}
        {viewMode === "diff" && diffData && diffData.richDiff && (
          <RichDiff
            oldText={diffData.richDiff.oldText}
            newText={diffData.richDiff.newText}
            filePath={diffData.richDiff.filePath}
            mode={diffMode === DiffModeEnum.Split ? "split" : "unified"}
          />
        )}
        {viewMode === "diff" && diffData && diffData.data && (
          <DiffView
            data={diffData.data}
            diffViewMode={diffMode}
            diffViewTheme={theme === "light" ? "light" : "dark"}
            diffViewHighlight
            diffViewWrap
            registerHighlighter={highlighter}
          />
        )}
        {viewMode === "diff" && !diffData && !fileLoading && (
          <div className="flex items-center justify-center h-32 text-[var(--text-tertiary)]">
            {i18nT("diff.noDiffDataAvailable", undefined, "No diff data available")}
          </div>
        )}
        {viewMode === "regions" && (
          <div data-testid="regions-body" className="font-mono text-[13px] leading-relaxed">
            {regionsLines.map((l, i) => (
              <div
                key={i}
                data-preview-line={l.n}
                className={`flex ${l.added ? "bg-[var(--accent-green)]/10" : ""}`}
              >
                <span className="w-12 shrink-0 select-none pr-3 text-right text-[var(--text-muted)]">{l.n}</span>
                <span className="whitespace-pre">{l.text}</span>
              </div>
            ))}
          </div>
        )}
        {viewMode === "filePreview" && cwd && <DiffFilePreview cwd={cwd} path={file.path} />}
      </div>
    </div>
  );
}

/**
 * The file's newest change that Path C should render: the most recent change
 * carrying renderable texts (an `edit` with `edits[]` or a `write` with
 * `content`), or a `truncated` change (which becomes renderable after the lazy
 * full-payload upgrade). Skips detected-on-disk-only (`type:"tool"`) events.
 * Returns null when no change qualifies. See change:
 * fix-empty-git-aggregate-diff-tab.
 */
function pickFallbackChange(file: FileDiffEntry): FileChangeEvent | null {
  for (let i = file.changes.length - 1; i >= 0; i--) {
    const c = file.changes[i];
    if (c.truncated || buildChangeDiffTexts(file.path, c)) return c;
  }
  return null;
}

/** Extract { oldText, newText } from a single change event (Edit or Write) for RichDiff. */
function buildChangeDiffTexts(
  filePath: string,
  change: FileChangeEvent,
): { oldText: string; newText: string } | null {
  if (change.type === "edit" && change.edits?.length) {
    // Concatenate all edit operations with separators
    const oldParts: string[] = [];
    const newParts: string[] = [];
    for (const edit of change.edits) {
      oldParts.push(edit.oldText);
      newParts.push(edit.newText);
    }
    return {
      oldText: oldParts.join("\n\n// ─── next edit ───\n\n"),
      newText: newParts.join("\n\n// ─── next edit ───\n\n"),
    };
  }

  if (change.type === "write" && change.content) {
    return { oldText: "", newText: change.content };
  }

  return null;
}

/** Extract hunk strings from a unified diff */
function extractHunks(gitDiff: string): string[] {
  const lines = gitDiff.split("\n");
  const hunks: string[] = [];
  let currentHunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (currentHunk.length > 0) {
        hunks.push(currentHunk.join("\n"));
      }
      currentHunk = [line];
    } else if (currentHunk.length > 0) {
      currentHunk.push(line);
    }
  }
  if (currentHunk.length > 0) {
    hunks.push(currentHunk.join("\n"));
  }
  return hunks;
}
