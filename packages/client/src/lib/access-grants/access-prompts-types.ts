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
  refusals: RefusalView[];
}
