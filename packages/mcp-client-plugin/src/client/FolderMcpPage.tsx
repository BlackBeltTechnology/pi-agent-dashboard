/**
 * FolderMcpPage — `shell-overlay-route` claim at `/folder/:encodedCwd/mcp`.
 *
 * The effective MCP configuration for one folder cwd, with folder-layer
 * overrides. Admission is server-side only: the route decodes the cwd and the
 * effective-view request is refused (403) for a folder the host does not
 * track, so the page renders a not-allowed empty state with NO retry and no
 * server or folder data. A 504 renders a timeout state whose retry issues
 * exactly one new request. Otherwise it lists the effective servers with the
 * four-vocabulary provenance (**Shared / Pi global / Pi folder / Other**), an
 * "inherited from <layer>" hint per field the folder entry does not define,
 * folder-scope enable/disable switches, and a removable override chip. The
 * same adapter-status read-only rule as the global section disables every
 * switch, Override, and Save when the verdict is not `ok`.
 *
 * Below 640px override chips are display-only and the row editor (a bottom
 * sheet) offers "Remove override". See change: extract-mcp-client-plugin
 * (tasks 8.2-8.4).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useMemo, useState } from "react";
import type { EffectiveServerView, EffectiveView } from "../core/effective-view.js";
import type { Scope } from "../core/types.js";
import { ApiError, patchServer, removeServer, scopeToWire } from "./api.js";
import { inheritedFieldsOf, inheritedLayerOf, isFolderOwned } from "./folder-view.js";
import { type AdapterStatus, invalidateEffective, useAdapterStatus, useEffectiveConfig } from "./hooks.js";
import { ServerEditor } from "./ServerEditor.js";
import { ServerList } from "./ServerList.js";
import { useIsNarrow } from "./useIsNarrow.js";

export interface FolderMcpPageProps {
  params: Record<string, string>;
  session?: unknown;
  onBack: () => void;
}

type Translate = ReturnType<typeof useT>;

/** Decode the route's `encodedCwd`; a malformed encode is not a valid cwd. */
export function decodeFolderCwd(encoded: string | undefined): string | null {
  if (!encoded) return null;
  try {
    const cwd = decodeURIComponent(encoded);
    return cwd.length > 0 ? cwd : null;
  } catch {
    return null;
  }
}

function PageHeader({ onBack }: { onBack: () => void }): React.ReactElement {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        data-testid="mcp-folder-back"
        className="text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {t("mcpFolderBack", undefined, "Back")}
      </button>
      <h3 className="text-sm font-semibold m-0 text-[var(--text-primary)]">
        {t("mcpFolderHeading", undefined, "MCP servers · this folder")}
      </h3>
    </div>
  );
}

function NotAllowed(): React.ReactElement {
  const t = useT();
  return (
    <p
      data-testid="mcp-folder-not-allowed"
      role="alert"
      className="text-[11px] text-[var(--text-secondary)] m-0"
    >
      {t("mcpFolderNotAllowed", undefined, "This folder is not tracked by the dashboard.")}
    </p>
  );
}

function ReadOnlyBanner({ status }: { status: AdapterStatus }): React.ReactElement {
  const t = useT();
  return (
    <div
      data-testid="mcp-folder-readonly-banner"
      role="status"
      className="text-[11px] px-2 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
    >
      {t(
        "mcpFolderReadOnly",
        { message: status.message, floor: status.floor },
        `${status.message} Requires ≥${status.floor}.`,
      )}
    </div>
  );
}

interface EditingState {
  name: string;
  mode: "edit" | "override";
}

interface UndoState {
  name: string;
  removed: Record<string, unknown>;
}

/** The 403 / 504 / generic error surface, or `null` when the view is usable. */
function folderErrorState(
  error: unknown,
  reload: () => void,
  t: Translate,
): React.ReactElement | null {
  if (error instanceof ApiError && error.isNotAllowed) return <NotAllowed />;
  if (error instanceof ApiError && error.isAdapterTimeout) {
    const ms = error.timeoutMs ?? 10000;
    return (
      <p
        data-testid="mcp-folder-timeout"
        role="alert"
        className="text-[11px] text-[var(--text-secondary)] m-0"
      >
        {t("mcpFolderTimeout", { ms }, `Loading the folder's MCP configuration timed out after ${ms} ms.`)}{" "}
        <button
          type="button"
          onClick={reload}
          data-testid="mcp-folder-timeout-retry"
          className="px-1.5 py-0.5 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)]"
        >
          {t("mcpFolderRetry", undefined, "Retry")}
        </button>
      </p>
    );
  }
  if (error) {
    const message = (error as Error).message;
    return (
      <p
        data-testid="mcp-folder-error"
        role="alert"
        className="text-[11px] text-[var(--status-error,#f87171)] m-0"
      >
        {t("mcpFolderError", { message }, `Could not load the folder's MCP configuration: ${message}`)}{" "}
        <button
          type="button"
          onClick={reload}
          data-testid="mcp-folder-error-retry"
          className="px-1.5 py-0.5 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)]"
        >
          {t("mcpFolderRetry", undefined, "Retry")}
        </button>
      </p>
    );
  }
  return null;
}

interface FolderActions {
  editing: EditingState | null;
  undo: UndoState | null;
  actionError: string | null;
  scope: Scope;
  open: (name: string) => void;
  openAdd: () => void;
  closeEditor: () => void;
  removeOverride: (name: string) => void;
  undoRemove: () => void;
  refreshed: () => void;
}

