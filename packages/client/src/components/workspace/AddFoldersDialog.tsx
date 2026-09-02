/**
 * AddFoldersDialog — the multi-select "Add folders" flow.
 *
 * A real explorer, not a path prompt: the row body navigates, a per-row
 * checkbox selects, and every checked path collects in a removable-pill basket
 * that survives navigation. The dialog asks exactly ONE question — which
 * workspace, if any — because pinning is implicit: adding a folder IS pinning
 * it (pin state is what makes a folder visible in the sidebar), so no pin
 * control is offered anywhere.
 *
 * Commit sends `pin_directory` for every selected path FIRST, then
 * `add_folder_to_workspace` for each when a destination is chosen, so a folder
 * is never momentarily invisible between the two broadcasts.
 *
 * The destination is SINGLE-select, honouring the `folder-workspaces`
 * single-membership invariant (a folder belongs to at most one workspace).
 *
 * Reference mockup: openspec/changes/redesign-folder-workspace-add-flow/
 * mockups/add-flow.html. See change: redesign-folder-workspace-add-flow.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { isFilesystemRoot, normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { mdiClose, mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useMemo, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { inferPlatform, pathKey } from "../../lib/session/session-grouping.js";
import { PathPicker } from "../primitives/PathPicker.js";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog.js";

interface Props {
  /** Existing workspaces, offered as destinations. */
  workspaces: Workspace[];
  /** Destination preselected by the caller (workspace-scoped entry point). */
  initialWorkspaceId?: string | null;
  /** Directory the picker opens on. */
  initialPath?: string;
  /** Every live session's cwd — joined by `pathKey` for the row badges. */
  sessionCwds?: string[];
  /** Pin one path. Called for EVERY selected path, before any workspace add. */
  onPin: (path: string) => void;
  /** Add one path to a workspace. Called per path when a destination is set. */
  onAddFolderToWorkspace?: (workspaceId: string, path: string) => void;
  /**
   * Create a workspace by name. Creation is EAGER: the workspace is created on
   * name submit and, once the server echo lands in `workspaces`, it becomes the
   * selected destination.
   */
  onCreateWorkspace?: (name: string) => void;
  onCancel: () => void;
  /** Forwarded to PathPicker's network-denied surface (Settings → Servers). */
  onOpenServers?: () => void;
}

/**
 * Trailing path segment, for the pill label. Filesystem roots (`/`, `C:\`, a
 * UNC share root) have no meaningful leaf — return the full path so the pill and
 * its accessible remove label are non-empty AND unambiguous (`C:\`, not the
 * drive-relative `C:`). The `leaf || p` tail is a final guard for any other
 * empty-leaf shape (design D6).
 */
function leafName(p: string): string {
  if (isFilesystemRoot(p, inferPlatform([p]))) return p;
  const trimmed = p.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const leaf = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return leaf || p;
}

