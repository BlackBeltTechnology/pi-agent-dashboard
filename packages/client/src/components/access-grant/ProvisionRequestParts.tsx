/**
 * Shared building blocks of a provisioning request, rendered by BOTH the dialog
 * (`ProvisionPromptDialog`) and the Access page cards (`AccessProvisioningSection`)
 * so an answer on the page is never less informed than one in the dialog
 * (change: add-access-provisioning, tasks 3.2-3.4; mockups/ui-plan.md S1-S4).
 *
 * - `useProvisionAnswer`: per-line approve state + pi-trust choice. Nothing is
 *   preselected; `answerLines()` builds the D9 wire shape (omitted piTrust is
 *   never sent for a line that is not a project root; an approved project-root
 *   line always carries the explicit choice, default unchecked).
 * - `ProvisionLines`: every line with its REAL path, bounded inert reason
 *   (React text only) and class pill (icon + word, never colour alone). An
 *   approve control only on `grantable` lines, only when answerable.
 * - `ProvisionRemoteGoals`: hand-off actions that open `RemoteAccessDialog` on
 *   its landing (no `initialRun`) and name the task to choose there (D10).
 * - `ProvisionConsequence`: reach + consent-not-protection statements (D11).
 */
import type {
  ProvisionLineClassification,
  ProvisionRemoteTarget,
  ProvisionRequestLine,
  ProvisionResponseMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  mdiAlertOutline,
  mdiCancel,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiFolderCheckOutline,
  mdiFolderOffOutline,
  mdiFolderOutline,
  mdiOpenInNew,
  mdiShieldLockOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type Severity, severityPill } from "../connectivity/connectivity-ui.js";
import { PiTrustCheckbox, usePiTrustChoice } from "./PiTrustCheckbox.js";

// The wizard stays off the entry chunk: it loads on first hand-off.
const RemoteAccessDialog = lazy(() =>
  import("../remote-access/RemoteAccessDialog.js").then((m) => ({ default: m.RemoteAccessDialog })),
);

/** The server marks an absent / empty reason with this text (`PROVISION_NO_REASON`). */
const NO_REASON = "no reason given";

interface ClassView {
  severity: Severity;
  icon: string;
  label: string;
  /** English explanation; empty = none needed (the line is the request). */
  exp: string;
}

const CLASS_EN: Record<ProvisionLineClassification, ClassView> = {
  invalid: {
    severity: "warning",
    icon: mdiAlertOutline,
    label: "Not a valid path",
    exp: "This can't be read as a path, so nothing was resolved.",
  },
  missing: {
    severity: "warning",
    icon: mdiFolderOffOutline,
    label: "Not a folder",
    exp: "No folder exists at this path. A file doesn't count.",
  },
  forbidden: {
    severity: "error",
    icon: mdiCancel,
    label: "Can't be granted",
    exp: "This folder can't be granted to anyone, for example your home folder.",
  },
  sensitive: {
    severity: "error",
    icon: mdiShieldLockOutline,
    label: "Credential folder",
    exp: "Holds credentials, or contains a folder that does. Never provisioned.",
  },
  "in-root": {
    severity: "neutral",
    icon: mdiFolderCheckOutline,
    label: "In the project folder",
    exp: "Sessions in this project already have it. No grant needed.",
  },
  covered: {
    severity: "success",
    icon: mdiCheckCircleOutline,
    label: "Already allowed",
    exp: "An existing grant already admits this folder.",
  },
  grantable: { severity: "info", icon: mdiFolderOutline, label: "Needs your approval", exp: "" },
};

const GOAL_EN: Record<ProvisionRemoteTarget, { name: string; task: string }> = {
  lan: { name: "Reach this dashboard from other devices on your network", task: "Allow devices on my network" },
  internet: { name: "Share this dashboard over the internet", task: "Share over the internet" },
  device: { name: "Sign in from a phone or laptop", task: "Let a phone or laptop in" },
};

// ── answer state ─────────────────────────────────────────────────────────────

export interface ProvisionAnswer {
  approved: ReadonlySet<string>;
  grantableCount: number;
  allSelected: boolean;
  toggle(lineId: string): void;
  /** Tick every grantable line, or clear the selection when all are ticked. */
  toggleAll(): void;
  trustFor(line: ProvisionRequestLine): boolean;
  setTrust(lineId: string, value: boolean): void;
  /** Ticked lines approve; every other line is rejected. */
  answerLines(): ProvisionResponseMessage["lines"];
  /** Every line rejected: dismissal / "Reject all". */
  rejectLines(): ProvisionResponseMessage["lines"];
}

