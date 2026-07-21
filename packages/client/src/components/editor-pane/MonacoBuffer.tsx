/**
 * Monaco text/code tab. This module is the heavy, lazily-loaded chunk: it
 * imports `monaco-editor` + `@monaco-editor/react` and bundles the editor /
 * language workers via Vite `?worker` so the pane works offline. Loaded only on
 * first text-file open (the registry wraps it in `React.lazy`).
 *
 * Read-only in v1. Inherits the dashboard's active named theme + light/dark
 * mode via `buildMonacoTheme`, recoloring live on theme/mode change.
 *
 * See change: add-internal-monaco-editor-pane (design §4, §7).
 */

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { buildMonacoTheme } from "../../lib/theme/monaco-theme.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
// Side-effect import: worker wiring + loader.config (shared with MarkdownEditor).
import "./monaco-setup.js";
import type { ViewerProps } from "./types.js";

/** Map a file extension to a Monaco language id (curated allowlist). */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json",
  py: "python", go: "go", rs: "rust",
  yaml: "yaml", yml: "yaml",
  html: "html", htm: "html", css: "css", scss: "scss", less: "less",
  sql: "sql", sh: "shell", bash: "shell", zsh: "shell",
  xml: "xml", toml: "ini", ini: "ini",
  c: "c", cc: "cpp", cpp: "cpp", h: "cpp", hpp: "cpp",
  java: "java", rb: "ruby", php: "php", lua: "lua",
};

function languageFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}

export default function MonacoBuffer({ cwd, path, line }: ViewerProps) {
  const { resolved, themeName } = useThemeContext();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Server omits `content` for binary/image/pdf kinds (e.g. an extension-less
  // file the client guessed as text but the server NUL-sniffed as binary).
  const [unsupported, setUnsupported] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Fetch file content.
  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    setUnsupported(false);
    fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        if (!body.success || body.data?.type !== "file") {
          setError(body.error ?? "Failed to load file");
          return;
        }
        if (typeof body.data.content !== "string") {
          setUnsupported(true);
          return;
        }
        setContent(body.data.content);
      })
      .catch((err) => active && setError(err?.message ?? "Network error"));
    return () => {
      active = false;
    };
  }, [cwd, path]);

  // Re-scroll to `line` when it changes after the editor is already mounted
  // (reopening the same buffer at a different line).
  useEffect(() => {
    const ed = editorRef.current;
    if (ed && content !== null && line && line > 0) {
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
    }
  }, [line, content]);

  // Re-apply the derived Monaco theme whenever the dashboard theme/mode changes.
  useEffect(() => {
    if (!monacoRef.current) return;
    const { name, data } = buildMonacoTheme(themeName, resolved);
    monacoRef.current.editor.defineTheme(name, data);
    monacoRef.current.editor.setTheme(name);
  }, [themeName, resolved]);

  const handleBeforeMount = (m: Monaco) => {
    // Disable the TS/JS language service (no ts.worker shipped). Read-only
    // highlight only; suppress diagnostics so Monaco never reaches for the
    // absent worker.
    const tsDefaults = m.languages?.typescript;
    if (tsDefaults) {
      const opts = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true };
      tsDefaults.typescriptDefaults?.setDiagnosticsOptions(opts);
      tsDefaults.javascriptDefaults?.setDiagnosticsOptions(opts);
    }
    // Define the initial theme before first paint so the editor never flashes
    // the default vs-dark.
    const { name, data } = buildMonacoTheme(themeName, resolved);
    m.editor.defineTheme(name, data);
  };

  const handleMount: OnMount = (editor, m) => {
    editorRef.current = editor;
    monacoRef.current = m;
    if (line && line > 0) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
    }
  };

  if (error) {
    return <div className="p-4 text-sm text-[var(--accent-red)]">{error}</div>;
  }
  if (unsupported) {
    return (
      <div className="p-4 text-sm text-[var(--text-secondary)]">
        This file is binary and can't be shown here — open it externally.
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      theme={`pi-monaco-${themeName}-${resolved}`}
      language={languageFor(path)}
      value={content ?? ""}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      loading={<div className="p-4 text-sm text-[var(--text-tertiary)]">Loading editor…</div>}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        fontSize: 13,
        automaticLayout: true,
        renderWhitespace: "selection",
      }}
    />
  );
}
