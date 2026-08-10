/**
 * Per-kind mime icon for editor-pane tree rows + tabs (defect #2).
 *
 * Maps a file path's extension to an `@mdi/js` glyph + accent color class so
 * `.ts`, `.json`, `.png`, `.mp4`, `.mp3`, `.mmd`, `.pdf` … each read
 * distinctly in the rail and the tab strip. Extension-keyed (finer than
 * `fileKind`'s coarse `kind`, which cannot separate `.ts` from `.json`);
 * unknown extensions fall back to a generic file glyph.
 *
 * See change: improve-content-editor (tasks §2.3).
 */
import {
  mdiCodeJson,
  mdiCog,
  mdiEmailOutline,
  mdiFileCodeOutline,
  mdiFileDelimitedOutline,
  mdiFileDocumentOutline,
  mdiFileExcelOutline,
  mdiFileImageOutline,
  mdiFileMusicOutline,
  mdiFileOutline,
  mdiFilePdfBox,
  mdiFilePowerpointOutline,
  mdiFileVideoOutline,
  mdiFileWordOutline,
  mdiGraphOutline,
  mdiLanguageCss3,
  mdiLanguageGo,
  mdiLanguageHtml5,
  mdiLanguageJavascript,
  mdiLanguageMarkdown,
  mdiLanguagePython,
  mdiLanguageRust,
  mdiLanguageTypescript,
} from "@mdi/js";

export interface FileIcon {
  /** `@mdi/js` path string. */
  iconPath: string;
  /** Tailwind text-color class (accent CSS var) or "" for the default tone. */
  colorClass: string;
}

