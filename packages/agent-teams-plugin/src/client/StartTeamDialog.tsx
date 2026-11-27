/**
 * StartTeamDialog — the "Start an agent team" dialog opened from a workspace
 * folder (design D11). Step 1 lists the folder's templates (source, validity and
 * trust badges; an invalid or untrusted template is disabled with an accessible
 * reason) and takes the goal. A `hooks_untrusted` answer opens step 2, which shows
 * the exact commands as literal text and retries the start with `trustHooks` equal
 * to the shown hash only after the user confirms; `hash_mismatch` sends the user
 * back to review again. One POST in flight at most (the buttons disable and a ref
 * guards a racing second click); Esc / backdrop / ✕ are ignored while it runs.
 * Focus trap, Esc and focus return come from the shared `Dialog`.
 * See change: add-agent-teams-templates-hooks.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from "react";
import type { HooksUntrustedDetails } from "../shared/protocol.js";
import { useLazyT } from "./lazy-i18n.js";
import { HooksStep, type Listing, startable, TemplateList } from "./StartTeamParts.js";
import { hooksDetailsOf, listTemplates, type RestFailure, startTeam } from "./start-api.js";
import { START_TABLES } from "./start-i18n.js";

/** Goal length cap (code points); the server still enforces the playbook cap. */
export const GOAL_MAX_CHARS = 4000;
/** A start that has not answered by then is reported as a network error and may be retried. */
const START_TIMEOUT_MS = 60_000;

export interface StartTeamDialogProps {
  /** The folder's cwd — the only cwd ever sent. */
  cwd: string;
  /** Human label of the folder (shown for context). */
  folderLabel?: string;
  onClose: () => void;
  /** Called after a successful start, just before `onClose`. */
  onStarted?: (teamId: string | undefined) => void;
}

type Step = { name: "form" } | { name: "hooks"; details: HooksUntrustedDetails; changed: boolean };
interface FieldErrors {
  template?: string;
  goal?: string;
}

/** The template list of a folder; a single startable template is preselected. */
function useTemplateListing(cwd: string, onSingle: (name: string) => void): { listing: Listing; reload: () => void } {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger, `onSingle` is a stable setter
  useEffect(() => {
    const ac = new AbortController();
    setListing({ status: "loading" });
    void listTemplates(cwd, { signal: ac.signal }).then((res) => {
      if (ac.signal.aborted) return;
      if (!res.ok) return setListing({ status: "error" });
      setListing({ status: "ready", templates: res.data.templates });
      const ready = res.data.templates.filter(startable);
      if (ready.length === 1 && ready[0]) onSingle(ready[0].name);
    });
    return () => ac.abort();
  }, [cwd, attempt]);
  return { listing, reload: () => setAttempt((n) => n + 1) };
}

/** What a failed start means for the dialog. */
type FailureOutcome = { kind: "hooks"; details: HooksUntrustedDetails } | { kind: "mismatch" } | { kind: "error"; key: string };

function outcomeOf(f: RestFailure, known: (key: string) => boolean): FailureOutcome {
  const details = f.code === "hooks_untrusted" ? hooksDetailsOf(f) : undefined;
  if (details) return { kind: "hooks", details };
  if (f.code === "hash_mismatch") return { kind: "mismatch" };
  if (f.network) return { kind: "error", key: "error.network" };
  if (f.code && known(`error.${f.code}`)) return { kind: "error", key: `error.${f.code}` };
  return { kind: "error", key: f.status === 403 ? "error.forbidden" : "error.generic" };
}

function validate(t: ReturnType<typeof useLazyT>, selected: string | undefined, goal: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!selected) errors.template = t("dialog.templateRequired");
  if (goal === "") errors.goal = t("dialog.goalRequired");
  else if ([...goal].length > GOAL_MAX_CHARS) errors.goal = t("dialog.goalTooLong", { max: GOAL_MAX_CHARS });
  return errors;
}

