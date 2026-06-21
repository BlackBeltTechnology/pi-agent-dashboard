/**
 * Sidebar-folder section: "Automations (N) →" entry per workspace folder.
 *
 * Counts the automations visible to this folder (per-folder + global) and
 * renders an "Automations (N) →" nav entry (in the folder header, beside the
 * New Session button) that opens the automation board. Always renders when
 * the plugin is enabled (even at N=0) so it doubles as the create entry
 * point; it is absent entirely only when the plugin is disabled (the slot
 * claim is then unregistered). See change: add-automation-plugin.
 */
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { listAutomations } from "./api.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

/** URL the board command-route is reachable at. */
export const AUTOMATION_BOARD_ROUTE = "/automation";

export function FolderAutomationSection({
  folder,
}: {
  folder: FolderDescriptor;
}): React.ReactElement | null {
  const [automations, setAutomations] = useState<DiscoveredAutomation[] | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let cancelled = false;
    listAutomations(folder.cwd).then((a) => {
      if (!cancelled) setAutomations(a);
    });
    return () => {
      cancelled = true;
    };
  }, [folder.cwd]);

  // Render nothing until the first load resolves (avoids a flash); after that
  // always render (even at count 0) so the board — and its Create Automation
  // action — stays reachable beside New Session.
  if (automations === null) return null;
  const invalid = automations.filter((a) => !a.valid).length;

  return (
    <button
      type="button"
      data-testid="folder-automation-section"
      onClick={() => setLocation(`${AUTOMATION_BOARD_ROUTE}?cwd=${encodeURIComponent(folder.cwd)}`)}
      className="flex w-full items-center justify-between px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(0,0,0,0.04))] rounded"
    >
      <span className="font-medium">
        Automations ({automations.length})
        {invalid > 0 && (
          <span className="ml-1 text-[var(--danger,#ef4444)]" title={`${invalid} invalid`}>
            ⚠ {invalid}
          </span>
        )}
      </span>
      <span aria-hidden>→</span>
    </button>
  );
}
