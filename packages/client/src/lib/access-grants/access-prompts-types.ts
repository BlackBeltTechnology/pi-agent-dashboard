/**
 * Client mirror of `GET /api/access/prompts` (change: add-access-grant-dialog,
 * tasks 8.1-8.3). The server owns the shape
 * (`packages/server/src/routes/access-prompt-routes.ts`, `AccessPromptsView`);
 * only the fields the Access page renders are modelled.
 */
import type {
  AccessPlaneId,
  GrantPromptCopy,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

/** Why no dialog would be raised right now (S4 banners). */
export type PromptingBlocker = "report-mode" | "kill-switch" | "disabled";

export interface PendingPromptView {
  promptId: string;
  plane: AccessPlaneId;
  subject: string;
  mode: "held" | "deferred";
  /** False = recorded without a dialog; `suppressedBy` says why. */
  prompted: boolean;
  suppressedBy?: string;
  recordedAt: number;
  expiresAt: number;
  /** Milliseconds left at response time (clock-skew-free countdown base). */
  ttlMs?: number;
  hits: number;
  store: string;
  copy: GrantPromptCopy;
}

/** An operator's answer (dialog or Access page). */
interface OperatorVerdictView {
  answeredBy: "operator";
  promptId: string;
  plane: AccessPlaneId;
  subject: string;
  outcome: "allow-once" | "allow-always" | "deny" | "expired" | "aborted" | "failed";
  /** The store an allow-always actually wrote. */
  store?: string;
  /** Set when the verdict chose an offered ancestor over the denied subject. */
  widenedFrom?: string;
  at: number;
}

/** A YOLO auto-answer: no human answered. */
interface YoloVerdictView {
  answeredBy: "yolo";
  plane: AccessPlaneId;
  subject: string;
  outcome: "auto-allowed" | "refused-by-prior-refusal";
  at: number;
}

export type VerdictView = OperatorVerdictView | YoloVerdictView;

export interface RefusalView {
  plane: AccessPlaneId;
  subject: string;
  refusedAt: number;
}

/** One root of a YOLO session (server `YoloRoot`). */
interface YoloRootView {
  path: string;
  addedAt: number;
}

/** The live YOLO session (server `YoloSession`, `access/yolo-session.ts`). */
export interface YoloSessionView {
  source: "operator" | "env";
  activatedAt: number;
  /** `null` = the environment session: lasts the process lifetime. */
  expiresAt: number | null;
  unscoped: boolean;
  roots: YoloRootView[];
}

/** The `yolo` block of the view (tasks 8b.7, 8b.7a). */
export interface YoloView {
  /** False = report mode: no activation possible (D13a). */
  available: boolean;
  durationsMinutes: number[];
  session: YoloSessionView | null;
}

export interface AccessPromptsView {
  prompting: {
    enabled: boolean;
    killSwitch: boolean;
    hostGateMode: "report" | "enforce";
    /** Empty = a capability-holding browser would get dialogs. */
    blockers: PromptingBlocker[];
  };
  pending: PendingPromptView[];
  /** Newest first. */
  verdicts: VerdictView[];
  yolo: YoloView;
  refusals: RefusalView[];
}
