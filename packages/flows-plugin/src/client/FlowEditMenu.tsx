/**
 * The pencil (Edit…) button and its authoring popover, shared by the dock chip
 * and both flow panel headers. Uses the host `ui:popover` primitive.
 *
 *   - edit mode unknown → a loading line, no authoring items;
 *   - off → only "Turn on edit mode for this project";
 *   - on → Edit…, New flow…, Delete… (only with `flows:delete`), then
 *     "Turn off edit mode for this project".
 *
 * Keyboard: opening moves focus to the first item, ArrowUp/Down move, Escape
 * (via the popover) closes and returns focus to the pencil. The caller owns
 * `open` so it can feed it to `useFlowActions({ menuOpen })` (edit mode is
 * re-read on each closed → open transition).
 *
 * See change: flows-dock-chip-and-panel-actions (D7).
 */
import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { mdiDeleteOutline, mdiPencil, mdiPencilOff, mdiPencilOutline, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type KeyboardEvent, useCallback, useEffect, useRef } from "react";
import type { FlowActions } from "./useFlowActions.js";

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
  const Popover = useUiPrimitive(UI_PRIMITIVE_KEYS.popover);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = t("editFlowsButton", undefined, "Edit…");

  const close = (refocus: boolean) => {
    onOpenChange(false);
    if (refocus) btnRef.current?.focus();
  };
  const pick = (fn: () => void) => () => {
    close(false);
    fn();
  };

  // Focus the first item once the menu is in the DOM (the popover mounts its
  // content in a layer portal after positioning, so an effect can run first),
  // and again when the items change from the loading line.
  // The popover stays `visibility: hidden` until it has positioned itself, and
  // a hidden element cannot take focus: retry for a few frames.
  const focusFirst = useCallback(() => {
    let frames = 0;
    const attempt = () => {
      const menu = menuRef.current;
      if (!menu || menu.contains(document.activeElement)) return;
      const first = menu.querySelector<HTMLElement>('[role="menuitem"]');
      first?.focus();
      if (first && document.activeElement !== first && frames++ < 10) requestAnimationFrame(attempt);
    };
    attempt();
  }, []);
  const setMenuEl = useCallback(
    (el: HTMLDivElement | null) => {
      menuRef.current = el;
      if (el) focusFirst();
    },
    [focusFirst],
  );
  useEffect(() => {
    if (open) focusFirst();
  }, [open, actions.editMode, focusFirst]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const editMode = actions.editMode;
  const item = (id: string, text: string, icon: string, onClick: () => void, title?: string) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      data-testid={`${testIdPrefix}-${id}`}
      title={title}
      onClick={pick(onClick)}
      className="flex w-full min-h-7 items-center gap-2 rounded px-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:outline-none"
    >
      <Icon path={icon} size={0.55} aria-hidden="true" />
      {text}
    </button>
  );

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
        <Popover anchorEl={btnRef.current} onDismiss={() => close(true)}>
          <div
            ref={setMenuEl}
            role="menu"
            aria-label={label}
            data-testid={`${testIdPrefix}-popover`}
            onKeyDown={onKeyDown}
            className="min-w-[220px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1 shadow-lg"
          >
            {editMode === undefined ? (
              <p data-testid={`${testIdPrefix}-loading`} className="px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                {t("editModeLoading", undefined, "Checking edit mode…")}
              </p>
            ) : (
              <>
                {editMode && item("edit", t("editFlowItem", undefined, "Edit…"), mdiPencilOutline, actions.edit)}
                {editMode && item("new", t("newFlowItem", undefined, "New flow…"), mdiPlus, actions.newFlow)}
                {editMode && actions.canDelete && item("delete", `${t("delete", undefined, "Delete")}…`, mdiDeleteOutline, actions.remove)}
                {item(
                  "edit-mode",
                  editMode
                    ? t("projectEditModeOff", undefined, "Turn off edit mode for this project")
                    : t("projectEditModeOn", undefined, "Turn on edit mode for this project"),
                  editMode ? mdiPencilOff : mdiPencilOutline,
                  () => actions.setEditMode(!editMode),
                  t(
                    "projectEditModeHint",
                    undefined,
                    "Writes flows.editFlow to this project's .pi/settings.json. The project value then overrides the global default.",
                  ),
                )}
              </>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
