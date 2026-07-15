/**
 * Canvas-type registry settings section: 8 per-kind checkboxes + a
 * global/project scope switch. Toggling PATCHes the full 8-key map for the
 * selected scope, then refreshes from the response.
 *
 * Project scope needs a cwd (the currently-selected session's). With none
 * selected, the project scope is disabled with a hint.
 *
 * See change: auto-canvas (Decision 6 / task 5.2).
 */
import type {
  CanvasKind,
  CanvasTypes,
} from "@blackbelt-technology/pi-dashboard-shared/canvas-types.js";
import { NON_FALLBACK_KINDS } from "@blackbelt-technology/pi-dashboard-shared/renderer-by-ext.js";
import { useCallback, useEffect, useState } from "react";
import {
  type CanvasTypesResponse,
  type CanvasTypesScope,
  displayedCanvasTypes,
  getCanvasTypes,
  patchCanvasTypes,
} from "../lib/canvas-types-api.js";

const KIND_LABELS: Record<CanvasKind, string> = {
  markdown: "Markdown",
  asciidoc: "AsciiDoc",
  docx: "Word (docx)",
  pptx: "PowerPoint (pptx)",
  spreadsheet: "Spreadsheet",
  html: "HTML",
  pdf: "PDF",
  video: "Video",
  audio: "Audio",
  image: "Image",
  youtube: "YouTube",
  email: "Email",
};

export function CanvasTypesSettingsSection({ selectedCwd }: { selectedCwd?: string }) {
  const [scope, setScope] = useState<CanvasTypesScope>("global");
  const [res, setRes] = useState<CanvasTypesResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const projectDisabled = scope === "project" && !selectedCwd;

  const load = useCallback(async () => {
    try {
      setRes(await getCanvasTypes(selectedCwd ?? ""));
    } catch {/* tolerate */}
  }, [selectedCwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayed: CanvasTypes | null = res ? displayedCanvasTypes(scope, res) : null;

  const toggle = useCallback(
    async (kind: CanvasKind) => {
      if (!displayed || busy || projectDisabled) return;
      if (scope === "project" && !selectedCwd) return;
      const next: CanvasTypes = { ...displayed, [kind]: !displayed[kind] };
      setBusy(true);
      try {
        setRes(await patchCanvasTypes(scope, selectedCwd ?? "", next));
      } catch {/* tolerate */} finally {
        setBusy(false);
      }
    },
    [displayed, busy, projectDisabled, scope, selectedCwd],
  );

  return (
    <div data-testid="canvas-types-settings">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        Canvas types
      </h2>

      {/* Scope switch */}
      <div className="flex items-center gap-2 mb-3">
        {(["global", "project"] as const).map((s) => {
          const active = scope === s;
          const disabled = s === "project" && !selectedCwd;
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => setScope(s)}
              data-testid={`canvas-scope-${s}`}
              className={`min-h-[44px] min-w-[44px] px-2 py-1 text-xs rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-secondary)]"
              }`}
            >
              {s === "global" ? "Global" : "Project"}
            </button>
          );
        })}
      </div>

      {scope === "project" && !selectedCwd && (
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Select a session for project scope.
        </p>
      )}

      <div className="space-y-1">
        {NON_FALLBACK_KINDS.map((kind) => (
          <label
            key={kind}
            className={`flex min-h-[44px] items-center gap-2 text-sm text-[var(--text-secondary)] ${
              projectDisabled ? "opacity-50" : ""
            }`}
          >
            <input
              type="checkbox"
              data-testid={`canvas-type-${kind}`}
              checked={displayed ? displayed[kind] : false}
              disabled={!displayed || busy || projectDisabled}
              onChange={() => void toggle(kind)}
            />
            {KIND_LABELS[kind]}
          </label>
        ))}
      </div>

      <p className="text-xs text-[var(--text-tertiary)] mt-3">
        Unchecked kinds are not auto-canvased on detection, but stay openable
        manually and via canvas().
      </p>
    </div>
  );
}
