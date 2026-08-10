/**
 * Controlled, editable Monaco markdown editor.
 *
 * The editable counterpart to the read-only `MarkdownViewer` — used by the
 * Instructions page (`directory-settings-page-and-scoped-md-editing`) to edit
 * scoped `.md`/`.mdx` files. Fully controlled: parent owns the buffer string
 * and receives every keystroke via `onChange`. Reuses the shared Monaco
 * bootstrap (`monaco-setup.ts`) and the dashboard theme via `buildMonacoTheme`.
 *
 * Markdown needs no dedicated language worker (falls back to editor.worker).
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import Editor, { type Monaco } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { buildMonacoTheme } from "../../lib/theme/monaco-theme.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
// Side-effect import: worker wiring + loader.config (shared with MonacoBuffer).
import "./monaco-setup.js";

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function MarkdownEditor({ value, onChange, readOnly = false }: Props) {
  const { resolved, themeName } = useThemeContext();
  const monacoRef = useRef<Monaco | null>(null);

  // Re-apply the derived Monaco theme whenever the dashboard theme/mode changes.
  useEffect(() => {
    if (!monacoRef.current) return;
    const { name, data } = buildMonacoTheme(themeName, resolved);
    monacoRef.current.editor.defineTheme(name, data);
    monacoRef.current.editor.setTheme(name);
  }, [themeName, resolved]);

  const handleBeforeMount = (m: Monaco) => {
    // Define the initial theme before first paint so the editor never flashes
    // the default vs-dark.
    const { name, data } = buildMonacoTheme(themeName, resolved);
    m.editor.defineTheme(name, data);
  };

  return (
    <Editor
      height="100%"
      theme={`pi-monaco-${themeName}-${resolved}`}
      language="markdown"
      value={value}
      beforeMount={handleBeforeMount}
      onMount={(_editor, m) => {
        monacoRef.current = m;
      }}
      onChange={(v) => onChange(v ?? "")}
      loading={<div className="p-4 text-sm text-[var(--text-tertiary)]">Loading editor…</div>}
      options={{
        readOnly,
        domReadOnly: readOnly,
        minimap: { enabled: false },
        wordWrap: "on",
        scrollBeyondLastLine: false,
        fontSize: 13,
        automaticLayout: true,
      }}
    />
  );
}
