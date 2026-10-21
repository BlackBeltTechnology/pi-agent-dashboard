/**
 * Tier-0 call-to-action banner for a directory card (change: add-folder-action-banner).
 *
 * A single full-width surface that hosts every BLOCKING directory-card call to
 * action. The git row is facts-only; this banner sits below it (or below the
 * header row when there is no git row). At most ONE banner renders, chosen by a
 * fixed severity ladder:
 *
 *   init failure > running > hook re-trust > init needed > not a pi project
 *
 * The hook rungs (failed / running / retrust / init-needed) re-host
 * `WorktreeInitButton`, which owns the run store, the trust-confirm dialog and
 * the friendly chip. The setup rung ("not a pi project yet") spawns an
 * interactive project-init session. The banner does NOT track that session:
 * `useInitStatus` (owned by the row's `FolderInitScope`) re-probes whenever a
 * session in the row finishes a turn or ends, so the banner clears however
 * setup was launched and survives banner remounts; an abandoned setup still
 * correctly leaves the banner standing (the re-probe finds it unconfigured).
 * See change: fix-project-setup-completion-state.
 *
 * Gating rules:
 *   - Tier 0 means the folder CANNOT PROCEED. Optional/informational state
 *     (`setupOutdated`, partial-but-configured setup) never banners.
 *   - The setup rung is gated on REQUIRED artifacts only (`.pi/settings.json`)
 *     AND on the row being a project root (git root / pinned / workspace-added),
 *     so a weak signal on an arbitrary subdirectory never reaches tier 0.
 *   - Fail open: an absent/uninterpretable checklist renders NO banner, never a
 *     false "not a pi project".
 *
 * Colours come exclusively from the `--severity-{info,warning,error}-*` triples;
 * no new token is introduced. The retrust / init-needed rungs render a rung glyph
 * + message before the hosted action, which inherits the region colour.
 * See change: fix-folder-card-pill-contrast.
 */

