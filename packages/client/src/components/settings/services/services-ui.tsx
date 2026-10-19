/**
 * Shared bits of the Services pages: state pill (icon + text, never colour
 * alone), chips, the operate banner/callout, and the inline action error. The
 * pill, callout and error are the runtime kit's `SettingsStatusPill`,
 * `SettingsNotice` and `SettingsActionError`.
 * Theme tokens only — no raw colour literal. See change: add-services-settings-ui,
 * align-ui-contract-recipes.
 */
import { SettingsActionError, SettingsNotice, SettingsStatusPill } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiCellphoneKey, mdiLoading, mdiLockOutline, mdiLogin, mdiMonitor } from "@mdi/js";
import { type ReactNode, useId } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import type { ServicesResult } from "../../../lib/services/services-api.js";
import { stateMeta } from "../../../lib/services/services-model.js";

/** States that are in progress: their icon spins (and stops under reduced motion). */
const IN_PROGRESS = new Set(["starting", "stopping"]);

/** `interactive`: the pill sits inside a button/row, so it uses the kit's 12 px floor instead of 11 px. */
export function StatePill({ state, interactive }: { state: string; interactive?: boolean }) {
  const m = stateMeta(state);
  const busy = IN_PROGRESS.has(state);
  return (
    <span data-testid="service-state-pill" data-state={state} className="inline-flex">
      <SettingsStatusPill tone={m.tone} icon={busy ? mdiLoading : undefined} spinning={busy} interactive={interactive}>
        {m.label}
      </SettingsStatusPill>
    </span>
  );
}

const CHIP_TONES: Record<"neutral" | "blue" | "orange" | "purple", string> = {
  neutral: "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-subtle)]",
  blue: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)] border-[var(--tint-blue-border)]",
  orange: "bg-[var(--tint-orange-bg)] text-[var(--tint-orange-fg)] border-[var(--tint-orange-border)]",
  purple: "bg-[var(--tint-purple-bg)] text-[var(--tint-purple-fg)]  border-[var(--border-subtle)]",
};

export function Chip({ tone = "neutral", children, testId }: { tone?: keyof typeof CHIP_TONES; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs whitespace-nowrap ${CHIP_TONES[tone]}`}>
      {children}
    </span>
  );
}

type KnownRemedy = "use-host" | "re-pair" | "sign-in";
const REMEDY_ROWS: Record<KnownRemedy, { icon: string; fallback: string }> = {
  "use-host": { icon: mdiMonitor, fallback: "Open the dashboard on the computer that runs it." },
  "re-pair": {
    icon: mdiCellphoneKey,
    fallback:
      "This device is paired with less than Operate access, and access is fixed when a device is paired. On the host, revoke it in Paired devices, then pair it again with Operate access.",
  },
  "sign-in": { icon: mdiLogin, fallback: "Sign in with an operator account." },
};
const ALL_REMEDIES: KnownRemedy[] = ["use-host", "re-pair", "sign-in"];
const isKnownRemedy = (r: unknown): r is KnownRemedy => typeof r === "string" && Object.hasOwn(REMEDY_ROWS, r);

/**
 * The operate-authority explanation: one banner on a read-only page (no
 * `remedies` given → every remedy is listed), or inline at an action the server
 * refused with 403 `operate_required` (its own remedies, unknown ones dropped).
 * No server-supplied text is rendered — the copy is fixed.
 */
export function ServicesOperateCallout({ remedies, title, why, testId }: { remedies?: readonly unknown[]; title: string; why: string; testId: string }) {
  const rows = (remedies ? [...new Set(remedies)].filter(isKnownRemedy) : ALL_REMEDIES) as KnownRemedy[];
  return (
    <SettingsNotice
      tone="warning"
      icon={mdiLockOutline}
      role="status"
      testId={testId}
      remedies={rows.map((r) => ({
        id: r,
        icon: REMEDY_ROWS[r].icon,
        content: (
          <>
            {i18nT(`services.remedy.${r}`, undefined, REMEDY_ROWS[r].fallback)}
            {r === "sign-in" && (
              <>
                {" "}
                <a href="/auth/login" className="font-semibold underline text-inherit">
                  {i18nT("services.remedy.signInLink", undefined, "Sign in")}
                </a>
              </>
            )}
          </>
        ),
      }))}
    >
      <strong className="block font-semibold">{title}</strong>
      <p className="mt-1">{why}</p>
    </SettingsNotice>
  );
}

/**
 * The failure of one action, shown AT the action: one plain sentence, with the
 * server's code and message behind "Copy details" (never in the visible text) —
 * or, for 403 `operate_required`, its reason and remedies. Never a toast.
 * `id` is the alert's element id; point the failed control's `aria-describedby` at it.
 */
export function ActionFailure({ failure, testId = "service-action-error", id }: { failure: ServicesResult<unknown> | null; testId?: string; id?: string }) {
  const autoId = useId();
  if (!failure || failure.ok) return null;
  if (failure.code === "operate_required") {
    return (
      <ServicesOperateCallout
        testId={`${testId}-operate`}
        remedies={failure.remedies ?? []}
        title={i18nT("services.operateRequired.title", undefined, "This needs operate access")}
        why={
          failure.reason === "tier-too-low"
            ? i18nT("services.operateRequired.tierTooLow", undefined, "This device's credential is below operate access, so it cannot change services.")
            : i18nT("services.operateRequired.noCredential", undefined, "Changing services needs an operator credential or a trusted local caller.")
        }
      />
    );
  }
  const details = [failure.code, failure.error].filter(Boolean).join(": ");
  return (
    <SettingsActionError id={id ?? autoId} testId={testId} details={details || null}>
      {i18nT("services.actionFailed", undefined, "That didn't work. Try again; if it keeps failing, copy the details.")}
    </SettingsActionError>
  );
}

/** Section heading used by the detail page. */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="m-0 mb-2 text-sm font-semibold text-[var(--text-primary)]">
      {children}
    </h3>
  );
}
