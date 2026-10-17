/**
 * Context handed to every step body — one object so a step never fetches its
 * own copy of state the dialog already holds.
 *
 * See change: add-remote-access-wizard.
 */

import type { RunState, Snapshot, StepId } from "../../lib/remote-access/steps.js";
import type { RemoteAccessSnapshot } from "../../lib/remote-access/use-remote-access-snapshot.js";

export interface StepCtx {
  snap: Snapshot;
  ra: RemoteAccessSnapshot;
  run: RunState;
  /** Re-read every source (after a write). */
  refresh: () => Promise<void>;
  patchRun: (p: Partial<RunState>) => void;
  /** Mark a step done for this run. */
  complete: (id: StepId) => void;
  /** Close the dialog (before navigating away). */
  close: () => void;
  navigate: (path: string) => void;
  /** End the task and return to the landing (which re-reads its sources). */
  finishTask: () => void;
  /** Dialog-level error region (`gateway-dialog-error`). */
  setError: (message: string | null) => void;
}
