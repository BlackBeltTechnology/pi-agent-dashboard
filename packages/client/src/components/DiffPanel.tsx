/**
 * DiffPanel — renders diffs using @git-diff-view/react with syntax highlighting.
 * Handles three modes: Edit change (oldText/newText), Write change (all additions),
 * and git aggregate diff.
 */

import type { FileChangeEvent, FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { highlighter } from "@git-diff-view/lowlight";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { mdiCompare, mdiFileOutline, mdiViewSequential, mdiViewSplitVertical } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getApiBase } from "../lib/api-context.js";
import { t as i18nT } from "../lib/i18n";
import { getSyntaxTheme } from "../lib/syntax-theme.js";
import type { FileSelection } from "./DiffFileTree.js";
import { getLang, RichDiff } from "./RichDiff.js";
import { useThemeContext } from "./ThemeProvider.js";

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
}

type ViewMode = "diff" | "file";

export function DiffPanel({ file, selection, sessionId }: DiffPanelProps) {
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
    if (viewMode === "file") return null; // file mode uses SyntaxHighlighter directly

    // Diff view — Path A: change-derived diffs (oldText/newText)
    if (change) {
      const texts = buildChangeDiffTexts(file.path, change);
      return texts ? { richDiff: { ...texts, filePath: file.path } } : null;
    }

    // Path B: git aggregate diff (raw hunks)
    if (file.gitDiff) {
      const lang = getLang(file.path);
      const hunks = extractHunks(file.gitDiff);
      if (hunks.length > 0) {
        return {
          data: {
            oldFile: { fileName: file.path, fileLang: lang, content: "" },
            newFile: { fileName: file.path, fileLang: lang, content: "" },
            hunks,
          },
        };
      }
    }

    // Path C: non-git / no gitDiff — derive from the file's own last change.
    const lastChange = file.changes[file.changes.length - 1];
    if (lastChange) {
      const texts = buildChangeDiffTexts(file.path, lastChange);
      return texts ? { richDiff: { ...texts, filePath: file.path } } : null;
    }

    return null;
  }, [file, change, viewMode, fileContent]);

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
          <button
            className={`px-2 py-0.5 ${viewMode === "file" ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}
            onClick={() => setViewMode("file")}
          >
            <Icon path={mdiFileOutline} size={0.45} className="inline mr-0.5" />{i18nT("common.file", undefined, "File")}
          </button>
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
      </div>
    </div>
  );
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
