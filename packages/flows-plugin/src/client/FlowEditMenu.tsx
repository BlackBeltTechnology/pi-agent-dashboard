/**
 * The pencil (Edit…) button shared by the dock chip and both flow panel
 * headers. Its authoring popover (`FlowEditPopover.tsx`) is a lazy chunk
 * loaded on first open. The caller owns `open` so it can feed it to
 * `useFlowActions({ menuOpen })` (edit mode is re-read on each closed → open
 * transition); opening also asks the session for its catalog.
 *
 * See change: flows-dock-chip-and-panel-actions (D7).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiPencil } from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense, useRef } from "react";
import type { FlowActions } from "./useFlowActions.js";

const FlowEditPopover = lazy(() => import("./FlowEditPopover.js").then((m) => ({ default: m.FlowEditPopover })));

/** Shared look for the small header / chip icon buttons (24 px dock minimum). */
export const FLOW_ICON_BUTTON_CLASS =
  "inline-flex items-center justify-center min-h-6 min-w-6 h-6 w-6 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-ring";

export function FlowEditMenu({
  actions,
  open,
  onOpenChange,
  testIdPrefix,
}: {
  actions: FlowActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testIdPrefix: string;
}) {
  const t = useT();
  const btnRef = useRef<HTMLButtonElement>(null);
  const label = t("editFlowsButton", undefined, "Edit…");

  const close = (refocus: boolean) => {
    onOpenChange(false);
    if (refocus) btnRef.current?.focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid={`${testIdPrefix}-button`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          // Opening asks the session for its catalog too (spec: flows-catalog).
          if (!open) actions.refreshCatalog();
          onOpenChange(!open);
        }}
        className={FLOW_ICON_BUTTON_CLASS}
      >
        <Icon path={mdiPencil} size={0.6} aria-hidden="true" />
      </button>
      {open && btnRef.current && (
        <Suspense fallback={null}>
          <FlowEditPopover actions={actions} anchorEl={btnRef.current} onClose={close} testIdPrefix={testIdPrefix} />
        </Suspense>
      )}
    </>
  );
}
