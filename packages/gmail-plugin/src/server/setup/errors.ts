/**
 * Control-flow errors of a setup run. Never carry page content or secrets: the
 * message is a fixed code. See change: add-gmail-auto-setup.
 */
import type { HandoffReason, SetupStepId } from "../../shared/auto-setup.js";

/** Base class: a step/capture `catch` rethrows these instead of treating them as failures. */
export class SetupControl extends Error {}

/** The run stops and hands off to the manual wizard. `step` defaults to the current step. */
export class SetupHandoff extends SetupControl {
  readonly reason: HandoffReason;
  readonly step?: SetupStepId;
  constructor(reason: HandoffReason, step?: SetupStepId) {
    super(`handoff:${reason}`);
    this.name = "SetupHandoff";
    this.reason = reason;
    this.step = step;
  }
}

/** Raised on the step's page operations when the redirect guard stopped an accounts.google.com load. */
export class SignInRequired extends SetupControl {
  constructor() {
    super("sign_in_required");
    this.name = "SignInRequired";
  }
}

/** The run was cancelled/ended; stale attempts and waiters unwind quietly. */
export class RunAborted extends SetupControl {
  constructor() {
    super("run_aborted");
    this.name = "RunAborted";
  }
}
