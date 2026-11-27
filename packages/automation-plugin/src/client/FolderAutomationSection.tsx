/**
 * Sidebar-folder section: "AUTOMATIONS (N) →" entry per workspace folder.
 *
 * The pill is STATE-ONLY: it shows the count and the invalid marker and
 * navigates to the full-page board via the `shell-overlay-route`
 * `/folder/:encodedCwd/automations`. Creating an automation is a `CREATE`-group
 * item in the folder actions menu that navigates to the board with its inline
 * draft open (`?new=1`), and the reload is a refresher folded into that menu's
 * single `MAINTENANCE` refresh.
 *
 * Always renders once the first load resolves (even at N=0); absent entirely
 * only when the plugin is disabled.
 * See change: add-automation-plugin, fix-automation-slot-parity-and-routing,
 * move-slot-actions-to-menu, inline-automation-editor.
 */

import {
  SlotPill,
  useFolderMenuItem,
  useFolderMenuRefresher,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { encodeFolderPath } from "@blackbelt-technology/dashboard-plugin-runtime/sdk";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiCogOutline, mdiPlus } from "@mdi/js";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { DiscoveredAutomation } from "../shared/automation-types.js";
import { listAutomations } from "./api.js";

export function FolderAutomationSection({
  folder,
}: {
  folder: FolderDescriptor;
}): React.ReactElement | null {
  const [automations, setAutomations] = useState<DiscoveredAutomation[] | null>(null);
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

  const newAutomationLabel = t("new", undefined, "New automation");
  useFolderMenuItem(
    folder.cwd,
    useMemo(
      () => ({
        id: "new-automation",
        group: "create" as const,
        label: newAutomationLabel,
        icon: mdiPlus,
        tone: "create" as const,
        onSelect: () => setLocation(`/folder/${encodeFolderPath(folder.cwd)}/automations?new=1`),
      }),
      [newAutomationLabel, folder.cwd, setLocation],
    ),
  );
  useFolderMenuRefresher(
    folder.cwd,
    useCallback(() => setReloadKey((k) => k + 1), []),
  );

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
      >
        <span data-testid="folder-automation-count">{automations.length}</span>
        <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">{t("automationsUnit", undefined, "tasks")}</span>
        {invalid > 0 && (
          <span className="text-[11px] font-extrabold text-[var(--accent-orange-text)]" title={t("invalidTitle", { count: invalid }, `${invalid} invalid`)}>
            ⚠ {invalid}
          </span>
        )}
      </SlotPill>
    </div>
  );
}
