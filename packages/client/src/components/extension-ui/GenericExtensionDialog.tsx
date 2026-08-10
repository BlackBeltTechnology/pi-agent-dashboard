/**
 * GenericExtensionDialog — Phase-1 modal renderer for the Extension UI
 * System. Renders a single `ExtensionUiModule` whose `view.kind` is one of
 * `"table" | "grid" | "form"`. See change: add-extension-ui-modal.
 *
 * Lifecycle:
 *   - Mount: for `table`/`grid`, dispatch `ui_management { action: "list",
 *           event: view.dataEvent }` to fetch rows. For `form`, no data
 *           fetch.
 *   - On `ui_data_list` arrival, the parent updates
 *     `session.uiDataMap[event]` and we re-render rows from there.
 *   - Action click:
 *       * If `action.confirm`, mount ConfirmDialog first; only confirm
 *         dispatches `ui_management { action: id, event, params }`.
 *       * Otherwise dispatch immediately.
 *
 * The component is purely presentational + IO-via-dispatcher; it never
 * touches the WebSocket directly. The parent (App.tsx) closes it via
 * `onClose`.
 */

import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type { ExtensionUiModule, UiAction, UiField, UiSection, UiView } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { resolveMdiIcon } from "../../lib/preview/mdi-icon-lookup.js";
import { DialogPortal } from "../primitives/DialogPortal.js";

interface Props {
  module: ExtensionUiModule;
  /** Latest `items` for `view.dataEvent`. Re-rendered on parent updates. */
  rows: unknown[];
  /** Send a `ui_management` message to the bridge (via the server). */
  onDispatch: (msg: { action: string; event: string; params?: Record<string, unknown> }) => void;
  /** Close the modal. */
  onClose: () => void;
}

export function GenericExtensionDialog({ module, rows, onDispatch, onClose }: Props) {
  const view = module.view;

  // Mount-time data fetch for table/grid views.
  useEffect(() => {
    if ((view.kind === "table" || view.kind === "grid") && view.dataEvent) {
      onDispatch({ action: "list", event: view.dataEvent });
    }
    // We intentionally only run on mount. The parent re-renders us with new
    // `rows` when `ui_data_list` arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="extension-ui-dialog">
        <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onClose} />
        <div className="relative bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-xl w-[95vw] max-w-3xl max-h-[85vh] flex flex-col">
          <ModuleHeader module={module} onClose={onClose} />
          <div className="flex-1 overflow-y-auto p-4">
            <ViewBody view={view} rows={rows} onDispatch={onDispatch} />
          </div>
          {(view.actions?.length ?? 0) > 0 && (
            <ActionToolbar actions={view.actions ?? []} onDispatch={onDispatch} />
          )}
        </div>
      </div>
    </DialogPortal>
  );
}

function ModuleHeader({ module, onClose }: { module: ExtensionUiModule; onClose: () => void }) {
  const iconPath = resolveMdiIcon(module.icon);
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)]">
      {iconPath && <Icon path={iconPath} size={0.7} className="text-[var(--text-secondary)]" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)] truncate">{module.title}</div>
        {module.description && (
          <div className="text-xs text-[var(--text-tertiary)] truncate">{module.description}</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1"
        aria-label={i18nT("common.close", undefined, "Close")}
        data-testid="extension-ui-close"
      >
        <Icon path={mdiClose} size={0.7} />
      </button>
    </div>
  );
}

function ActionToolbar({ actions, onDispatch }: { actions: UiAction[]; onDispatch: Props["onDispatch"] }) {
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-[var(--border-primary)]">
      {actions.map((a) => (
        <ActionButton key={a.id} action={a} onDispatch={onDispatch} />
      ))}
    </div>
  );
}

