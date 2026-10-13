/**
 * Settings → Vault: the explanatory callout shown when the vault refuses this
 * device with `operate_required` and the server named the way out (`remedies`).
 * Info severity, `role="status"`; one row per RECOGNISED remedy in the order the
 * server sent; unknown values are dropped (a newer server may add some). No
 * server-supplied text is rendered — the copy below is fixed.
 *
 * Styling: theme tokens only (severity-info callout recipe); links inherit the
 * callout foreground and are underlined (ui-contract a11y #7).
 * See change: surface-operate-required-remedy (mockups/ui-plan.md).
 */
import { mdiCellphoneKey, mdiLockOutline, mdiLogin, mdiMonitor, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useId } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";

type KnownRemedy = "use-host" | "re-pair" | "sign-in";

const ROWS: Record<KnownRemedy, { icon: string; fallback: string }> = {
  "use-host": { icon: mdiMonitor, fallback: "Open the dashboard on the computer that runs it." },
  "re-pair": {
    icon: mdiCellphoneKey,
    fallback:
      "This device is paired with less than Operate access, and access is fixed when a device is paired. On the host, revoke it in Paired devices, then pair it again with Operate access. Pairing needs an HTTPS address of this dashboard.",
  },
  "sign-in": { icon: mdiLogin, fallback: "Sign in with an operator account." },
};

const isKnown = (r: unknown): r is KnownRemedy => typeof r === "string" && Object.hasOwn(ROWS, r);

interface Props {
  /** As received; unknown or duplicate values are ignored. */
  remedies: readonly unknown[];
  /** A retry load is in flight: the control is disabled and the callout busy. */
  busy: boolean;
  onRetry: () => void;
}

export function OperateRequiredCallout({ remedies, busy, onRetry }: Props) {
  const labelId = useId();
  const rows = [...new Set(remedies)].filter(isKnown);
  return (
    <div
      data-testid="vault-operate-required"
      role="status"
      aria-busy={busy}
      className="flex gap-2 rounded-md border p-3 text-sm max-w-[72ch] bg-[var(--severity-info-bg)] border-[var(--severity-info-border)] text-[var(--severity-info-fg)]"
    >
      <Icon path={mdiLockOutline} size={0.67} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <strong className="block font-semibold">{i18nT("vault.operateRequired.title", undefined, "This device can't open the vault")}</strong>
        <p className="mt-1">
          {i18nT("vault.operateRequired.why", undefined, "The vault shows which keys exist and where they go, so it opens only for an operator.")}
        </p>
        <p id={labelId} className="mt-3 mb-1 text-xs font-semibold">
          {i18nT("vault.operateRequired.listLabel", undefined, "What you can do")}
        </p>
        <ul aria-labelledby={labelId} className="list-none m-0 p-0">
          {rows.map((remedy, i) => (
            <li
              key={remedy}
              data-testid="vault-operate-remedy"
              data-remedy={remedy}
              className={`flex items-start gap-2 py-1${i > 0 ? " border-t border-[var(--severity-info-border)]" : ""}`}
            >
              <Icon path={ROWS[remedy].icon} size={0.67} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {i18nT(`vault.operateRequired.${remedy}`, undefined, ROWS[remedy].fallback)}
                {remedy === "sign-in" && (
                  <>
                    {" "}
                    <a
                      href="/auth/login"
                      data-testid="vault-operate-signin"
                      className="font-semibold underline text-inherit max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px]"
                    >
                      {i18nT("vault.operateRequired.signInLink", undefined, "Sign in")}
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <button
            type="button"
            data-testid="vault-operate-retry"
            disabled={busy}
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-inherit hover:bg-[var(--bg-hover)] disabled:opacity-60 max-sm:min-h-[44px]"
          >
            <Icon path={mdiRefresh} size={0.6} aria-hidden="true" />
            {i18nT("vault.operateRequired.retry", undefined, "Try again")}
          </button>
        </div>
      </div>
    </div>
  );
}