/** Editing / override-removal / undo state for one folder page. */
function useFolderActions(
  cwd: string,
  view: EffectiveView | null,
  reload: () => void,
): FolderActions {
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scope = useMemo<Scope>(() => ({ kind: "project", cwd }), [cwd]);
  const refreshed = (): void => {
    invalidateEffective(cwd);
    reload();
  };

  async function removeOverride(name: string): Promise<void> {
    setActionError(null);
    try {
      const res = await removeServer(name, scopeToWire(scope));
      setEditing(null);
      setUndo({ name, removed: (res.removed ?? {}) as Record<string, unknown> });
      refreshed();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function undoRemove(): Promise<void> {
    if (!undo) return;
    try {
      await patchServer(undo.name, { ...scopeToWire(scope), set: undo.removed });
      setUndo(null);
      refreshed();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function open(name: string): void {
    const server = view?.servers.find((s) => s.name === name);
    setEditing({ name, mode: server && isFolderOwned(server) ? "edit" : "override" });
  }

  return {
    editing,
    undo,
    actionError,
    scope,
    open,
    openAdd: () => setEditing({ name: "", mode: "override" }),
    closeEditor: () => setEditing(null),
    removeOverride: (name) => void removeOverride(name),
    undoRemove: () => void undoRemove(),
    refreshed,
  };
}

function UndoToast({ name, onUndo }: { name: string; onUndo: () => void }): React.ReactElement {
  const t = useT();
  return (
    <div
      data-testid="mcp-folder-undo-toast"
      role="status"
      className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
    >
      <span>{t("mcpFolderOverrideRemoved", { name }, `Removed folder override for ${name}.`)}</span>
      <button
        type="button"
        onClick={onUndo}
        data-testid="mcp-folder-undo"
        className="px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)]"
      >
        {t("mcpFolderUndo", undefined, "Undo")}
      </button>
    </div>
  );
}

interface FolderEditorProps {
  editing: EditingState | null;
  server: EffectiveServerView | null;
  isAdd: boolean;
  readOnly: boolean;
  scope: Scope;
  onClose: () => void;
  onChanged: () => void;
  onRemoveOverride: () => void;
}

function FolderEditor({
  editing,
  server,
  isAdd,
  readOnly,
  scope,
  onClose,
  onChanged,
  onRemoveOverride,
}: FolderEditorProps): React.ReactElement | null {
  if (editing === null) return null;
  const inheritedFields = server ? inheritedFieldsOf(server) : undefined;
  const inheritedLayer = server ? inheritedLayerOf(server) : undefined;
  const folderOwned = server !== null && isFolderOwned(server);
  return (
    <ServerEditor
      key={`${editing.name}:${editing.mode}`}
      name={isAdd ? null : (server?.name ?? null)}
      entry={server?.entry ?? {}}
      editable={isAdd || folderOwned}
      readOnly={readOnly}
      scope={scope}
      initialMode="edit"
      inherited={
        inheritedFields && inheritedLayer
          ? { fields: inheritedFields, layer: inheritedLayer }
          : undefined
      }
      onRemoveOverride={folderOwned ? onRemoveOverride : undefined}
      dialogTestId="mcp-folder-editor"
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

/** The provenance legend / layer note under the list. */
function FolderSummary({ view }: { view: EffectiveView }): React.ReactElement {
  const t = useT();
  const overrides = view.servers.filter((s) => isFolderOwned(s)).length;
  return (
    <p data-testid="mcp-folder-summary" className="text-[10px] text-[var(--text-tertiary)] m-0">
      {t(
        "mcpFolderSummary",
        { count: overrides },
        `Inherited from global unless overridden · ${overrides} folder override(s)`,
      )}
    </p>
  );
}

function FolderMcpPageBody({ cwd }: { cwd: string }): React.ReactElement {
  const t = useT();
  const { view, loading, error, reload } = useEffectiveConfig(cwd);
  const status = useAdapterStatus(view?.adapter);
  const narrow = useIsNarrow();
  const actions = useFolderActions(cwd, view, reload);

  const errorState = folderErrorState(error, reload, t);
  if (errorState) return errorState;

  const servers = view?.servers ?? [];
  const isAdd = actions.editing?.name === "";
  const editingServer =
    actions.editing && !isAdd
      ? (servers.find((s) => s.name === actions.editing?.name) ?? null)
      : null;

  return (
    <div className="space-y-2">
      {!status.ok && <ReadOnlyBanner status={status} />}
      {actions.actionError && (
        <p
          data-testid="mcp-folder-action-error"
          role="alert"
          className="text-[11px] text-[var(--status-error,#f87171)] m-0"
        >
          {actions.actionError}
        </p>
      )}

      <ServerList
        servers={servers}
        layerErrors={view?.layerErrors ?? []}
        loading={loading}
        readOnly={status.readOnly}
        scope={actions.scope}
        chipsRemovable={!narrow}
        onOpen={actions.open}
        onAdd={actions.openAdd}
        onRemoveOverride={actions.removeOverride}
        onChanged={actions.refreshed}
      />

      {actions.undo && <UndoToast name={actions.undo.name} onUndo={actions.undoRemove} />}

      <FolderEditor
        editing={actions.editing}
        server={editingServer}
        isAdd={isAdd}
        readOnly={status.readOnly}
        scope={actions.scope}
        onClose={actions.closeEditor}
        onChanged={actions.refreshed}
        onRemoveOverride={() => editingServer && actions.removeOverride(editingServer.name)}
      />

      {view && <FolderSummary view={view} />}
    </div>
  );
}

export function FolderMcpPage({ params, onBack }: FolderMcpPageProps): React.ReactElement {
  const cwd = decodeFolderCwd(params.encodedCwd);
  return (
    <section data-testid="mcp-folder-page" className="p-3 space-y-2">
      <PageHeader onBack={onBack} />
      {cwd === null ? <NotAllowed /> : <FolderMcpPageBody cwd={cwd} />}
    </section>
  );
}
