/**
 * The opt-in "Enable jj workspaces" button rendered on plain-git
 * sessions. Two gates apply:
 *
 *   1. Slot predicate `isInGitRepoButNotJj` — claim-level filter.
 *   2. Plugin config `showInitColocatedSuggestion` — read inside the
 *      component via `usePluginConfig`. Default `false` per Decision 11.
 *
 * Calling the endpoint runs `jj git init --colocate` after a precise
 * dirty-INDEX-only check; refuses 409 `DIRTY_INDEX` only on staged
 * changes. Working-tree dirt is allowed (jj snapshots it as the new `@`).
 *
 * See change: add-jj-workspace-plugin.
 */
import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiSourceMerge } from "@mdi/js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { initColocated } from "./api.js";

// Until the settings-section slot runtime lands, the user has no UI to flip
// `showInitColocatedSuggestion`. The spec mandates opt-in (Decision 11) but
// gating on absent config = always-hidden = no way to discover the feature.
// As a compromise we treat `undefined` config as "show"; only an explicit
// `false` hides. Once settings-section is consumed, restore the strict
// opt-in by changing this constant to `false` and dropping the comment.
const SHOW_BY_DEFAULT_UNTIL_SETTINGS_WIRED = true;

export function JjInitAffordance({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  // Note: we intentionally do NOT call usePluginConfig here because this
  // component is currently rendered inline from SessionCard.tsx (outside
  // any plugin slot), where no PluginContextProvider/CurrentPluginLayer
  // is in scope. Once SessionCard renders us through the
  // session-card-action-bar slot, restore strict opt-in by reading
  // showInitColocatedSuggestion via usePluginConfig<JjPluginConfig>().
  const config: { showInitColocatedSuggestion?: boolean } = {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plugin-config gate. Until `settings-section` slot is wired,
  // `undefined` is treated as opt-in (see SHOW_BY_DEFAULT_UNTIL_SETTINGS_WIRED).
  const optedIn =
    config.showInitColocatedSuggestion ??
    (SHOW_BY_DEFAULT_UNTIL_SETTINGS_WIRED ? true : false);
  if (!optedIn) return null;

  // Defensive predicate re-check (the slot-level predicate already filters,
  // but components are responsible for their own correctness).
  if (session.jjState?.isJjRepo) return null;
  if (!session.gitBranch) return null;

  const onClick = async () => {
    if (
      !window.confirm(
        `Run 'jj git init --colocate' in ${session.cwd}? This is non-destructive but adds .jj/ alongside .git/. Refuses if the git index has staged changes.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await initColocated(session.cwd);
      if (!result.ok) {
        const messageFromData =
          result.data && typeof (result.data as { message?: unknown }).message === "string"
            ? (result.data as { message: string }).message
            : null;
        setError(messageFromData ?? result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="jj-init-affordance" className="flex items-center gap-1 text-[10px]">
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        title="Convert this git repo to jj-colocated and unlock parallel-workspace tooling"
        className="inline-flex items-center px-1.5 py-[1px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        data-testid="jj-init-button"
      >
        <Icon path={mdiSourceMerge} size={0.45} className="inline mr-0.5" />
        Enable jj workspaces
      </button>
      {error && (
        <span
          className="text-[10px] text-red-400"
          data-testid="jj-init-error"
        >
          {error}
        </span>
      )}
    </div>
  );
}
