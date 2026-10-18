/**
 * Monaco JSON editor for the whole global pi `settings.json`. Lazily loaded by
 * `PiSettingsPage` (Monaco is heavy), and replaceable in tests via the
 * section's `JsonEditor` prop. Shares the dashboard Monaco bootstrap + theme.
 * See change: edit-pi-agent-settings (design D8).
 */
import Editor, { type Monaco } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { buildMonacoTheme } from "../../lib/theme/monaco-theme.js";
// Side-effect import: worker wiring + loader.config (shared with MarkdownEditor).
import "../editor-pane/monaco-setup.js";
import { useThemeContext } from "./ThemeProvider.js";

export interface PiSettingsJsonEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function PiSettingsJsonEditor({ value, onChange }: PiSettingsJsonEditorProps) {
  const { resolved, themeName } = useThemeContext();
  const monacoRef = useRef<Monaco | null>(null);

  useEffect(() => {
    if (!monacoRef.current) return;
    const { name, data } = buildMonacoTheme(themeName, resolved);
    monacoRef.current.editor.defineTheme(name, data);
    monacoRef.current.editor.setTheme(name);
  }, [themeName, resolved]);

  return (
    <Editor
      height="320px"
      theme={`pi-monaco-${themeName}-${resolved}`}
      language="json"
      value={value}
      beforeMount={(m) => {
        const { name, data } = buildMonacoTheme(themeName, resolved);
        m.editor.defineTheme(name, data);
      }}
      onMount={(_editor, m) => {
        monacoRef.current = m;
      }}
      onChange={(v) => onChange(v ?? "")}
      loading={<div className="p-4 text-sm text-[var(--text-tertiary)]">Loading editor…</div>}
      options={{
        minimap: { enabled: false },
        wordWrap: "on",
        scrollBeyondLastLine: false,
        fontSize: 13,
        automaticLayout: true,
        tabSize: 2,
      }}
    />
  );
}
