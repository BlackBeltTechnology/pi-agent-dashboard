/**
 * Binary tab — non-displayable files. Renders an "open externally" notice and,
 * when a native editor is detected, a button that hands off via the existing
 * `openEditor` flow. No file content is fetched or rendered.
 *
 * See change: add-internal-monaco-editor-pane.
 */
import { useEffect, useState } from "react";
import { type DetectedEditor, fetchEditors, openEditor } from "../../lib/editor-api.js";
import type { ViewerProps } from "./types.js";

export default function BinaryWarn({ cwd, path }: ViewerProps) {
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const launch = async (editorId: string) => {
    setLaunchError(null);
    const res = await openEditor(cwd, editorId, path);
    if (!res.success) setLaunchError(res.error ?? "Failed to open in editor");
  };

  useEffect(() => {
    let active = true;
    fetchEditors(cwd).then((found) => {
      if (active) setEditors(found);
    });
    return () => {
      active = false;
    };
  }, [cwd]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--text-secondary)]">
      <p className="text-[var(--text-primary)]">This file is binary and can't be shown here.</p>
      <p className="text-xs text-[var(--text-tertiary)]">{path}</p>
      {editors.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {editors.map((ed) => (
            <button
              key={ed.id}
              type="button"
              onClick={() => launch(ed.id)}
              className="rounded border border-[var(--border-secondary)] px-3 py-1 hover:bg-[var(--bg-hover)]"
            >
              Open in {ed.name}
            </button>
          ))}
        </div>
      )}
      {launchError && <p className="text-xs text-[var(--accent-red)]">{launchError}</p>}
    </div>
  );
}
