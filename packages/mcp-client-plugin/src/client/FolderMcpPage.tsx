/**
 * FolderMcpPage — `shell-overlay-route` claim at `/folder/:encodedCwd/mcp`.
 *
 * The effective MCP configuration for one folder cwd with pi's two layers.
 * Admission is server-side only: the route decodes the cwd and the
 * effective-view request is refused (403) for a folder the host does not
 * track, so the page renders a not-allowed empty state with NO retry and no
 * data. Rows carry provenance badges (Pi global / Pi folder) and the
 * whole-entry replace marker; a global row's "Replace with folder entry…" opens
 * the editor pre-filled with the complete global entry minus secrets + `auth`,
 * each omission flagged, and its "Project settings…" opens the project-override
 * panel (enabled + exposure, credentials untouched). An untrusted folder shows a
 * notice (dashboard-spawned headless sessions trust the folder per run) while
 * editing stays allowed. Folder writes are project-scope only; a folder enable
 * of a whole-entry copy that needs re-entered secrets offers remove-or-reenter
 * (or convert, for a legacy copy); Remove / Reset / Convert keep an undo toast
 * that restores the exact prior entry (override rows via the project-override
 * route, whole entries via the generic PUT).
 *
 * See change: migrate-mcp-to-pi-builtin; mcp-client-project-overrides.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useMemo, useState } from "react";
import { isProjectOverride } from "../core/pi-rules.js";
import type { EffectiveServerView, EffectiveView, Provenance, Scope } from "../core/types.js";
import { ApiError, convertToOverride, removeServer, saveServer, scopeToWire, setProjectOverride } from "./api.js";
import { folderOverrideDraftOf, isFolderOwned, overrideRestorePatch } from "./folder-view.js";
import { invalidateEffective, useEffectiveConfig } from "./hooks.js";
import { ProjectSettingsPanel } from "./ProjectSettings.js";
import { ServerEditor } from "./ServerEditor.js";
import type { RowRef } from "./ServerList.js";
import { ServerList } from "./ServerList.js";
import { useIsNarrow } from "./useIsNarrow.js";

export interface FolderMcpPageProps {
  params: Record<string, string>;
  session?: unknown;
  onBack: () => void;
}

/** Decode the route's `encodedCwd`; a malformed encode is not a valid cwd. */
function decodeFolderCwd(encoded: string | undefined): string | null {
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

function UntrustedNotice(): React.ReactElement {
  const t = useT();
  return (
    <div
      data-testid="mcp-folder-untrusted"
      role="status"
      className="text-[11px] px-2 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
    >
      {t(
        "mcpFolderUntrusted",
        undefined,
        "pi does not trust this project yet: folder servers stay inactive until the project is trusted. Headless sessions the dashboard starts in this folder trust it per run. Editing <cwd>/.pi/mcp.json stays allowed.",
      )}
    </div>
  );
}

interface EditingState {
  /** The row name; "" = add. */
  name: string;
  entry: Record<string, unknown>;
  /** Dotted fields the override pre-fill dropped (warnings in the editor). */
  omitted?: string[];
}

interface UndoState {
  name: string;
  /** The exact prior entry: an override (restored via the override route) or a whole entry. */
  removed: Record<string, unknown>;
  message: string;
}

interface ChoiceState {
  row: RowRef;
  omitted: string[];
}

/** The editor pre-fill for a row: the folder's own entry, or the override copy. */
function prefillFor(server: { name: string; provenance: Provenance; entry: Record<string, unknown> } | null): EditingState {
  if (server === null) return { name: "", entry: {} };
  if (isFolderOwned(server.provenance)) return { name: server.name, entry: server.entry };
  // A global row: the override pre-fill drops secrets + auth and flags them.
  const { draft, omitted } = folderOverrideDraftOf(server.entry);
  return { name: server.name, entry: draft, omitted };
}

interface FolderActions {
  editing: EditingState | null;
  undo: UndoState | null;
  choice: ChoiceState | null;
  projectPanel: string | null;
  actionError: string | null;
  scope: Scope;
  open: (name: string, provenance: Provenance) => void;
  openAdd: () => void;
  closeEditor: () => void;
  removeOverride: (name: string) => void;
  undoRemove: () => void;
  resolveChoiceRemove: () => void;
  resolveChoiceReenter: () => void;
  resolveChoiceConvert: () => void;
  onNeedsChoice: (row: RowRef, omitted: string[]) => void;
  openProjectSettings: (name: string) => void;
  closeProjectSettings: () => void;
  reset: (name: string) => void;
  convertLegacy: (name: string) => void;
  refreshed: () => void;
}

/** Editing / choice / undo state for one folder page. */
function useFolderActions(
  cwd: string,
  view: EffectiveView | null,
  reload: () => void,
): FolderActions {
  const t = useT();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [choice, setChoice] = useState<ChoiceState | null>(null);
  const [projectPanel, setProjectPanel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scope = useMemo<Scope>(() => ({ kind: "project", cwd }), [cwd]);
  const refreshed = (): void => {
    invalidateEffective(cwd);
    reload();
  };

  async function removeOverride(name: string, message?: string): Promise<void> {
    setActionError(null);
    try {
      const res = await removeServer(name, scopeToWire(scope));
      setEditing(null);
      setChoice(null);
      setUndo({
        name,
        removed: res.removed ?? {},
        message: message ?? t("mcpFolderOverrideRemoved", { name }, `Removed folder override for ${name}.`),
      });
      refreshed();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function undoRemove(): Promise<void> {
    if (!undo) return;
    try {
      // An override (no command/url/type) is restored through the override route
      // with its absent keys as `null`; a whole entry goes through the generic PUT.
      if (isProjectOverride(undo.removed)) {
        await setProjectOverride(undo.name, overrideRestorePatch(undo.removed), scopeToWire(scope));
      } else {
        await saveServer(undo.name, { ...scopeToWire(scope), entry: undo.removed });
      }
      setUndo(null);
      refreshed();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function convertLegacy(name: string): Promise<void> {
    setActionError(null);
    try {
      const res = await convertToOverride(name, scopeToWire(scope));
      setChoice(null);
      // Undo re-PUTs the original copy (a full entry), which replaces the converted override.
      setUndo({
        name,
        removed: res.previous,
        message: t("mcpFolderConverted", { name }, `Converted ${name} to a project override.`),
      });
      refreshed();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return {
    editing,
    undo,
    choice,
    projectPanel,
    actionError,
    scope,
    open: (name, provenance) => {
      // Same-name rows (untrusted folder + global) are distinct: act on the
      // row the operator clicked.
      const server = view?.servers.find((s) => s.name === name && s.provenance === provenance) ?? null;
      setEditing(prefillFor(server));
    },
    openAdd: () => setEditing({ name: "", entry: {} }),
    closeEditor: () => setEditing(null),
    removeOverride: (name) => void removeOverride(name),
    undoRemove: () => void undoRemove(),
    resolveChoiceRemove: () => {
      if (choice) void removeOverride(choice.row.name);
    },
    resolveChoiceReenter: () => {
      if (!choice) return;
      // Re-enter on the FOLDER row (its own stored entry, verbatim).
      const server =
        view?.servers.find((s) => s.name === choice.row.name && s.provenance === "pi-folder") ??
        view?.servers.find((s) => s.name === choice.row.name) ??
        null;
      setChoice(null);
      setEditing(prefillFor(server));
    },
    resolveChoiceConvert: () => {
      if (choice) void convertLegacy(choice.row.name);
    },
    onNeedsChoice: (row, omitted) => setChoice({ row, omitted }),
    openProjectSettings: (name) => setProjectPanel(name),
    closeProjectSettings: () => setProjectPanel(null),
    reset: (name) =>
      void removeOverride(name, t("mcpFolderResetDone", { name }, `Reset ${name} to Pi global.`)),
    convertLegacy: (name) => void convertLegacy(name),
    refreshed,
  };
}

function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }): React.ReactElement {
  const t = useT();
  return (
    <div
      data-testid="mcp-folder-undo-toast"
      role="status"
      className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
    >
      <span>{message}</span>
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

/** A folder enable that cannot inherit the global entry's secrets. */
function NeedsChoicePanel({
  name,
  omitted,
  onRemove,
  onReenter,
  onConvert,
}: {
  name: string;
  omitted: string[];
  onRemove: () => void;
  onReenter: () => void;
  /** Present only for a legacy copy of the global entry. */
  onConvert?: () => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div
      data-testid="mcp-folder-needs-choice"
      role="alert"
      className="text-[11px] px-2 py-1.5 rounded border border-amber-500 text-[var(--text-secondary)] space-y-1"
    >
      <p className="m-0">
        {t(
          "mcpFolderNeedsChoice",
          { name, omitted: omitted.join(", ") },
          `Enabling ${name} at folder scope cannot inherit the global entry's secrets (${omitted.join(", ")}).`,
        )}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRemove}
          data-testid="mcp-choice-remove"
          className="px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)]"
        >
          {t("mcpChoiceRemove", undefined, "Remove folder entry (global applies again)")}
        </button>
        <button
          type="button"
          onClick={onReenter}
          data-testid="mcp-choice-reenter"
          className="px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]"
        >
          {t("mcpChoiceReenter", undefined, "Re-enter omitted values")}
        </button>
        {onConvert && (
          <button
            type="button"
            onClick={onConvert}
            data-testid="mcp-choice-convert"
            className="px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]"
          >
            {t("mcpChoiceConvert", undefined, "Convert to project override")}
          </button>
        )}
      </div>
    </div>
  );
}

/** The provenance legend under the list. */
function FolderSummary({ view }: { view: EffectiveView }): React.ReactElement {
  const t = useT();
  const overrides = view.servers.filter((s) => s.overridesGlobal).length;
  return (
    <p data-testid="mcp-folder-summary" className="text-[10px] text-[var(--text-tertiary)] m-0">
      {t(
        "mcpFolderSummary",
        { count: overrides },
        `A folder entry with a command or url replaces the global entry of the same name as a whole · ${overrides} replacement(s)`,
      )}
    </p>
  );
}

/** The global row the settings panel is open on, and whether the pending choice is a legacy copy. */
function pageDerivations(
  servers: EffectiveServerView[],
  panelName: string | null,
  choiceName: string | null,
): { panelServer: EffectiveServerView | null; legacyChoice: boolean } {
  const panelServer =
    panelName === null ? null : (servers.find((s) => s.name === panelName && s.provenance === "pi-global") ?? null);
  const legacyChoice =
    choiceName !== null && servers.some((s) => s.name === choiceName && s.provenance === "pi-folder" && s.legacyCopy === true);
  return { panelServer, legacyChoice };
}

function FolderMcpPageBody({ cwd }: { cwd: string }): React.ReactElement {
  const t = useT();
  const { view, loading, error, reload } = useEffectiveConfig(cwd);
  const actions = useFolderActions(cwd, view, reload);
  const narrow = useIsNarrow();

  if (error instanceof ApiError && error.isNotAllowed) return <NotAllowed />;
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

  const servers = view?.servers ?? [];
  const { panelServer, legacyChoice } = pageDerivations(servers, actions.projectPanel, actions.choice?.row.name ?? null);

  return (
    <div className="space-y-2">
      {view?.trusted === false && <UntrustedNotice />}
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
        layers={view?.layers ?? []}
        loading={loading}
        scope={actions.scope}
        onOpen={actions.open}
        onAdd={actions.openAdd}
        onChanged={actions.refreshed}
        onNeedsChoice={actions.onNeedsChoice}
        onRemoveOverride={actions.removeOverride}
        chipsRemovable={!narrow}
        onProjectSettings={actions.openProjectSettings}
        onReset={actions.reset}
        onConvertLegacy={actions.convertLegacy}
        untrusted={view?.trusted === false}
        narrow={narrow}
      />

      {actions.choice && (
        <NeedsChoicePanel
          name={actions.choice.row.name}
          omitted={actions.choice.omitted}
          onRemove={actions.resolveChoiceRemove}
          onReenter={actions.resolveChoiceReenter}
          {...(legacyChoice ? { onConvert: actions.resolveChoiceConvert } : {})}
        />
      )}

      {actions.undo && <UndoToast message={actions.undo.message} onUndo={actions.undoRemove} />}

      {panelServer && (
        <ProjectSettingsPanel
          key={panelServer.name}
          server={panelServer}
          scope={actions.scope as Extract<Scope, { kind: "project" }>}
          narrow={narrow}
          onClose={actions.closeProjectSettings}
          onSaved={actions.refreshed}
        />
      )}

      {actions.editing && (
        <ServerEditor
          key={actions.editing.name}
          name={actions.editing.name === "" ? null : actions.editing.name}
          entry={actions.editing.entry}
          omitted={actions.editing.omitted}
          scope={actions.scope}
          dialogTestId="mcp-folder-editor"
          onClose={actions.closeEditor}
          onChanged={actions.refreshed}
        />
      )}

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
