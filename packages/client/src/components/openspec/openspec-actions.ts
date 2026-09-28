/**
 * Pure OpenSpec action derivation shared by the session card
 * (`SessionOpenSpecActions`) and the composer strip (`ComposerSessionActions`)
 * so both surfaces offer the same primary + `⋯` overflow per `ChangeState`.
 *
 * Holds no closures: each surface wires handlers through a `key → handler`
 * map. A `blocked` item renders inert with its reason (working session);
 * `detach` is never blocked and never workflow-gated.
 *
 * See changes: compact-openspec-lifecycle-bar (D4b),
 *              redesign-composer-session-strip (D2).
 */
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArchiveArrowUp,
  mdiArchiveOutline,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiCompassOutline,
  mdiFastForward,
  mdiLightbulbOnOutline,
  mdiLinkOff,
  mdiPlayCircleOutline,
  mdiPlus,
} from "@mdi/js";

export type OpenSpecActionKey =
  | "continue"
  | "ff"
  | "apply"
  | "archive"
  | "verify"
  | "archiveAnyway"
  | "explore"
  | "detach"
  | "new"
  | "propose";

type OpenSpecActionVariant = "primary" | "success" | "info" | "accent" | "neutral";

export interface ActionSpec {
  key: OpenSpecActionKey;
  labelKey: string;
  labelFallback: string;
  icon: string;
  testId: string;
  variant: OpenSpecActionVariant;
  /** Inert while the session is working; keep focusable, expose the reason. */
  blocked: boolean;
  blockedReasonKey?: string;
  /** Render a divider above this overflow item. */
  dividerBefore?: boolean;
}

export interface OpenSpecActionsCtx {
  /** A change is attached to the session. */
  attached: boolean;
  /** The attached change was found in the change list. */
  found: boolean;
  /** Derived state of the attached change (when found). */
  state?: ChangeState;
  wf: (workflow: string) => boolean;
  isEnded: boolean;
  /** streaming ∨ retrying (design D9). */
  working: boolean;
  /** IMPLEMENTING + all tasks checked + every artifact done. */
  showArchiveAnyway: boolean;
  /** Card: true (Detach lives in ⋯). Composer: false (Detach lives on the chip). */
  includeDetach: boolean;
  /** Test-id prefix: "" on the card, "composer-" in the composer. */
  idPrefix: string;
}

export interface OpenSpecActions {
  primary?: ActionSpec;
  overflow: ActionSpec[];
  /** Unattached, not-ended: New… / Propose… / Explore (wf-gated). */
  unattached: ActionSpec[];
}

const WORKING_REASON_KEY = "session.sessionIsStreaming";

type Base = Omit<ActionSpec, "testId" | "blocked" | "blockedReasonKey" | "dividerBefore"> & { id: string; wf?: string };

const A: Record<OpenSpecActionKey, Base> = {
  continue: { key: "continue", wf: "continue", id: "continue-btn", labelKey: "common.continue", labelFallback: "Continue", icon: mdiChevronRight, variant: "primary" },
  ff: { key: "ff", wf: "ff", id: "ff-btn", labelKey: "openspec.ff", labelFallback: "FF", icon: mdiFastForward, variant: "primary" },
  apply: { key: "apply", wf: "apply", id: "apply-btn", labelKey: "common.apply", labelFallback: "Apply", icon: mdiPlayCircleOutline, variant: "primary" },
  archive: { key: "archive", wf: "archive", id: "archive-btn", labelKey: "openspec.archive", labelFallback: "Archive", icon: mdiArchiveOutline, variant: "accent" },
  verify: { key: "verify", wf: "verify", id: "verify-btn", labelKey: "common.verify", labelFallback: "Verify", icon: mdiCheckCircleOutline, variant: "success" },
  archiveAnyway: { key: "archiveAnyway", wf: "archive", id: "archive-anyway-btn", labelKey: "openspec.archiveAnyway", labelFallback: "Archive anyway", icon: mdiArchiveArrowUp, variant: "accent" },
  explore: { key: "explore", wf: "explore", id: "explore-menu-item", labelKey: "openspec.exploreChange", labelFallback: "Explore…", icon: mdiCompassOutline, variant: "info" },
  detach: { key: "detach", id: "detach-btn", labelKey: "common.detach", labelFallback: "Detach", icon: mdiLinkOff, variant: "neutral" },
  new: { key: "new", wf: "new", id: "new-change-btn", labelKey: "common.change", labelFallback: "Change", icon: mdiPlus, variant: "primary" },
  propose: { key: "propose", wf: "propose", id: "propose-btn", labelKey: "common.propose", labelFallback: "Propose", icon: mdiLightbulbOnOutline, variant: "primary" },
};

/** Composer ids that differ from the prefixed card id (kept for existing tests). */
const COMPOSER_UNATTACHED_EXPLORE = "explore-btn";
const CARD_UNATTACHED_EXPLORE = "explore-unattached-btn";

const CANDIDATES: Record<ChangeState, OpenSpecActionKey[]> = {
  [ChangeState.PLANNING]: ["continue", "ff"],
  [ChangeState.READY]: ["apply"],
  [ChangeState.IMPLEMENTING]: ["apply"],
  [ChangeState.COMPLETE]: ["archive", "verify"],
};

export function deriveOpenSpecActions(ctx: OpenSpecActionsCtx): OpenSpecActions {
  const spec = (key: OpenSpecActionKey, extra: Partial<ActionSpec> = {}, id?: string): ActionSpec => {
    const { id: baseId, wf: _wf, ...rest } = A[key];
    const blocked = key !== "detach" && ctx.working;
    return {
      ...rest,
      testId: `${ctx.idPrefix}${id ?? baseId}`,
      blocked,
      ...(blocked ? { blockedReasonKey: WORKING_REASON_KEY } : {}),
      ...extra,
    };
  };
  const enabled = (key: OpenSpecActionKey) => {
    const w = A[key].wf;
    return w === undefined || ctx.wf(w);
  };
  const detach = (dividerBefore: boolean): ActionSpec[] => (ctx.includeDetach ? [spec("detach", { dividerBefore })] : []);

  if (!ctx.attached) {
    if (ctx.isEnded) return { overflow: [], unattached: [] };
    const exploreId = ctx.idPrefix ? COMPOSER_UNATTACHED_EXPLORE : CARD_UNATTACHED_EXPLORE;
    const unattached = (["new", "propose", "explore"] as const)
      .filter(enabled)
      .map((k) => (k === "explore" ? spec(k, { labelKey: "common.explore", labelFallback: "Explore" }, exploreId) : spec(k)));
    return { overflow: [], unattached };
  }

  if (!ctx.found || ctx.isEnded || ctx.state === undefined) {
    return { overflow: detach(false), unattached: [] };
  }

  const candidates = CANDIDATES[ctx.state].filter(enabled);
  const [primaryKey, ...rest] = candidates;
  const overflow: ActionSpec[] = [
    ...rest.map((k) => spec(k)),
    ...(ctx.showArchiveAnyway && enabled("archiveAnyway") ? [spec("archiveAnyway")] : []),
    ...(enabled("explore") ? [spec("explore")] : []),
    ...detach(true),
  ];
  return { primary: primaryKey ? spec(primaryKey) : undefined, overflow, unattached: [] };
}