import {
  mdiAlertCircleOutline,
  mdiScriptTextPlayOutline,
  mdiShieldAlertOutline,
  mdiTextBoxCheckOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import type { WorktreeInitStatus } from "../../lib/git/git-api.js";
import { type ClientInitRun, useInitRun } from "../../lib/git/worktree-init-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { setupState } from "../../lib/init-setup-state.js";
import { WorktreeInitButton } from "../worktree/WorktreeInitButton.js";

// Re-exported so existing imports/tests keep compiling (moved to lib/).
export { setupState };

export type BannerRung = "failed" | "running" | "retrust" | "init-needed" | "setup";

type Severity = "info" | "warning" | "error";

const SEVERITY_CLASS: Record<Severity, string> = {
  info: "bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)] border-[var(--severity-info-border)]",
  warning: "bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] border-[var(--severity-warning-border)]",
  error: "bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] border-[var(--severity-error-border)]",
};

const RUNG_SEVERITY: Record<BannerRung, Severity> = {
  failed: "error",
  running: "info",
  retrust: "warning",
  "init-needed": "info",
  setup: "info",
};

/** The one rung to render, or null for a quiet card. */
export function computeBannerRung(
  status: WorktreeInitStatus | null,
  run: ClientInitRun | undefined,
  isProjectRoot: boolean,
): BannerRung | null {
  if (run?.phase === "failed") return "failed";
  if (run?.phase === "running" || run?.phase === "done") return "running";
  if (status?.hasHook === true && status.trusted === false) return "retrust";
  if (status?.hasHook === true && status.trusted === true && status.needsInit === true) return "init-needed";
  if (isProjectRoot && setupState(status) === "not-a-project") return "setup";
  return null;
}

interface Props {
  cwd: string;
  /** Shared init-status probe result for the row (single fetch). */
  status: WorktreeInitStatus | null;
  /**
   * Client-side project-root gate (git root, pinned, or workspace-added). The
   * "not a pi project" rung renders only when this is true.
   */
  isProjectRoot: boolean;
  /** Spawns an interactive project-init session in `cwd`. */
  onInitializeProject?: (cwd: string) => void;
  /** Re-issues the row's init-status probe (after a run / scaffold). */
  onStatusChange?: () => void;
  /**
   * `folder-banner` hidden: render a compact warning chip naming the state
   * instead of the full banner; activating it reveals the banner until the
   * folder leaves that state. See change: add-focus-mode-and-card-block-toggles.
   */
  compact?: boolean;
}

/** Rung glyph — shared by the compact chip and the retrust / init-needed rows. */
const RUNG_GLYPH: Record<BannerRung, string> = {
  failed: mdiAlertCircleOutline,
  running: mdiScriptTextPlayOutline,
  retrust: mdiShieldAlertOutline,
  "init-needed": mdiScriptTextPlayOutline,
  setup: mdiTextBoxCheckOutline,
};

const CHIP_LABEL: Record<BannerRung, () => string> = {
  failed: () => i18nT("folders.chipInitFailed", undefined, "Init failed"),
  running: () => i18nT("folders.chipInitRunning", undefined, "Initializing…"),
  retrust: () => i18nT("folders.chipRetrust", undefined, "Re-trust needed"),
  "init-needed": () => i18nT("folders.chipInitNeeded", undefined, "Init needed"),
  setup: () => i18nT("folders.chipSetup", undefined, "Setup needed"),
};

export function FolderActionBanner({
  cwd,
  status,
  isProjectRoot,
  onInitializeProject,
  onStatusChange,
  compact = false,
}: Props) {
  const run = useInitRun(cwd);
  const rung = computeBannerRung(status, run, isProjectRoot);
  // Per-tab reveal for the compact chip; resets once the folder leaves the state.
  const [revealed, setRevealed] = useState(false);
  // Any change of state (incl. failed → retrust) re-collapses to the chip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rung` is the trigger, not a read value
  useEffect(() => {
    setRevealed(false);
  }, [rung]);

  if (!rung) return null;

  if (compact && !revealed) {
    return (
      <button
        type="button"
        data-testid={`folder-banner-chip-${cwd}`}
        onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
        className={`focus-ring mt-1 inline-flex min-h-[44px] md:min-h-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium ${SEVERITY_CLASS[RUNG_SEVERITY[rung]]}`}
      >
        <Icon path={RUNG_GLYPH[rung]} size={0.5} className="shrink-0" />
        {CHIP_LABEL[rung]()}
      </button>
    );
  }

  const severity = RUNG_SEVERITY[rung];
  const label = i18nT("folders.folderActionBanner", undefined, "Folder action");

  return (
    <div
      role="region"
      aria-label={label}
      data-testid={`folder-banner-${rung}-${cwd}`}
      // stopPropagation: the banner sits inside the clickable folder header, which
      // navigates to the directory home; its own action must not collapse/navigate.
      onClick={(e) => e.stopPropagation()}
      className={`mt-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 ${SEVERITY_CLASS[severity]}`}
    >
      {rung === "setup" ? (
        <>
          <Icon path={RUNG_GLYPH.setup} size={0.6} className="shrink-0" />
          <span className="flex-1 min-w-0 text-[12px] font-medium">
            {i18nT("folders.notAPiProjectYet", undefined, "Not a pi project yet")}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onInitializeProject?.(cwd); }}
            data-testid={`folder-banner-setup-action-${cwd}`}
            disabled={!onInitializeProject}
            className="focus-ring shrink-0 min-h-[44px] md:min-h-0 rounded border border-current px-2 py-1 text-[12px] font-semibold hover:opacity-80 disabled:opacity-50"
          >
            {i18nT("folders.setUpArrow", undefined, "Set up →")}
          </button>
        </>
      ) : (
        // Hook rungs (running / failed / retrust / init-needed): WorktreeInitButton
        // renders the chip while a run is live, otherwise the Initialize / Review
        // control, and owns the trust-confirm dialog. retrust / init-needed lead
        // with a glyph + message that explain the block; the hosted action stays
        // colour-free and inherits this region's `--severity-*-fg`. A polite live
        // region carries the failure summary; it re-announces only when the
        // message changes. See change: fix-folder-card-pill-contrast.
        <>
          {(rung === "retrust" || rung === "init-needed") && (
            <>
              <Icon path={RUNG_GLYPH[rung]} size={0.6} className="shrink-0" />
              <span className="flex-1 min-w-0 text-[12px] font-medium">
                {rung === "retrust"
                  ? i18nT("folders.bannerRetrust", undefined, "Init hook needs your trust before it can run")
                  : i18nT("folders.bannerInitNeeded", undefined, "Init hook hasn't run in this checkout")}
              </span>
            </>
          )}
          <div className={rung === "retrust" || rung === "init-needed" ? "shrink-0" : "flex-1 min-w-0"}>
            {rung === "failed" && (
              <span className="sr-only" aria-live="polite">
                {run?.message ?? i18nT("worktree.initFailedShort", undefined, "init failed")}
              </span>
            )}
            <WorktreeInitButton cwd={cwd} status={status} onStatusChange={onStatusChange} />
          </div>
        </>
      )}
    </div>
  );
}