export function useProvisionAnswer(lines: readonly ProvisionRequestLine[]): ProvisionAnswer {
  const grantable = lines.filter((l) => l.classification === "grantable");
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const [trust, setTrustMap] = useState<ReadonlyMap<string, boolean>>(new Map());
  // One source-default read for the whole request; per-line choices override it.
  const [seedTrust] = usePiTrustChoice("accessGrants");
  const allSelected = grantable.length > 0 && grantable.every((l) => approved.has(l.lineId));
  const trustFor = (l: ProvisionRequestLine) => trust.get(l.lineId) ?? seedTrust;
  return {
    approved,
    grantableCount: grantable.length,
    allSelected,
    toggle: (id) =>
      setApproved((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    toggleAll: () => setApproved(allSelected ? new Set() : new Set(grantable.map((l) => l.lineId))),
    trustFor,
    setTrust: (id, value) => setTrustMap((prev) => new Map(prev).set(id, value)),
    answerLines: () =>
      lines.map((l) =>
        approved.has(l.lineId)
          ? { lineId: l.lineId, verdict: "approve" as const, ...(l.projectRoot ? { piTrust: trustFor(l) } : {}) }
          : { lineId: l.lineId, verdict: "reject" as const },
      ),
    rejectLines: () => lines.map((l) => ({ lineId: l.lineId, verdict: "reject" as const })),
  };
}

// ── lines ────────────────────────────────────────────────────────────────────

const H4 = "text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]";

function ReasonText({ why }: { why: string }) {
  if (why === NO_REASON) {
    return <span className="italic text-[var(--text-tertiary)]">{i18nT("provision.noReason", undefined, NO_REASON)}</span>;
  }
  // The server cuts at 200 characters and appends one `…`.
  const cut = why.length > 200 && why.endsWith("…");
  return (
    <>
      {cut ? why.slice(0, -1) : why}
      {cut && (
        <span
          data-testid="provision-line-cut"
          title={i18nT("provision.cutHint", undefined, "The reason was longer than 200 characters and was shortened.")}
          className="ml-1 px-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-secondary)] text-xs font-semibold whitespace-nowrap"
        >
          {i18nT("provision.cut", undefined, "… cut")}
        </span>
      )}
    </>
  );
}

function ProvisionLine({
  line,
  answer,
  answerable,
}: {
  line: ProvisionRequestLine;
  answer: ProvisionAnswer;
  answerable: boolean;
}) {
  const cls = line.classification;
  const view = CLASS_EN[cls] ?? CLASS_EN.invalid;
  const grantable = cls === "grantable";
  const exp = i18nT(`provision.class.${cls}.exp`, undefined, view.exp);
  return (
    <li
      data-testid="provision-line"
      data-class={cls}
      data-line-id={line.lineId}
      className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2"
    >
      <div className="min-w-0 space-y-0.5">
        <code data-testid="provision-line-path" className="block font-mono text-sm break-all text-[var(--text-primary)]">
          {line.path}
        </code>
        <div data-testid="provision-line-reason" className="text-xs text-[var(--text-secondary)] break-words">
          <span className="text-[var(--text-tertiary)]">{i18nT("provision.reasonLabel", undefined, "Reason:")}</span>{" "}
          <ReasonText why={line.why} />
        </div>
        <div data-testid="provision-line-class" className="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs text-[var(--text-secondary)]">
          <span className={severityPill(view.severity, true)}>
            <Icon path={view.icon} size={0.5} aria-hidden="true" />
            {i18nT(`provision.class.${cls}.label`, undefined, view.label)}
          </span>
          {exp && <span className="min-w-0 flex-1 basis-[14ch]">{exp}</span>}
        </div>
      </div>
      {grantable && answerable && (
        <label className="inline-flex items-center gap-2 min-h-[44px] sm:min-h-[36px] px-2 rounded text-xs font-semibold text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus-ring)] whitespace-nowrap justify-self-start">
          <input
            type="checkbox"
            data-testid="provision-line-approve"
            aria-label={i18nT("provision.approveAria", { path: line.path }, "Approve {path}")}
            checked={answer.approved.has(line.lineId)}
            onChange={() => answer.toggle(line.lineId)}
            className="w-4 h-4 accent-[var(--accent-solid)]"
          />
          {i18nT("provision.approve", undefined, "Approve")}
        </label>
      )}
      {grantable && !answerable && (
        <span data-testid="provision-line-readonly" className="self-center text-xs text-[var(--text-tertiary)] whitespace-nowrap">
          {i18nT("provision.readOnly", undefined, "Read-only")}
        </span>
      )}
      {grantable && answerable && line.projectRoot && (
        <div className="sm:col-span-2 pt-1.5 border-t border-dashed border-[var(--border-secondary)]">
          <PiTrustCheckbox
            checked={answer.trustFor(line)}
            onChange={(v) => answer.setTrust(line.lineId, v)}
            testId={`provision-pi-trust-${line.lineId}`}
          />
        </div>
      )}
    </li>
  );
}

export function ProvisionLines({
  lines,
  answerable,
  answer,
}: {
  lines: readonly ProvisionRequestLine[];
  answerable: boolean;
  answer: ProvisionAnswer;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
        <h4 className={H4}>{i18nT("provision.folders", { count: lines.length }, "Folders ({count})")}</h4>
        <span aria-live="polite" className="ml-auto">
          {i18nT("provision.canApprove", { count: answer.grantableCount }, "{count} can be approved")}
          {answerable && (
            <>
              {" · "}
              <span data-testid="provision-selected-count">
                {i18nT("provision.selectedCount", { count: answer.approved.size }, "{count} selected")}
              </span>
            </>
          )}
        </span>
      </div>
      {answerable && answer.grantableCount > 1 && (
        <button
          type="button"
          data-testid="provision-select-all"
          onClick={answer.toggleAll}
          className="focus-ring px-2 py-1 rounded text-xs border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          {answer.allSelected
            ? i18nT("provision.clearSelection", undefined, "Clear selection")
            : i18nT("provision.selectAll", undefined, "Select all that need approval")}
        </button>
      )}
      <ul className="border border-[var(--border-primary)] rounded divide-y divide-[var(--border-primary)] bg-[var(--bg-secondary)]">
        {lines.map((l) => (
          <ProvisionLine key={l.lineId} line={l} answer={answer} answerable={answerable} />
        ))}
      </ul>
    </div>
  );
}

// ── remote goals ─────────────────────────────────────────────────────────────

export function ProvisionRemoteGoals({ goals }: { goals: readonly ProvisionRemoteTarget[] }) {
  const [opened, setOpened] = useState<ReadonlySet<ProvisionRemoteTarget>>(new Set());
  const [wizardOpen, setWizardOpen] = useState(false);
  if (goals.length === 0) return null;
  return (
    <div data-testid="provision-goals" className="space-y-1.5">
      <h4 className={H4}>{i18nT("provision.goals", { count: goals.length }, "Remote access ({count})")}</h4>
      <p className="text-xs text-[var(--text-tertiary)]">
        {i18nT("provision.goalsNote", undefined, "These open the Remote access wizard. This request changes nothing there.")}
      </p>
      {goals.map((g) => {
        const copy = GOAL_EN[g];
        if (!copy) return null;
        const task = i18nT(`provision.goal.${g}.task`, undefined, copy.task);
        return (
          <div
            key={g}
            data-testid="provision-goal"
            data-goal={g}
            className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 border border-[var(--border-primary)] rounded bg-[var(--bg-secondary)]"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {i18nT(`provision.goal.${g}.name`, undefined, copy.name)}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                {i18nT("provision.goalChoose", { task }, "In Remote access, choose “{task}”.")}
              </div>
              {opened.has(g) && (
                <span data-testid="provision-goal-opened" className={severityPill("success", false)}>
                  <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
                  {i18nT("provision.remoteOpened", undefined, "Remote access opened")}
                </span>
              )}
            </div>
            <button
              type="button"
              data-testid="provision-open-remote"
              onClick={() => {
                setOpened((prev) => new Set(prev).add(g));
                setWizardOpen(true);
              }}
              className="focus-ring inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 rounded text-xs font-semibold border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] justify-self-start cursor-pointer"
            >
              <Icon path={mdiOpenInNew} size={0.55} aria-hidden="true" />
              {i18nT("provision.openRemote", undefined, "Open Remote access")}
            </button>
          </div>
        );
      })}
      {wizardOpen && (
        <Suspense fallback={null}>
          <RemoteAccessDialog onClose={() => setWizardOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

// ── consequence ──────────────────────────────────────────────────────────────

/** Consent-not-protection statement (D11); a second copy with its own `testId` may sit in a dialog body on narrow screens. */
export function ProvisionConsent({ testId = "provision-consent", className = "" }: { testId?: string; className?: string }) {
  return (
    <p data-testid={testId} className={`text-xs text-[var(--text-secondary)] ${className}`}>
      {i18nT(
        "provision.consent",
        undefined,
        "Approving records your consent. It does not protect against a program on this machine that changes access by other means.",
      )}
    </p>
  );
}

/** Reach + consent. `narrowConsentInBody`: hide the consent sentence below `sm` (the dialog repeats it in its scroll region). */
export function ProvisionConsequence({ narrowConsentInBody = false }: { narrowConsentInBody?: boolean }) {
  return (
    <div
      data-testid="provision-consequence"
      className="space-y-1 px-2.5 py-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)]"
    >
      <p>
        <strong className="text-[var(--text-primary)]">
          {i18nT(
            "provision.reach",
            undefined,
            "Approved folders become readable and writable by every session on this machine",
          )}
        </strong>{" "}
        {i18nT("provision.reachTail", undefined, "until you revoke them in Settings → Access.")}
      </p>
      <ProvisionConsent className={narrowConsentInBody ? "hidden sm:block" : ""} />
    </div>
  );
}
