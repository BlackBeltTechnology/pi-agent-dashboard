import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { ActionList } from "@blackbelt-technology/pi-dashboard-client-utils/ActionList";
import { ActionListMenuContext } from "@blackbelt-technology/pi-dashboard-client-utils/ActionListMenuContext";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useContext, useEffect, useRef } from "react";
import { FlowActionDialogs, type FlowActions, useFlowActions } from "./useFlowActions.js";

/**
 * Pure menu gate: the session actions menu items this plugin contributes.
 * Nothing while the catalog or edit mode is unknown, or when the catalog lists
 * flows (the dock chip and panel headers own flow actions then). A flowless
 * session gets exactly one item: New flow… (edit mode on) or "Turn on edit
 * mode for this project" (off). See change: flows-dock-chip-and-panel-actions.
 */
export function flowMenuItems(
  t: ReturnType<typeof useT>,
  a: Pick<FlowActions, "catalogKnown" | "hasFlows" | "editMode" | "newFlow" | "setEditMode">,
) {
  if (!a.catalogKnown || a.hasFlows || a.editMode === undefined) return [];
  if (a.editMode) return [{ label: t("newFlowItem", undefined, "New flow…"), icon: "mdiPlus", onClick: a.newFlow }];
  return [
    {
      label: t("projectEditModeOn", undefined, "Turn on edit mode for this project"),
      icon: "mdiPencilOutline",
      tooltip: t(
        "projectEditModeHint",
        undefined,
        "Writes flows.editFlow to this project's .pi/settings.json. The project value then overrides the global default.",
      ),
      onClick: () => a.setEditMode(true),
    },
  ];
}

/**
 * `session-card-action-bar` claim: the flowless entry point in the session
 * actions menu (see `flowMenuItems`), plus the dialogs it opens (portaled; the
 * claim stays mounted for the card's lifetime so they survive the menu
 * closing). Opening the menu asks the session for its catalog and re-reads the
 * effective edit mode. It never sends an edit-mode message on its own.
 *
 * See change: add-session-actions-flyout; stop-flows-edit-mode-project-writes;
 * flows-dock-chip-and-panel-actions (D6).
 */
export function SessionFlowMenuClaim({ session }: { session: DashboardSession }) {
  const t = useT();
  const menuOpen = useContext(ActionListMenuContext)?.open;
  const actions = useFlowActions(session.id, { editModeWhen: "flowless", menuOpen });

  // Ask for the catalog on each menu closed → open transition.
  const wasOpen = useRef(menuOpen);
  const { refreshCatalog } = actions;
  useEffect(() => {
    if (menuOpen && !wasOpen.current) refreshCatalog();
    wasOpen.current = menuOpen;
  }, [menuOpen, refreshCatalog]);

  const items = flowMenuItems(t, actions);
  return (
    <>
      {items.length > 0 && <ActionList actions={items} />}
      <FlowActionDialogs actions={actions} />
    </>
  );
}
