/**
 * Settings → Vault: the explanatory callout shown when the vault refuses this
 * device with `operate_required` and the server named the way out (`remedies`).
 * Info severity, `role="status"`; one row per RECOGNISED remedy in the order the
 * server sent; unknown values are dropped (a newer server may add some). No
 * server-supplied text is rendered — the copy below is fixed.
 *
 * Rendered by the shared `SettingsNotice` (severity-info recipe); links inherit the
 * notice foreground and are underlined (ui-contract a11y #7).
 * See change: surface-operate-required-remedy (mockups/ui-plan.md), align-ui-contract-recipes.
 */

import { SettingsNotice } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiAccountArrowRight, mdiCellphoneKey, mdiLockOutline, mdiLogin, mdiMonitor } from "@mdi/js";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { SafeLink } from "../../../lib/nav/safe-navigation.js";
import { requestAccessTarget } from "../../../lib/pairing/request-access-target.js";

type KnownRemedy = "use-host" | "re-pair" | "request-access" | "sign-in";

const ROWS: Record<KnownRemedy, { icon: string; fallback: string }> = {
  "use-host": { icon: mdiMonitor, fallback: "Open the dashboard on the computer that runs it." },
  "re-pair": {
    icon: mdiCellphoneKey,
    fallback:
      "This device is paired with less than Operate access, and access is fixed when a device is paired. On the host, revoke it in Paired devices, then pair it again with Operate access. Pairing needs an HTTPS address of this dashboard.",
  },
  "request-access": {
    icon: mdiAccountArrowRight,
    fallback:
      "If this dashboard accepts requests from your local network, you can ask for access from this device. Someone at the dashboard computer approves it by typing a code.",
  },
  "sign-in": { icon: mdiLogin, fallback: "Sign in with an operator account." },
};

const isKnown = (r: unknown): r is KnownRemedy => typeof r === "string" && Object.hasOwn(ROWS, r);

interface Props {
  /** As received; unknown or duplicate values are ignored. */
  remedies: readonly unknown[];
  /** The API base of the server that refused (fixed at request time); decides where Request access leads. */
  apiBase: string;
  /** A retry load is in flight: the control is disabled and the callout busy. */
  busy: boolean;
  onRetry: () => void;
}

export function OperateRequiredCallout({ remedies, apiBase, busy, onRetry }: Props) {
  const rows = [...new Set(remedies)].filter(isKnown);
  const access = requestAccessTarget(apiBase, window.location.origin);
  const link = "font-semibold underline text-inherit max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px]";
  return (
    <SettingsNotice
      tone="info"
      icon={mdiLockOutline}
      role="status"
      testId="vault-operate-required"
      className="max-w-[72ch]"
      retrying={busy}
      onRetry={onRetry}
      retryLabel={i18nT("vault.operateRequired.retry", undefined, "Try again")}
      retryTestId="vault-operate-retry"
      remediesLabel={i18nT("vault.operateRequired.listLabel", undefined, "What you can do")}
      remedyTestId="vault-operate-remedy"
      remedies={rows.map((remedy) => ({
        id: remedy,
        icon: ROWS[remedy].icon,
        content: (
          <>
            {i18nT(`vault.operateRequired.${remedy}`, undefined, ROWS[remedy].fallback)}
            {remedy === "request-access" && (
              <>
                {" "}
                <SafeLink
                  href={access.href}
                  {...(access.newContext ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  data-testid="vault-operate-request-access"
                  className={link}
                >
                  {i18nT("vault.operateRequired.requestAccessLink", undefined, "Request access")}
                </SafeLink>
              </>
            )}
            {remedy === "sign-in" && (
              <>
                {" "}
                <a href="/auth/login" data-testid="vault-operate-signin" className={link}>
                  {i18nT("vault.operateRequired.signInLink", undefined, "Sign in")}
                </a>
              </>
            )}
          </>
        ),
      }))}
    >
      <strong className="block font-semibold">{i18nT("vault.operateRequired.title", undefined, "This device can't open the vault")}</strong>
      <p className="mt-1">{i18nT("vault.operateRequired.why", undefined, "The vault shows which keys exist and where they go, so it opens only for an operator.")}</p>
    </SettingsNotice>
  );
}