function ActionButton({ action, onDispatch, compact }: { action: UiAction; onDispatch: Props["onDispatch"]; compact?: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const iconPath = resolveMdiIcon(action.icon);
  const variantClass =
    action.variant === "danger"
      ? "bg-red-600 hover:bg-red-500 text-[var(--text-primary)]"
      : action.variant === "primary"
        ? "bg-blue-600 hover:bg-blue-500 text-[var(--text-primary)]"
        : "border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
  const sizeClass = compact ? "text-[10px] px-1.5 py-0.5" : "text-xs px-3 py-1.5";

  const handleClick = useCallback(() => {
    if (action.confirm) {
      setConfirmOpen(true);
      return;
    }
    onDispatch({ action: action.id, event: action.event, params: action.params });
  }, [action, onDispatch]);

  return (
    <>
      <button
        onClick={handleClick}
        className={`rounded inline-flex items-center gap-1 ${sizeClass} ${variantClass}`}
        data-testid={`extension-ui-action-${action.id}`}
      >
        {iconPath && <Icon path={iconPath} size={0.45} />}
        {action.label}
      </button>
      {confirmOpen && action.confirm && (
        <Confirm
          open
          title={i18nT("common.confirm", undefined, "Confirm")}
          testId="confirm-dialog"
          message={action.confirm}
          confirmLabel={action.label}
          onConfirm={() => {
            setConfirmOpen(false);
            onDispatch({ action: action.id, event: action.event, params: action.params });
          }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}

function ViewBody({ view, rows, onDispatch }: { view: UiView; rows: unknown[]; onDispatch: Props["onDispatch"] }) {
  if (view.kind === "table") return <TableView view={view} rows={rows} onDispatch={onDispatch} />;
  if (view.kind === "grid") return <GridView view={view} rows={rows} onDispatch={onDispatch} />;
  if (view.kind === "form") return <FormView view={view} />;
  return null;
}

function TableView({ view, rows, onDispatch }: { view: UiView; rows: unknown[]; onDispatch: Props["onDispatch"] }) {
  const fields = view.fields ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-[var(--text-tertiary)] py-6 text-center" data-testid="extension-ui-empty">
        {view.emptyState ?? "No items."}
      </div>
    );
  }
  return (
    <table className="w-full text-xs" data-testid="extension-ui-table">
      <thead>
        <tr className="border-b border-[var(--border-primary)] text-[var(--text-tertiary)]">
          {fields.map((f) => (
            <th key={f.key} className="text-left font-medium px-2 py-1.5" style={{ width: f.width }}>
              {f.label}
            </th>
          ))}
          {(view.rowActions?.length ?? 0) > 0 && <th className="text-right px-2 py-1.5">{i18nT("common.actions", undefined, "Actions")}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={getRowKey(row, view, idx)} className="border-b border-[var(--border-primary)]/50">
            {fields.map((f) => (
              <td key={f.key} className="px-2 py-1.5 text-[var(--text-secondary)] align-top">
                {formatCell(getDeep(row, f.key), f)}
              </td>
            ))}
            {(view.rowActions?.length ?? 0) > 0 && (
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                <div className="inline-flex items-center gap-1">
                  {(view.rowActions ?? []).map((a) => (
                    <ActionButton
                      key={a.id}
                      action={withRowParams(a, row)}
                      onDispatch={onDispatch}
                      compact
                    />
                  ))}
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GridView({ view, rows, onDispatch }: { view: UiView; rows: unknown[]; onDispatch: Props["onDispatch"] }) {
  const fields = view.fields ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-[var(--text-tertiary)] py-6 text-center" data-testid="extension-ui-empty">
        {view.emptyState ?? "No items."}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="extension-ui-grid">
      {rows.map((row, idx) => (
        <div
          key={getRowKey(row, view, idx)}
          className="border border-[var(--border-primary)] rounded p-3 text-xs flex flex-col gap-1.5 bg-[var(--bg-tertiary)]/40"
        >
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{f.label}</div>
              <div className="text-[var(--text-secondary)] truncate">{formatCell(getDeep(row, f.key), f)}</div>
            </div>
          ))}
          {(view.rowActions?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1 mt-2">
              {(view.rowActions ?? []).map((a) => (
                <ActionButton key={a.id} action={withRowParams(a, row)} onDispatch={onDispatch} compact />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FormView({ view }: { view: UiView }) {
  // Phase-1 form view is read-only display. Form *submission* lands in Phase 4
  // (RJSF). For now the form renders fields with their declared labels and
  // current default values so extensions can present configuration that the
  // user invokes via toolbar `view.actions` (e.g. a "Save" button).
  const sections: UiSection[] = view.sections ?? (view.fields ? [{ id: "_default", fields: view.fields }] : []);
  return (
    <div className="space-y-4" data-testid="extension-ui-form">
      {sections.map((section) => (
        <div key={section.id} className="space-y-2">
          {(section.title || section.description) && (
            <div className="space-y-0.5">
              {section.title && <div className="text-sm font-medium text-[var(--text-primary)]">{section.title}</div>}
              {section.description && <div className="text-xs text-[var(--text-tertiary)]">{section.description}</div>}
            </div>
          )}
          <div className="space-y-2">
            {section.fields.map((f) => (
              <FormField key={f.key} field={f} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FormField({ field }: { field: UiField }) {
  // Phase-1: render a labelled, read-only-style field. Wire-up to a real form
  // state happens when an extension adds `view.actions` that submit values
  // (Phase 4 / RJSF replaces this entirely).
  const baseClass = "w-full text-xs px-2 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-secondary)] text-[var(--text-secondary)]";
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {field.label}{field.required ? " *" : ""}
      </span>
      {field.kind === "boolean" ? (
        <input type="checkbox" disabled={field.readOnly} />
      ) : field.kind === "select" ? (
        <select className={baseClass} disabled={field.readOnly}>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.kind === "textarea" || field.multiline ? (
        <textarea className={baseClass} placeholder={field.placeholder} disabled={field.readOnly} rows={3} />
      ) : field.kind === "code" ? (
        <textarea
          className={`${baseClass} font-mono`}
          placeholder={field.placeholder}
          disabled={field.readOnly}
          rows={4}
          data-language={field.language}
        />
      ) : field.kind === "number" ? (
        <input type="number" className={baseClass} placeholder={field.placeholder} disabled={field.readOnly} />
      ) : field.kind === "datetime" ? (
        <input type="datetime-local" className={baseClass} disabled={field.readOnly} />
      ) : (
        <input type="text" className={baseClass} placeholder={field.placeholder} disabled={field.readOnly} />
      )}
    </label>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function getDeep(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  if (!key.includes(".")) return (obj as Record<string, unknown>)[key];
  let cur: any = obj;
  for (const part of key.split(".")) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function getRowKey(row: unknown, view: UiView, idx: number): string {
  const k = view.rowKey ?? "id";
  const v = getDeep(row, k);
  return typeof v === "string" || typeof v === "number" ? String(v) : String(idx);
}

function formatCell(v: unknown, field: UiField): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (field.kind === "datetime" && typeof v === "number") {
    return new Date(v).toLocaleString();
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Merge `params` with the row's payload so per-row actions can carry
 * row-identity (`{ rowId: row[rowKey] }`) without forcing extensions to
 * embed it manually.
 */
function withRowParams(action: UiAction, row: unknown): UiAction {
  const rowParams = (typeof row === "object" && row != null) ? { row } : {};
  return {
    ...action,
    params: { ...rowParams, ...(action.params ?? {}) },
  };
}
