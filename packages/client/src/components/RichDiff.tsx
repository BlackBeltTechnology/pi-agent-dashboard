/**
 * RichDiff — shared rich-diff rendering primitive.
 * Encapsulates @git-diff-view/react + syntax highlighting.
 * Consumed by EditToolRenderer (desktop) and DiffPanel (Path A).
 * See change: rich-diff-in-chat
 */
import React, { useMemo } from "react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import { generateDiffFile } from "@git-diff-view/file";
import { highlighter } from "@git-diff-view/lowlight";
import "@git-diff-view/react/styles/diff-view.css";
import { useThemeContext } from "./ThemeProvider.js";

export const EXT_LANG_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
  ".json": "json", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".py": "python", ".rb": "ruby", ".rs": "rust", ".go": "go",
  ".java": "java", ".kt": "kotlin", ".swift": "swift",
  ".css": "css", ".scss": "scss", ".html": "html", ".xml": "xml",
  ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".md": "markdown",
  ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
  ".sql": "sql", ".graphql": "graphql", ".vue": "markup",
  ".dockerfile": "docker", ".lua": "lua", ".r": "r",
};

/** Resolve a language string from a file path, with plaintext fallback. */
export function getLang(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXT_LANG_MAP[ext] ?? "plaintext";
}

export interface RichDiffProps {
  oldText: string;
  newText: string;
  filePath: string;
  mode?: "unified" | "split";
  maxHeight?: string;
}

/**
 * Pure rendering primitive: no toolbar, no mode toggle, no header.
 * Callers own all chrome (split/unified buttons, file path headers, etc.).
 */
export function RichDiff({ oldText, newText, filePath, mode = "unified", maxHeight }: RichDiffProps) {
  const { resolved } = useThemeContext();

  const diffFile = useMemo(() => {
    const lang = getLang(filePath);
    const df = generateDiffFile(filePath, oldText, filePath, newText, lang, lang);
    df.init();
    df.buildSplitDiffLines();
    df.buildUnifiedDiffLines();
    return df;
  }, [oldText, newText, filePath]);

  const diffViewMode = mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified;

  const containerStyle: React.CSSProperties = maxHeight
    ? { maxHeight, overflowY: "auto" as const }
    : {};

  return (
    <div
      data-testid="rich-diff"
      className={maxHeight ? "overflow-auto" : undefined}
      style={containerStyle}
    >
      <DiffView
        diffFile={diffFile}
        diffViewMode={diffViewMode}
        diffViewTheme={resolved === "light" ? "light" : "dark"}
        diffViewHighlight
        diffViewWrap
        registerHighlighter={highlighter}
      />
    </div>
  );
}