export function StartTeamDialog({ cwd, folderLabel, onClose, onStarted }: StartTeamDialogProps): ReactElement {
  const t = useLazyT(START_TABLES);
  const goalId = useId();
  const [selected, setSelected] = useState<string | undefined>();
  const { listing, reload } = useTemplateListing(cwd, setSelected);
  const [goal, setGoal] = useState("");
  const [step, setStep] = useState<Step>({ name: "form" });
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<FieldErrors>({});
  const [error, setError] = useState<string | undefined>();
  const inflight = useRef(false);

  const known = useCallback((key: string) => t(key) !== key, [t]);
  // A running start cannot be cancelled: Esc / backdrop / ✕ do nothing until it answers.
  const close = useCallback(() => {
    if (!inflight.current) onClose();
  }, [onClose]);

  const failed = (f: RestFailure, afterConfirm: boolean): void => {
    const outcome = outcomeOf(f, known);
    if (outcome.kind === "hooks") {
      // A second `hooks_untrusted` after a confirmation means the commands changed under the user.
      setStep({ name: "hooks", details: outcome.details, changed: afterConfirm });
    } else if (outcome.kind === "mismatch") {
      setStep({ name: "form" });
      setError(t("hooks.changed"));
    } else {
      setError(t(outcome.key));
    }
  };

  const submit = async (trustHooks?: string): Promise<void> => {
    if (inflight.current) return; // exactly one POST, however fast the clicks
    const trimmed = goal.trim();
    if (trustHooks === undefined) {
      const errors = validate(t, selected, trimmed);
      setFieldError(errors);
      if (errors.template || errors.goal) return;
    }
    if (!selected) return;
    inflight.current = true;
    setBusy(true);
    setError(undefined);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), START_TIMEOUT_MS);
    const res = await startTeam({ template: selected, goal: trimmed, cwd, ...(trustHooks !== undefined ? { trustHooks } : {}) }, { signal: ac.signal });
    clearTimeout(timer);
    inflight.current = false;
    setBusy(false);
    if (!res.ok) return failed(res.failure, trustHooks !== undefined);
    onStarted?.(res.data?.teamId);
    onClose();
  };

  const backToForm = (): void => {
    setStep({ name: "form" });
    setError(undefined);
  };

  return (
    <Dialog open onClose={close} title={step.name === "hooks" ? t("hooks.title") : t("dialog.title")} size="md" testId="start-team-dialog">
      {step.name === "hooks" ? (
        <HooksStep details={step.details} changed={step.changed} error={error} busy={busy} onAllow={() => void submit(step.details.hash)} onDeny={backToForm} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="start-form">
          {folderLabel ? <p className="m-0 text-[12px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">{folderLabel}</p> : null}
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-semibold text-[var(--text-primary)]">{t("dialog.templateLabel")}</legend>
            <TemplateList listing={listing} selected={selected} onPick={setSelected} onRetry={reload} />
            {fieldError.template ? (
              <p role="alert" className="mt-1 mb-0 text-[12px] text-[var(--tint-red-fg)]">
                {fieldError.template}
              </p>
            ) : null}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor={goalId} className="text-sm font-semibold text-[var(--text-primary)]">
              {t("dialog.goalLabel")}
            </label>
            <textarea
              id={goalId}
              value={goal}
              rows={4}
              readOnly={busy}
              placeholder={t("dialog.goalPlaceholder")}
              onChange={(e) => setGoal(e.target.value)}
              aria-invalid={fieldError.goal ? true : undefined}
              data-autofocus=""
              data-testid="start-goal"
              className="focus-ring w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-2 text-sm text-[var(--text-primary)]"
            />
            {fieldError.goal ? (
              <p role="alert" className="m-0 text-[12px] text-[var(--tint-red-fg)]">
                {fieldError.goal}
              </p>
            ) : null}
          </div>
          {error ? (
            <p role="alert" data-testid="start-error" className="m-0 text-sm text-[var(--tint-red-fg)]">
              {error}
            </p>
          ) : null}
          <Dialog.Footer>
            <Dialog.Cancel onClick={close} testId="start-cancel">
              {t("dialog.cancel")}
            </Dialog.Cancel>
            <Dialog.Action onClick={() => void submit()} disabled={busy} testId="start-submit">
              {busy ? t("dialog.starting") : t("dialog.submit")}
            </Dialog.Action>
          </Dialog.Footer>
        </div>
      )}
    </Dialog>
  );
}
