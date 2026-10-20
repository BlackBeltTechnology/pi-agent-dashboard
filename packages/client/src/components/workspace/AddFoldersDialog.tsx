/**
 * AddFoldersDialog — the multi-select "Add folders" flow.
 *
 * An OS-style folder picker: click selects, Cmd/Ctrl-click multi-selects,
 * double-click (or a touch tap) opens. With nothing selected the commit adds
 * the folder being browsed — never the implicit home directory. Already-added
 * folders are marked and skipped. The dialog asks exactly ONE question — which
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
 * Reference mockup: openspec/changes/simplify-add-folder-picker/mockups/
 * simple-folder-picker/index.html. See changes: redesign-folder-workspace-add-flow,
 * simplify-add-folder-picker.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { isFilesystemRoot, normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { useEffect, useId, useMemo, useState } from "react";
import { browserIsMacLike } from "../../hooks/useHostPlatform.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { inferPlatform, pathKey } from "../../lib/session/session-grouping.js";
import { PiTrustCheckbox, usePiTrustChoice } from "../access-grant/PiTrustCheckbox.js";
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
  /** Already-pinned folders — marked `added` and skipped on commit (by `pathKey`). */
  pinnedPaths?: string[];
  /** Pin one path. Called for EVERY selected path, before any workspace add. */
  /** `piTrust`: the "Also trust this folder in pi" choice, stored with the pin. */
  onPin: (path: string, piTrust: boolean) => void;
  /** Add one path to a workspace. Called per path when a destination is set. */
  onAddFolderToWorkspace?: (workspaceId: string, path: string, piTrust: boolean) => void;
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
 * Trailing path segment, for the primary label and status line. Filesystem
 * roots (`/`, `C:\`, a UNC share root) have no meaningful leaf — return the
 * full path so the label is non-empty AND unambiguous (`C:\`, not the
 * drive-relative `C:`). The `leaf || p` tail guards any other empty-leaf shape.
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
  pinnedPaths,
  onPin,
  onAddFolderToWorkspace,
  onCreateWorkspace,
  onCancel,
  onOpenServers,
}: Props) {
  // "Also trust this folder in pi": one choice for the whole batch, seeded from the
  // pinned-folder source default (the workspace source defaults identically).
  const [piTrust, setPiTrust] = usePiTrustChoice("pinned");
  // Picker-reported state: selection in the browsed folder + the folder itself.
  const [pick, setPick] = useState<{ selected: string[]; current: string | null; isHome: boolean }>({
    selected: [],
    current: null,
    isHome: false,
  });
  const [clearRequest, setClearRequest] = useState(0);
  const [destination, setDestination] = useState<string | null>(initialWorkspaceId);
  const [newWsOpen, setNewWsOpen] = useState(false);
  const wsSelectId = useId();
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

  const pinnedKeys = useMemo(
    () => new Set((pinnedPaths ?? []).map((p) => pathKey(p, inferPlatform([p])))),
    [pinnedPaths],
  );

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

  // Commit targets (design D6/D9): the selection, else the browsed folder —
  // except the implicit home directory, which is never a fallback target.
  const norm = (raw: string) => normalizePath(raw.trim(), inferPlatform([raw]));
  const hasSelection = pick.selected.length > 0;
  const targets = hasSelection
    ? pick.selected.map(norm)
    : pick.current && !pick.isHome
      ? [norm(pick.current)]
      : [];
  const fresh = targets.filter((t) => t && !pinnedKeys.has(pathKey(t, inferPlatform([t]))));
  const homeBlocked = !hasSelection && pick.isHome;
  const allAdded = targets.length > 0 && fresh.length === 0;

  const handleCommit = () => {
    if (fresh.length === 0) return;
    // Pins first — a folder is never momentarily invisible.
    for (const p of fresh) onPin(p, piTrust);
    if (destination) {
      for (const p of fresh) onAddFolderToWorkspace?.(destination, p, piTrust);
    }
    onCancel();
  };

  const commitLabel = homeBlocked
    ? i18nT("folders.selectOrOpen", undefined, "Select or open a folder")
    : allAdded
      ? i18nT("folders.alreadyAdded", undefined, "Already added")
      : fresh.length === 1
        ? i18nT("folders.addOne", { name: leafName(fresh[0]) }, `Add "${leafName(fresh[0])}"`)
        : fresh.length > 1
          ? i18nT("folders.addCount", { count: fresh.length }, `Add ${fresh.length} folders`)
          : i18nT("folders.addFoldersAction", undefined, "Add folders");

  const [isMac] = useState(browserIsMacLike);
  const [touch] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
  );
  const hint = touch
    ? i18nT("folders.targetHint.touch", undefined, "Tap to open · long-press to select")
    : isMac
      ? i18nT("folders.targetHint.mac", undefined, "Click to select · ⌘-click for more · double-click to open")
      : i18nT("folders.targetHint.other", undefined, "Click to select · Ctrl-click for more · double-click to open");

  const NEW_WS = "__new__";
  const preselected = initialWorkspaceId !== null && destination === initialWorkspaceId
    ? workspaces.find((w) => w.id === initialWorkspaceId)
    : undefined;

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
          // Multi-select never answers with a single path; the dialog commits
          // the reported targets. `onSelect` is required by the picker's contract but is
          // unreachable in this mode.
          onSelect={() => {}}
          onCancel={onCancel}
          // 6 rows on touch keep the footer on screen (44 px rows); 8 on desktop.
          rows={touch ? 6 : 8}
          onOpenServers={onOpenServers}
          selection={{ onChange: setPick, pinnedKeys, clearRequest }}
          sessionCounts={sessionCounts}
        />

        {/* Status line — "Adds: <target>" names the exact commit target. */}
        <div className="flex flex-col gap-0.5 text-xs" data-testid="add-folders-status">
          <div className="flex items-baseline gap-1.5 min-w-0 text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)] shrink-0">
              {i18nT("folders.adds", undefined, "Adds:")}
            </span>
            {hasSelection ? (
              <>
                <span
                  className="font-mono text-[var(--text-primary)] truncate min-w-0"
                  data-testid="add-folders-status-selected"
                  title={pick.selected.join("\n")}
                >
                  {pick.selected.map(leafName).join(", ")}
                </span>
                <button
                  type="button"
                  onClick={() => setClearRequest((n) => n + 1)}
                  className="focus-ring shrink-0 inline-flex items-center min-h-6 px-1 rounded font-semibold text-[var(--accent-blue-text)] hover:underline"
                  data-testid="add-folders-clear"
                >
                  {i18nT("folders.clearSelection", undefined, "Clear")}
                </button>
              </>
            ) : homeBlocked ? (
              <span data-testid="add-folders-status-home">
                {i18nT("folders.addsNothingHome", undefined, "nothing yet. Your home folder is never added by default.")}
              </span>
            ) : (
              <span
                className="font-mono text-[var(--text-primary)] truncate min-w-0"
                data-testid="add-folders-status-path"
                title={pick.current ? norm(pick.current) : ""}
              >
                {pick.current ? norm(pick.current) : ""}
              </span>
            )}
          </div>
          <span className="text-[var(--text-secondary)]" data-testid="add-folders-hint">
            {hint}
          </span>
        </div>

        {/* Options — Workspace dropdown + Trust share one quiet block (mockup). */}
        <div
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 items-center border-t border-[var(--border-subtle)] pt-3"
          data-testid="add-folders-options"
        >
          <label htmlFor={wsSelectId} className="text-[12px] font-semibold text-[var(--text-primary)]">
            {i18nT("folders.workspace", undefined, "Workspace")}
          </label>
          <select
            id={wsSelectId}
            value={destination ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === NEW_WS) {
                setNewWsOpen(true);
                return;
              }
              setDestination(v || null);
            }}
            className="focus-ring w-full sm:max-w-[260px] min-h-[44px] sm:min-h-[32px] rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[13px] text-[var(--text-primary)]"
            data-testid="add-folders-dest"
          >
            <option value="">{i18nT("folders.workspaceNone", undefined, "None (optional)")}</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            {onCreateWorkspace && (
              <option value={NEW_WS}>{i18nT("folders.newWorkspace", undefined, "+ New workspace…")}</option>
            )}
          </select>
          {preselected && (
            <span className="col-start-2 -mt-1 text-xs text-[var(--text-secondary)]" data-testid="add-folders-dest-why">
              {i18nT(
                "folders.workspacePreselected",
                { name: preselected.name },
                `Preselected because you opened this from "${preselected.name}".`,
              )}
            </span>
          )}
          <span className="self-start pt-0.5 text-[12px] font-semibold text-[var(--text-primary)]">
            {i18nT("folders.trust", undefined, "Trust")}
          </span>
          <PiTrustCheckbox checked={piTrust} onChange={setPiTrust} testId="add-folders-pi-trust" />
        </div>

        {/* Sticky footer — Cancel + Add stay visible however far the dialog scrolls. */}
        <div className="sticky -bottom-5 -mx-5 -mb-5 px-5 pb-5 pt-3 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)]">
          <Dialog.Footer>
            <Dialog.Cancel onClick={onCancel}>{i18nT("common.cancel", undefined, "Cancel")}</Dialog.Cancel>
            <button
              type="button"
              onClick={handleCommit}
              disabled={fresh.length === 0}
              title={commitLabel}
              className="focus-ring inline-block max-w-[240px] truncate text-xs font-semibold px-3 rounded min-h-[44px] sm:min-h-[36px] border border-transparent bg-[var(--accent-solid)] text-white hover:opacity-90 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:hover:opacity-100 disabled:cursor-not-allowed"
              data-testid="add-folders-commit"
            >
              {commitLabel}
            </button>
          </Dialog.Footer>
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
