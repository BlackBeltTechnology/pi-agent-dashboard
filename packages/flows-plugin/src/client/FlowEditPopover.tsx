/**
 * The pencil popover body (authoring items + per-project edit-mode item) for
 * `FlowEditMenu`. Click-only, so it is a lazy chunk loaded the first time the
 * pencil opens; the eager dock chip stays small. Uses the host `ui:popover`.
 *
 *   - edit mode unknown → a loading line, no authoring items;
 *   - off → only "Turn on edit mode for this project";
 *   - on → Edit…, New flow…, Delete… (only with `flows:delete`), then
 *     "Turn off edit mode for this project".
 *
 * Keyboard: focus moves to the first item, ArrowUp/Down move, Escape (via the
 * popover) closes and returns focus to the pencil.
 * See change: flows-dock-chip-and-panel-actions (D7).
 */
import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { mdiDeleteOutline, mdiPencilOff, mdiPencilOutline, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type KeyboardEvent, useCallback, useEffect, useRef } from "react";
import type { FlowActions } from "./useFlowActions.js";

export function FlowEditPopover({
  actions,
  anchorEl,
  onClose,
  testIdPrefix,
}: {
  actions: FlowActions;
  anchorEl: HTMLElement;
  /** `refocus` = return focus to the pencil (Escape / outside click). */
  onClose: (refocus: boolean) => void;
  testIdPrefix: string;
}) {
  const t = useT();
  const Popover = useUiPrimitive(UI_PRIMITIVE_KEYS.popover);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const label = t("editFlowsButton", undefined, "Edit…");
  const pick = (fn: () => void) => () => {
    onClose(false);
    fn();
  };

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
    focusFirst();
  }, [actions.editMode, focusFirst]);

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
    <Popover anchorEl={anchorEl} onDismiss={() => onClose(true)}>
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
  );
}
