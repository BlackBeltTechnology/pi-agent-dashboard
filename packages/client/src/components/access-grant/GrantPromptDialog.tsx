/**
 * Access-grant dialog, S1 held + S2 deferred (change: add-access-grant-dialog,
 * tasks 7.1, 7.2, 7.4, 7.5; mockups/ui-plan.md).
 *
 * Built on the client-utils `Dialog` (`size="md"`, non-flush), so the focus
 * trap, escape stack, backdrop and built-in close come for free. Initial focus
 * lands on the built-in close (first focusable), never on an answer.
 *
 * UX rules enforced here:
 *   - The subject is the monospace headline; the store an allow-always writes
 *     is named before the buttons.
 *   - No answer is pre-selected, focus-defaulted or emphasised: all verdicts
 *     share one un-accented style, ordered Deny, Allow once, Allow always.
 *   - Dismissal (Escape / backdrop / close) answers deny, stated in the footer.
 *   - Held shows a live "request waiting" countdown; deferred says the verdict
 *     applies to the next attempt, has no countdown, and OMITS allow-once.
 *   - Ladder: the denied subject plus exactly the carried rungs, the denied
 *     subject preselected, the selection shown beside the answers, no free text.
 *   - Subjects render as React text children only (never raw HTML).
 *   - Filesystem / cwd prompts carry the inline YOLO offer (task 8b.7a): a
 *     dashed secondary affordance in the body, never a verdict button, so the
 *     denial in hand still needs an explicit answer (10.74).
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type {
  AccessPlaneId,
  GrantRequestMessage,
  GrantVerdict,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { mdiShieldAlertOutline } from "@mdi/js";
import { useId, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { GrantDialogYoloOffer } from "./YoloActivation.js";

export interface GrantPromptDialogProps {
  prompt: GrantRequestMessage;
  /** Epoch ms, ticked by the host; drives the held countdown. */
  now: number;
  /** Other prompts waiting behind this one. */
  queued: number;
  onAnswer(verdict: GrantVerdict, subject: string): void;
}

const TITLE_EN: Record<AccessPlaneId, string> = {
  filesystem: "Allow file access?",
  cwd: "Allow this working directory?",
  network: "Allow this network?",
  cors: "Allow this origin?",
};

const PLANE_EN: Record<AccessPlaneId, string> = {
  filesystem: "filesystem",
  cwd: "working directory",
  network: "network",
  cors: "CORS origin",
};

const REASON_EN: Record<AccessPlaneId, string> = {
  filesystem: "A read was blocked because this path is outside the session's working directory.",
  cwd: "This directory is not pinned, so the dashboard refused to operate in it.",
  network: "A request from this network was refused.",
  cors: "A cross-origin request from this origin was refused.",
};

/** Planes YOLO can answer (design D13: only the two whose subject is a path). */
const YOLO_PLANES: ReadonlySet<AccessPlaneId> = new Set(["filesystem", "cwd"]);

/** Same un-accented style for every verdict: none is emphasised (E56). */
const VERDICT_INTENT = "neutral" as const;

