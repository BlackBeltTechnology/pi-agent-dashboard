/**
 * Shared bits of the Services pages: state pill (glyph + text, never colour
 * alone), chips, the operate banner/callout, and the inline action error.
 * Theme tokens only — no raw colour literal, text ≥ 12 px, 44 px touch targets
 * below `sm`. See change: add-services-settings-ui.
 */
import { mdiAlertCircleOutline, mdiCellphoneKey, mdiLockOutline, mdiLogin, mdiMonitor } from "@mdi/js";
import type { ReactNode } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import type { ServicesResult } from "../../../lib/services/services-api.js";
import { stateMeta, type Tone } from "../../../lib/services/services-model.js";
import { Callout, TONE_PILL, VIcon } from "../vault/vault-ui.js";

export function StatePill({ state }: { state: string }) {
  const m = stateMeta(state);
  return (
    <span
      data-testid="service-state-pill"
      data-state={state}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_PILL[m.tone]}`}
    >
      <span aria-hidden="true">{m.glyph}</span>
      <span>{m.label}</span>
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

export type KnownRemedy = "use-host" | "re-pair" | "sign-in";
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
    <Callout tone="warning" icon={mdiLockOutline} role="status" testId={testId}>
      <strong className="block font-semibold">{title}</strong>
      <p className="mt-1">{why}</p>
      {rows.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-1 p-0" data-testid={`${testId}-remedies`}>
          {rows.map((r) => (
            <li key={r} data-remedy={r} className="flex items-start gap-2">
              <VIcon path={REMEDY_ROWS[r].icon} className="mt-0.5" />
              <span>
                {i18nT(`services.remedy.${r}`, undefined, REMEDY_ROWS[r].fallback)}
                {r === "sign-in" && (
                  <>
                    {" "}
                    <a href="/auth/login" className="font-semibold underline text-inherit">
                      {i18nT("services.remedy.signInLink", undefined, "Sign in")}
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Callout>
  );
}

/**
 * The failure of one action, shown AT the action: the server's code and hint,
 * or — for 403 `operate_required` — its reason and remedies. Never a toast.
 */
export function ActionFailure({ failure, testId = "service-action-error" }: { failure: ServicesResult<unknown> | null; testId?: string }) {
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
  return (
    <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId={testId}>
      {failure.code && (
        <code data-testid={`${testId}-code`} className="mr-1 font-mono font-semibold">
          {failure.code}
        </code>
      )}
      <span data-testid={`${testId}-message`}>{failure.error}</span>
    </Callout>
  );
}

export const toneOf = (tone: Tone): Tone => tone;

/** Section heading used by the detail page. */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="m-0 mb-2 text-sm font-semibold text-[var(--text-primary)]">
      {children}
    </h3>
  );
}
