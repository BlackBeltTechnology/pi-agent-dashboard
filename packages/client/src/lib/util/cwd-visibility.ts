/**
 * Pure helper: is a given cwd visible in the current dashboard view?
 *
 * "Visible" = some on-screen surface (folder action bar) is keyed on this
 * cwd, so a `spawn_error` for it can render under that surface. When the
 * cwd is invisible, `useMessageHandler` falls back to a global toast so
 * the failure isn't silently dropped. See change: harden-worktree-spawn.
 *
 * Comparison uses the existing `pathKey(p, platform)` helper from
 * `session-grouping.ts` so cosmetic drift (trailing slash, case on
 * Windows/macOS) doesn't cause spurious toasts.
 */
import { pathKey, inferPlatform } from "../session/session-grouping.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface CwdVisibilityInputs {
  pinnedDirectories: ReadonlyArray<string>;
  workspaces: ReadonlyArray<{ folders: ReadonlyArray<string> }>;
  sessions: ReadonlyArray<Pick<DashboardSession, "cwd">>;
  /** Override for tests; defaults to the inference used elsewhere. */
  platform?: NodeJS.Platform;
}

export function isVisibleCwd(cwd: string, inputs: CwdVisibilityInputs): boolean {
  if (!cwd) return false;
  const platform = inferPlatform(
    [
      cwd,
      ...inputs.pinnedDirectories,
      ...inputs.workspaces.flatMap((w) => w.folders),
      ...inputs.sessions.map((s) => s.cwd),
    ],
    inputs.platform,
  );
  const key = pathKey(cwd, platform);
  for (const dir of inputs.pinnedDirectories) {
    if (pathKey(dir, platform) === key) return true;
  }
  for (const ws of inputs.workspaces) {
    for (const f of ws.folders) {
      if (pathKey(f, platform) === key) return true;
    }
  }
  for (const s of inputs.sessions) {
    if (s.cwd && pathKey(s.cwd, platform) === key) return true;
  }
  return false;
}