export function GrantPromptDialog({ prompt, now, queued, onAnswer }: GrantPromptDialogProps) {
  const { plane, subject, copy } = prompt;
  const held = copy.mode === "held";
  const rungs = copy.ladder ?? [];
  const [selected, setSelected] = useState(subject);
  const ladderName = useId();
  const secondsLeft = Math.max(0, Math.ceil((prompt.expiresAt - now) / 1000));
  const deny = () => onAnswer("deny", subject);

  return (
    <Dialog
      open
      onClose={deny}
      title={i18nT(`grantPrompt.title.${plane}`, undefined, TITLE_EN[plane])}
      icon={mdiShieldAlertOutline}
      size="md"
      testId="grant-dialog"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          data-testid="grant-dialog-plane"
          className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-tertiary)]"
        >
          {i18nT(`grantPrompt.plane.${plane}`, undefined, PLANE_EN[plane])}
        </span>
        {held ? (
          <span
            data-testid="grant-dialog-waiting"
            className="px-1.5 py-0.5 rounded bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]"
          >
            {i18nT("grantPrompt.waiting", { seconds: secondsLeft }, "Request waiting — {seconds}s left")}
          </span>
        ) : (
          <span
            data-testid="grant-dialog-deferred"
            className="px-1.5 py-0.5 rounded bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)]"
          >
            {i18nT("grantPrompt.deferredPill", undefined, "Applies to the next attempt")}
          </span>
        )}
        {queued > 0 && (
          <span data-testid="grant-dialog-queued" className="ml-auto text-[var(--text-tertiary)]">
            {i18nT("grantPrompt.queued", { count: queued }, "{count} more waiting")}
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--text-secondary)]">
        {i18nT(`grantPrompt.reason.${plane}`, undefined, REASON_EN[plane])}
        {!held && (
          <>
            {" "}
            {i18nT(
              "grantPrompt.deferredBody",
              undefined,
              "This request was already denied; your answer applies to the next attempt.",
            )}
          </>
        )}
      </p>

      <code
        data-testid="grant-dialog-subject"
        className="block font-mono text-sm break-all px-2 py-1.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
      >
        {subject}
      </code>

      {rungs.length > 0 && (
        <fieldset data-testid="grant-dialog-ladder" className="space-y-1">
          <legend className="text-xs text-[var(--text-tertiary)] mb-1">
            {i18nT("grantPrompt.ladderLegend", undefined, "Grant which directory?")}
          </legend>
          {[{ subject }, ...rungs].map((rung, i) => (
            <label
              key={rung.subject}
              className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-[var(--bg-tertiary)]"
            >
              <input
                type="radio"
                name={ladderName}
                value={rung.subject}
                checked={selected === rung.subject}
                onChange={() => setSelected(rung.subject)}
              />
              <span className="font-mono text-xs break-all text-[var(--text-primary)] flex-1">{rung.subject}</span>
              <span className="text-xs text-[var(--text-tertiary)] shrink-0">
                {i === 0
                  ? i18nT("grantPrompt.rungDenied", undefined, "denied")
                  : i18nT("grantPrompt.rungUp", { count: i }, "{count} level(s) up")}
              </span>
            </label>
          ))}
          {rungs[rungs.length - 1]?.boundary && (
            <p className="text-xs text-[var(--text-tertiary)] px-2">{rungs[rungs.length - 1].boundary}</p>
          )}
        </fieldset>
      )}

      <p data-testid="grant-dialog-consequence" className="text-xs text-[var(--text-secondary)]">
        {i18nT(
          "grantPrompt.consequence",
          { subject: selected, store: copy.store },
          "Allow always adds {subject} to {store}. Revocable in Settings → Access.",
        )}
      </p>

      {rungs.length > 0 && (
        <p data-testid="grant-dialog-selected" className="text-xs text-[var(--text-tertiary)]">
          {i18nT("grantPrompt.selected", undefined, "Answer applies to:")}{" "}
          <span className="font-mono break-all text-[var(--text-primary)]">{selected}</span>
        </p>
      )}

      {YOLO_PLANES.has(plane) && <GrantDialogYoloOffer subject={subject} />}

      <Dialog.Footer>
        <span data-testid="grant-dialog-dismiss-note" className="mr-auto text-xs text-[var(--text-tertiary)]">
          {i18nT("grantPrompt.dismissDenies", undefined, "Dismissing denies.")}
        </span>
        <Dialog.Cancel onClick={deny} testId="grant-deny">
          {i18nT("grantPrompt.deny", undefined, "Deny")}
        </Dialog.Cancel>
        {held && (
          <Dialog.Action intent={VERDICT_INTENT} onClick={() => onAnswer("allow-once", selected)} testId="grant-allow-once">
            {i18nT("grantPrompt.allowOnce", undefined, "Allow once")}
          </Dialog.Action>
        )}
        <Dialog.Action
          intent={VERDICT_INTENT}
          onClick={() => onAnswer("allow-always", selected)}
          testId="grant-allow-always"
        >
          {i18nT("grantPrompt.allowAlways", undefined, "Allow always")}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
