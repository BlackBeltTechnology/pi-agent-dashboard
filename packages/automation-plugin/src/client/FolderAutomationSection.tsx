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

import { SlotPill, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiCogOutline, mdiPlus, mdiRefresh } from "@mdi/js";
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
      <SlotPill
        glyph={mdiCogOutline}
        accent="blue"
        label={t("automations", undefined, "Automations")}
        activateTestId="folder-automation-open-board"
        activateTitle={t("openBoardTitle", undefined, "Open automation board")}
        onActivate={() => setLocation(`/folder/${encodeFolderPath(folder.cwd)}/automations`)}
        actions={
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setReloadKey((k) => k + 1); }}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1"
              title={t("refresh", undefined, "Refresh")}
              data-testid="folder-automation-refresh"
            >
              <Icon path={mdiRefresh} size={0.5} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setCreating(true); }}
              className="text-[10px] px-1 py-0.5 rounded border text-blue-400 border-blue-500/40 bg-blue-500/5 hover:text-blue-300 hover:border-blue-500/70"
              data-testid="folder-automation-new-btn"
              title={t("new", undefined, "New automation")}
              aria-label={t("new", undefined, "New automation")}
            >
              <Icon path={mdiPlus} size={0.5} />
            </button>
          </>
        }
      >
        <span data-testid="folder-automation-count">{automations.length}</span>
        <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{t("automationsUnit", undefined, "tasks")}</span>
        {invalid > 0 && (
          <span className="text-[10px] font-extrabold text-amber-400" title={t("invalidTitle", { count: invalid }, `${invalid} invalid`)}>
            ⚠ {invalid}
          </span>
        )}
      </SlotPill>

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
