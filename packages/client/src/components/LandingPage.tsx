import React from "react";

export interface LandingPageProps {
  /** True when at least one LLM provider has a non-empty apiKey. */
  providersReady?: boolean;
  /** Number of pinned directories. */
  pinnedCount?: number;
  /** Number of active sessions. */
  sessionsCount?: number;
  /** First pinned cwd (null when none). Used as the target for step 3. */
  firstPinnedCwd?: string | null;
  /** Opens the app-level PinDirectoryDialog. */
  onOpenPinDialog?: () => void;
  /** Spawns a session in the given cwd. */
  onSpawnSession?: (cwd: string) => void;
  /** Router navigation function (e.g. wouter's navigate). */
  navigate?: (to: string) => void;
}

type StepState = "pending" | "done" | "locked";

function truncatePath(p: string, max = 40): string {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}

function DoneRow({ testId, label }: { testId: string; label: string }) {
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2 text-sm text-[var(--text-secondary)] px-3 py-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
    >
      <span className="text-green-500" aria-hidden>✔</span>
      <span>{label}</span>
    </div>
  );
}

function Card({
  step,
  title,
  description,
  hint,
  ctaLabel,
  ctaTestId,
  disabled,
  onClick,
  titleAttr,
}: {
  step: number;
  title: string;
  description: string;
  hint?: string;
  ctaLabel: string;
  ctaTestId: string;
  disabled: boolean;
  onClick: () => void;
  titleAttr?: string;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] w-full sm:w-56">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-tertiary)]">Step {step}</span>
      </div>
      <div className="text-base font-semibold text-[var(--text-primary)]">{title}</div>
      <div className="text-xs text-[var(--text-tertiary)] flex-1">{description}</div>
      {hint && (
        <div className="text-[11px] text-amber-500/80">{hint}</div>
      )}
      <button
        data-testid={ctaTestId}
        onClick={onClick}
        disabled={disabled}
        title={titleAttr}
        className={
          "text-sm px-3 py-1.5 rounded border transition-colors " +
          (disabled
            ? "border-[var(--border-secondary)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
            : "border-blue-500/50 text-blue-400 hover:bg-blue-500/10")
        }
      >
        {ctaLabel}
      </button>
    </div>
  );
}

export function LandingPage({
  providersReady = false,
  pinnedCount = 0,
  sessionsCount = 0,
  firstPinnedCwd = null,
  onOpenPinDialog,
  onSpawnSession,
  navigate,
}: LandingPageProps = {}) {
  // Legacy behaviour: if no onboarding props are supplied at all, fall back to the
  // original minimal placeholder (keeps existing tests and stories intact).
  const hasOnboardingContext =
    onOpenPinDialog !== undefined ||
    onSpawnSession !== undefined ||
    navigate !== undefined;

  if (!hasOnboardingContext) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <div className="text-center">
          <div className="text-6xl mb-4 text-blue-500 opacity-50">π</div>
          <p className="text-sm">Select a session to get started</p>
        </div>
      </div>
    );
  }

  // Derive states per design.md D1
  const step1: StepState = providersReady ? "done" : "pending";
  const step2: StepState = !providersReady
    ? "locked"
    : pinnedCount > 0
      ? "done"
      : "pending";
  const step3: StepState = pinnedCount === 0
    ? "locked"
    : sessionsCount > 0
      ? "done"
      : "pending";

  const allDone = step1 === "done" && step2 === "done" && step3 === "done";

  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
      <div className="flex flex-col items-center gap-6 w-full max-w-3xl">
        <div className="text-center">
          <div className="text-6xl mb-2 text-blue-500 opacity-50">π</div>
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            {allDone ? "Pick a session on the left to continue" : "Welcome to pi-dashboard"}
          </div>
          {!allDone && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Three quick steps to get your first session running.
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full justify-center flex-wrap">
          {/* Step 1 */}
          {step1 === "done" ? (
            <DoneRow testId="onboarding-step-1-done" label="Credentials configured" />
          ) : (
            <Card
              step={1}
              title="Setup credentials"
              description="Connect an LLM provider (Anthropic, OpenAI, …) so sessions can reach a model."
              ctaLabel="Open settings"
              ctaTestId="onboarding-step-1-cta"
              disabled={false}
              onClick={() => navigate?.("/settings?tab=providers")}
            />
          )}

          {/* Step 2 */}
          {step2 === "done" ? (
            <DoneRow
              testId="onboarding-step-2-done"
              label={`${pinnedCount} folder${pinnedCount === 1 ? "" : "s"} pinned`}
            />
          ) : (
            <Card
              step={2}
              title="Add folder"
              description="Pin a project directory to the sidebar so you can spawn sessions inside it."
              hint={step2 === "locked" ? "Requires: credentials" : undefined}
              ctaLabel="Add folder…"
              ctaTestId="onboarding-step-2-cta"
              disabled={step2 === "locked"}
              titleAttr={
                step2 === "locked" ? "Set up credentials first" : undefined
              }
              onClick={() => onOpenPinDialog?.()}
            />
          )}

          {/* Step 3 */}
          {step3 === "done" ? (
            <DoneRow
              testId="onboarding-step-3-done"
              label={`${sessionsCount} active session${sessionsCount === 1 ? "" : "s"}`}
            />
          ) : (
            <Card
              step={3}
              title="Start session"
              description={
                firstPinnedCwd
                  ? `+Session: a pi session in ${truncatePath(firstPinnedCwd)}.`
                  : "+Session: your first pi session in a pinned folder."
              }
              hint={step3 === "locked" ? "Requires: a pinned folder" : undefined}
              ctaLabel="Start session"
              ctaTestId="onboarding-step-3-cta"
              disabled={step3 === "locked" || !firstPinnedCwd}
              titleAttr={
                step3 === "locked" ? "Pin a folder first" : undefined
              }
              onClick={() => firstPinnedCwd && onSpawnSession?.(firstPinnedCwd)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