/** Lowercased extension incl. leading dot, or "" when none. */
function extOf(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

const ICON_BY_EXT: Record<string, FileIcon> = {
  ".ts": { iconPath: mdiLanguageTypescript, colorClass: "text-[var(--accent-blue)]" },
  ".tsx": { iconPath: mdiLanguageTypescript, colorClass: "text-[var(--accent-blue)]" },
  ".mts": { iconPath: mdiLanguageTypescript, colorClass: "text-[var(--accent-blue)]" },
  ".cts": { iconPath: mdiLanguageTypescript, colorClass: "text-[var(--accent-blue)]" },
  ".js": { iconPath: mdiLanguageJavascript, colorClass: "text-[var(--accent-yellow)]" },
  ".jsx": { iconPath: mdiLanguageJavascript, colorClass: "text-[var(--accent-yellow)]" },
  ".mjs": { iconPath: mdiLanguageJavascript, colorClass: "text-[var(--accent-yellow)]" },
  ".cjs": { iconPath: mdiLanguageJavascript, colorClass: "text-[var(--accent-yellow)]" },
  ".json": { iconPath: mdiCodeJson, colorClass: "text-[var(--accent-orange)]" },
  ".jsonc": { iconPath: mdiCodeJson, colorClass: "text-[var(--accent-orange)]" },
  ".py": { iconPath: mdiLanguagePython, colorClass: "text-[var(--accent-blue)]" },
  ".go": { iconPath: mdiLanguageGo, colorClass: "text-[var(--accent-blue)]" },
  ".rs": { iconPath: mdiLanguageRust, colorClass: "text-[var(--accent-orange)]" },
  ".css": { iconPath: mdiLanguageCss3, colorClass: "text-[var(--accent-blue)]" },
  ".scss": { iconPath: mdiLanguageCss3, colorClass: "text-[var(--accent-blue)]" },
  ".less": { iconPath: mdiLanguageCss3, colorClass: "text-[var(--accent-blue)]" },
  ".html": { iconPath: mdiLanguageHtml5, colorClass: "text-[var(--accent-orange)]" },
  ".htm": { iconPath: mdiLanguageHtml5, colorClass: "text-[var(--accent-orange)]" },
  ".md": { iconPath: mdiLanguageMarkdown, colorClass: "text-[var(--accent-blue)]" },
  ".mdx": { iconPath: mdiLanguageMarkdown, colorClass: "text-[var(--accent-blue)]" },
  ".markdown": { iconPath: mdiLanguageMarkdown, colorClass: "text-[var(--accent-blue)]" },
  ".pdf": { iconPath: mdiFilePdfBox, colorClass: "text-[var(--accent-red)]" },
  ".png": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".jpg": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".jpeg": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".gif": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".webp": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".svg": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".ico": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".bmp": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".avif": { iconPath: mdiFileImageOutline, colorClass: "text-[var(--accent-green)]" },
  ".mp4": { iconPath: mdiFileVideoOutline, colorClass: "text-[var(--accent-purple)]" },
  ".webm": { iconPath: mdiFileVideoOutline, colorClass: "text-[var(--accent-purple)]" },
  ".mov": { iconPath: mdiFileVideoOutline, colorClass: "text-[var(--accent-purple)]" },
  ".mp3": { iconPath: mdiFileMusicOutline, colorClass: "text-[var(--accent-purple)]" },
  ".wav": { iconPath: mdiFileMusicOutline, colorClass: "text-[var(--accent-purple)]" },
  ".ogg": { iconPath: mdiFileMusicOutline, colorClass: "text-[var(--accent-purple)]" },
  ".m4a": { iconPath: mdiFileMusicOutline, colorClass: "text-[var(--accent-purple)]" },
  ".flac": { iconPath: mdiFileMusicOutline, colorClass: "text-[var(--accent-purple)]" },
  ".mmd": { iconPath: mdiGraphOutline, colorClass: "text-[var(--accent-green)]" },
  ".mermaid": { iconPath: mdiGraphOutline, colorClass: "text-[var(--accent-green)]" },
  ".yaml": { iconPath: mdiCog, colorClass: "" },
  ".yml": { iconPath: mdiCog, colorClass: "" },
  ".toml": { iconPath: mdiCog, colorClass: "" },
  ".ini": { iconPath: mdiCog, colorClass: "" },
  ".sh": { iconPath: mdiFileCodeOutline, colorClass: "text-[var(--accent-green)]" },
  ".bash": { iconPath: mdiFileCodeOutline, colorClass: "text-[var(--accent-green)]" },
  ".zsh": { iconPath: mdiFileCodeOutline, colorClass: "text-[var(--accent-green)]" },
  ".txt": { iconPath: mdiFileDocumentOutline, colorClass: "" },
  ".log": { iconPath: mdiFileDocumentOutline, colorClass: "" },
  // Rich office / document / email kinds (change: open-view-command-in-editor-pane).
  ".docx": { iconPath: mdiFileWordOutline, colorClass: "text-[var(--accent-blue)]" },
  ".pptx": { iconPath: mdiFilePowerpointOutline, colorClass: "text-[var(--accent-orange)]" },
  ".xlsx": { iconPath: mdiFileExcelOutline, colorClass: "text-[var(--accent-green)]" },
  ".xls": { iconPath: mdiFileExcelOutline, colorClass: "text-[var(--accent-green)]" },
  ".csv": { iconPath: mdiFileDelimitedOutline, colorClass: "text-[var(--accent-green)]" },
  ".adoc": { iconPath: mdiFileDocumentOutline, colorClass: "text-[var(--accent-blue)]" },
  ".asciidoc": { iconPath: mdiFileDocumentOutline, colorClass: "text-[var(--accent-blue)]" },
  ".eml": { iconPath: mdiEmailOutline, colorClass: "text-[var(--accent-purple)]" },
};

const DEFAULT_ICON: FileIcon = { iconPath: mdiFileOutline, colorClass: "" };

/** Icon + color for a file path, keyed by extension. */
export function fileIcon(pathOrName: string): FileIcon {
  return ICON_BY_EXT[extOf(pathOrName)] ?? DEFAULT_ICON;
}
