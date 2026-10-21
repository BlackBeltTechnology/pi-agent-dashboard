/**
 * Automatic Google Cloud setup — wire types shared by the gmail server run engine
 * and the settings client. Pure types + two constants; no I/O.
 * The run view is secret-free by construction: it carries no client secret and no
 * dedicated-browser `instanceId`. See change: add-gmail-auto-setup.
 */

/** Recipe step ids, in execution order. */
export const SETUP_STEP_IDS = ["project", "api", "branding", "publish", "client", "capture"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStepStatus = "pending" | "running" | "done" | "skipped" | "handoff";

/** Manual wizard step (1–4 in `client/wizard.ts`) a recipe step maps to. */
export type WizardStepNumber = 1 | 2 | 3 | 4;

/** `project`,`api` → 1; `branding` → 2; `publish` → 3; `client`,`capture` → 4. */
export const WIZARD_STEP_OF: Record<SetupStepId, WizardStepNumber> = {
  project: 1,
  api: 1,
  branding: 2,
  publish: 3,
  client: 4,
  capture: 4,
};

export type SetupRunState =
  | "starting"
  | "running"
  | "waiting_user"
  | "waiting_decision"
  | "busy"
  | "done"
  | "handoff"
  | "cancelled";

/** Human checkpoints the run waits on; it never performs these clicks itself. */
export type CheckpointKind = "sign_in" | "console_terms" | "policy" | "publish";

/** Dedicated-browser refusals that hand off at `project`. */
export type BrowserRefusalReason =
  | "disabled"
  | "unloaded"
  | "no-chrome"
  | "no-display"
  | "owned-by-other-server"
  | "profile-in-use"
  | "launch-failed";

export type HandoffReason =
  | "unexpected_page"
  | "locale"
  | "domain_blocked"
  | "publish_cancelled"
  | "timeout"
  | "secret_capture_failed"
  | "client_in_use"
  | "browser_closed"
  | BrowserRefusalReason;

export type Audience = "internal" | "external";

export interface PublishLinks {
  homePage: string;
  privacyPolicy: string;
  authorizedDomain: string;
}

export type SetupDecision =
  | { kind: "audience"; detected: Audience; org?: string }
  | { kind: "links"; links: PublishLinks };

export interface SetupRunView {
  runId: string;
  state: SetupRunState;
  /** Step being worked on (or the one that stopped the run). */
  step: SetupStepId;
  steps: Array<{ id: SetupStepId; status: SetupStepStatus }>;
  checkpoint?: { kind: CheckpointKind };
  decision?: SetupDecision;
  /** Holder label (session id or client label) of the dedicated profile; never an instance id. */
  busy?: { holder?: string };
  handoff?: { step: SetupStepId; wizardStep: WizardStepNumber; reason: HandoffReason };
  projectId?: string;
  /** Resources this run made on Google's side, so a hand-off can name them. */
  created: { projectId?: string; clients: string[] };
  /** Set once the client is stored (done). */
  clientId?: string;
  ownerEmail?: string;
}

/** `GET /state` → `autoSetup`. */
export interface AutoSetupState {
  available: boolean;
  /** Why unavailable: a `BrowserRefusalReason`, `service_missing`, `remote_dashboard`, `run_active`. */
  reason?: string;
  /** The request came from a genuinely local peer. */
  local: boolean;
  /** A configured client without accounts would be replaced by the new one. */
  replacesClient?: boolean;
}

/** `POST setup/run` body. */
export interface SetupRunRequest {
  mode: "new" | "existing";
  projectId?: string;
  ownerEmail: string;
}

/** `POST setup/run/:id/continue` body (answers a decision or acknowledges a checkpoint). */
export interface SetupContinueRequest {
  audience?: Audience;
  links?: PublishLinks;
  confirmLinks?: boolean;
}

/** Defaults for External publishing (design D7). */
export const DEFAULT_PUBLISH_LINKS: PublishLinks = {
  homePage: "https://github.com/BlackBeltTechnology/pi-agent-dashboard",
  privacyPolicy: "https://github.com/BlackBeltTechnology/pi-agent-dashboard",
  authorizedDomain: "github.com",
};