export function AddFoldersDialog({
  workspaces,
  initialWorkspaceId = null,
  initialPath,
  sessionCwds,
  onPin,
  onAddFolderToWorkspace,
  onCreateWorkspace,
  onCancel,
  onOpenServers,
}: Props) {
  // Insertion-ordered basket of normalized absolute paths.
  const [selected, setSelected] = useState<string[]>([]);
  const [destination, setDestination] = useState<string | null>(initialWorkspaceId);
  const [newWsOpen, setNewWsOpen] = useState(false);
  // Name awaiting its `workspaces_updated` echo, so the freshly created
  // workspace can become the selected destination once it exists.
  const [pendingWsName, setPendingWsName] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingWsName) return;
    const created = workspaces.find((w) => w.name === pendingWsName);
    if (created) {
      setDestination(created.id);
      setPendingWsName(null);
    }
  }, [workspaces, pendingWsName]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Session counts keyed by pathKey so cosmetic drift (trailing separator,
  // case on win32/darwin) collapses instead of splitting a folder in two.
  const sessionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const cwd of sessionCwds ?? []) {
      const key = pathKey(cwd, inferPlatform([cwd]));
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [sessionCwds]);

  const toggle = (rawPath: string) => {
    const path = normalizePath(rawPath.trim(), inferPlatform([rawPath]));
    if (!path) return;
    setSelected((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  };

  const handleCommit = () => {
    if (selected.length === 0) return;
    // Pins first — a folder is never momentarily invisible.
    for (const p of selected) onPin(p);
    if (destination) {
      for (const p of selected) onAddFolderToWorkspace?.(destination, p);
    }
    onCancel();
  };

  const destOption = (id: string | null, label: string, testId: string) => {
    const on = destination === id;
    return (
      <button
        key={testId}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setDestination(id)}
        className={`focus-ring inline-flex items-center gap-1.5 px-2.5 py-1 min-h-6 rounded-full text-xs border transition-colors ${
          on
            ? "border-[var(--accent-blue)] text-[var(--accent-blue)] bg-[var(--accent-blue)]/10"
            : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
        }`}
        data-testid={testId}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full border ${on ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]" : "border-[var(--border-secondary)]"}`}
          aria-hidden="true"
        />
        {label}
      </button>
    );
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title={i18nT("folders.addFolders", undefined, "Add folders")}
      size="lg"
      testId="add-folders-dialog"
    >
      <div className="flex flex-col gap-3">
        <PathPicker
          initialPath={initialPath}
          // Multi-select never answers with a single path; the basket is the
          // answer. `onSelect` is required by the picker's contract but is
          // unreachable in this mode.
          onSelect={() => {}}
          onCancel={onCancel}
          rows={8}
          onOpenServers={onOpenServers}
          selection={{ selected: selectedSet, onToggle: toggle }}
          sessionCounts={sessionCounts}
        />

        {/* Basket — removable pills, persists across navigation. */}
        <div
          className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-3"
          data-testid="add-folders-basket"
        >
          <span className="text-[10px] uppercase tracking-wide font-bold text-[var(--text-muted)] mr-1">
            {i18nT("folders.selected", undefined, "Selected")}
          </span>
          {selected.length === 0 ? (
            <span className="text-xs italic text-[var(--text-muted)]" data-testid="add-folders-basket-empty">
              {i18nT("folders.nothingSelected", undefined, "Nothing selected — tick a checkbox")}
            </span>
          ) : (
            selected.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                title={p}
                data-testid={`add-folders-pill-${p}`}
              >
                {leafName(p)}
                <button
                  type="button"
                  onClick={() => toggle(p)}
                  // Padded to the WCAG 2.5.8 24×24 minimum without growing the pill's visual weight.
                  className="focus-ring inline-flex items-center justify-center min-w-6 min-h-6 -my-1 rounded-full hover:text-red-400"
                  aria-label={i18nT("folders.removeSelection", { name: leafName(p) }, `Remove ${leafName(p)}`)}
                  data-testid={`add-folders-pill-remove-${p}`}
                >
                  <Icon path={mdiClose} size={0.5} />
                </button>
              </span>
            ))
          )}
        </div>

        {/* Destination — single-select; a folder lives in exactly one workspace. */}
        <div className="border-t border-[var(--border-subtle)] pt-3">
          <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">
            {i18nT("folders.addToWorkspaceLabel", undefined, "Add to workspace")}
            <span className="text-[var(--text-muted)] font-normal">
              {i18nT("folders.addToWorkspaceHint", undefined, " — optional; a folder lives in exactly one")}
            </span>
          </div>
          {workspaces.length === 0 ? (
            <div
              className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
              data-testid="add-folders-dest-empty"
            >
              <Icon path={mdiInformationOutline} size={0.6} />
              {i18nT("folders.noneNoWorkspacesYet", undefined, "None — no workspaces yet")}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {destOption(null, i18nT("common.none", undefined, "None"), "add-folders-dest-none")}
              {workspaces.map((w) => destOption(w.id, w.name, `add-folders-dest-${w.id}`))}
            </div>
          )}
          {onCreateWorkspace && (
            <button
              type="button"
              onClick={() => setNewWsOpen(true)}
              // min-h-6 meets the WCAG 2.5.8 24px target floor.
              className="focus-ring mt-2 inline-flex items-center gap-1 min-h-6 px-1 -mx-1 rounded text-xs text-[var(--accent-blue)] hover:underline"
              data-testid="add-folders-dest-new"
            >
              {i18nT("folders.newWorkspace", undefined, "+ New workspace…")}
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleCommit}
            disabled={selected.length === 0}
            className="focus-ring px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600"
            data-testid="add-folders-commit"
          >
            {selected.length === 0
              ? i18nT("folders.addFoldersAction", undefined, "Add folders")
              : i18nT("folders.addFoldersActionCount", { count: selected.length }, `Add ${selected.length} folder(s)`)}
          </button>
        </div>
      </div>
      {newWsOpen && onCreateWorkspace && (
        <NewWorkspaceDialog
          onCreate={(name) => {
            onCreateWorkspace(name);
            setPendingWsName(name);
            setNewWsOpen(false);
          }}
          onCancel={() => setNewWsOpen(false)}
        />
      )}
    </Dialog>
  );
}
