/**
 * Sidebar-folder section: "AUTOMATIONS (N) →" entry per workspace folder.
 *
 * Mirrors `FolderOpenSpecSection` anatomy (10px uppercase title + count + →,
 * refresh icon, flex-1 spacer, right-aligned blue `+ New` chip) so the two
 * folder rows read as siblings. Title navigates to the full-page board via
 * the `shell-overlay-route` `/folder/:encodedCwd/automations`; `+ New` opens
 * the create editor directly (no need to open the board first).
 *
 * Always renders once the first load resolves (even at N=0) so it doubles as
 * the create entry point; absent entirely only when the plugin is disabled.
 * See change: add-automation-plugin, fix-automation-slot-parity-and-routing.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiArrowRight, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { DiscoveredAutomation } from "../shared/automation-types.js";
import { listAutomations } from "./api.js";
import { CreateAutomationDialog } from "./CreateAutomationDialog.js";
import { encodeFolderPath } from "./folder-encoding.js";

export function FolderAutomationSection({
  folder,
}: {
  folder: FolderDescriptor;
}): React.ReactElement | null {
  const [automations, setAutomations] = useState<DiscoveredAutomation[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [, setLocation] = useLocation();
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    listAutomations(folder.cwd)
      .then((a) => {
        if (!cancelled) setAutomations(a);
      })
      .catch(() => {
        // Fall back to an empty list so the row still renders as the create
        // entry point instead of staying null (blank) forever.
        if (!cancelled) setAutomations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [folder.cwd, reloadKey]);

  // Render nothing until the first load resolves (avoids a flash); after that
  // always render (even at count 0) so the board — and its Create Automation
  // action — stays reachable beside New Session.
  if (automations === null) return null;
  const invalid = automations.filter((a) => !a.valid).length;

  return (
    <div data-testid="folder-automation-section" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mt-1">
        <button
          data-testid="folder-automation-open-board"
          onClick={(e) => {
            e.stopPropagation();
            setLocation(`/folder/${encodeFolderPath(folder.cwd)}/automations`);
          }}
          className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase hover:text-blue-400"
          title={t("openBoardTitle", undefined, "Open automation board")}
        >
          <span>
            {t("automations", undefined, "Automations")} ({automations.length})
            {invalid > 0 && (
              <span className="ml-1 text-[var(--danger,#ef4444)]" title={t("invalidTitle", { count: invalid }, `${invalid} invalid`)}>
                ⚠ {invalid}
              </span>
            )}
          </span>
          <Icon path={mdiArrowRight} size={0.45} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setReloadKey((k) => k + 1);
          }}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={t("refresh", undefined, "Refresh")}
          data-testid="folder-automation-refresh"
        >
          <Icon path={mdiRefresh} size={0.5} />
        </button>
        <span className="flex-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            setCreating(true);
          }}
          className="text-[10px] px-1.5 py-0.5 rounded border text-blue-400 border-blue-500/40 bg-blue-500/5 hover:text-blue-300 hover:border-blue-500/70"
          data-testid="folder-automation-new-btn"
        >
          {t("new", undefined, "+ New")}
        </button>
      </div>

      {creating && (
        <CreateAutomationDialog
          cwd={folder.cwd}
          onClose={() => setCreating(false)}
          onCreated={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
