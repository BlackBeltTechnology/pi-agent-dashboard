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
 * interactive project-init session and re-probes init-status when that session
 * ends — unconditional on its outcome, so an abandoned setup correctly leaves
 * the banner standing.
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
 * no new token is introduced.
 */

import { mdiTextBoxCheckOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorktreeInitStatus } from "../../lib/git/git-api.js";
import { type ClientInitRun, useInitRun } from "../../lib/git/worktree-init-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { WorktreeInitButton } from "../worktree/WorktreeInitButton.js";

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

/**
 * Setup state derived from the payload. The checklist WINS whenever present;
 * the deprecated `configured` boolean is consulted only in its absence. Neither
 * present → "unknown" (fail open, no banner).
 */
export function setupState(status: WorktreeInitStatus | null): "not-a-project" | "ok" | "unknown" {
  if (!status) return "unknown";
  if (Array.isArray(status.checklist)) {
    const settings = status.checklist.find((a) => a.id === "settings");
    if (!settings) return "unknown"; // uninterpretable shape → fail open
    return settings.present ? "ok" : "not-a-project";
  }
  if (status.configured === true) return "ok";
  if (status.configured === false) return "not-a-project";
  return "unknown";
}

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

/** Minimal shape the banner needs to watch a spawned project-init session end. */
interface BannerSession {
  id: string;
  cwd: string;
  status: string;
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
  /** The folder's sessions — used to re-probe when a spawned setup ends. */
  sessions?: BannerSession[];
}

export function FolderActionBanner({
  cwd,
  status,
  isProjectRoot,
  onInitializeProject,
  onStatusChange,
  sessions,
}: Props) {
  const run = useInitRun(cwd);
  const rung = computeBannerRung(status, run, isProjectRoot);

  // Re-probe init-status when a spawned project-init session reaches `ended`.
  const [pendingSpawn, setPendingSpawn] = useState(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const spawnedIdRef = useRef<string | null>(null);

  const handleSetup = useCallback(() => {
    knownIdsRef.current = new Set((sessions ?? []).filter((s) => s.cwd === cwd).map((s) => s.id));
    spawnedIdRef.current = null;
    setPendingSpawn(true);
    onInitializeProject?.(cwd);
  }, [sessions, cwd, onInitializeProject]);

  useEffect(() => {
    if (!pendingSpawn) return;
    const mine = (sessions ?? []).filter((s) => s.cwd === cwd);
    if (!spawnedIdRef.current) {
      const fresh = mine.find((s) => !knownIdsRef.current.has(s.id));
      if (fresh) spawnedIdRef.current = fresh.id;
    }
    if (spawnedIdRef.current) {
      const spawned = mine.find((s) => s.id === spawnedIdRef.current);
      if (spawned && spawned.status === "ended") {
        onStatusChange?.();
        setPendingSpawn(false);
        spawnedIdRef.current = null;
      }
    }
  }, [sessions, pendingSpawn, cwd, onStatusChange]);

  if (!rung) return null;

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
          <Icon path={mdiTextBoxCheckOutline} size={0.6} className="shrink-0" />
          <span className="flex-1 min-w-0 text-[12px] font-medium">
            {i18nT("folders.notAPiProjectYet", undefined, "Not a pi project yet")}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleSetup(); }}
            data-testid={`folder-banner-setup-action-${cwd}`}
            disabled={!onInitializeProject}
            className="focus-ring shrink-0 min-h-[44px] md:min-h-0 rounded border border-current px-2 py-1 text-[11px] font-semibold hover:opacity-80 disabled:opacity-50"
          >
            {i18nT("folders.setUpArrow", undefined, "Set up →")}
          </button>
        </>
      ) : (
        // Hook rungs (running / failed / retrust / init-needed): WorktreeInitButton
        // renders the chip while a run is live, otherwise the Initialize / Review
        // control, and owns the trust-confirm dialog. A polite live region carries
        // the failure summary; it re-announces only when the message changes.
        <div className="flex-1 min-w-0">
          {rung === "failed" && (
            <span className="sr-only" aria-live="polite">
              {run?.message ?? i18nT("worktree.initFailedShort", undefined, "init failed")}
            </span>
          )}
          <WorktreeInitButton cwd={cwd} status={status} onStatusChange={onStatusChange} />
        </div>
      )}
    </div>
  );
}
