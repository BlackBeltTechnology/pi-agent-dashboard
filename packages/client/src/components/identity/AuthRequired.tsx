/**
 * `auth_required` reconciliation (D16, H5). The legacy banner linked to the
 * server-rendered `/auth/login` page (topology-A cookie auth). When a trusted
 * browser-login resolver is active, sign-in must instead invoke the core gate
 * (start phase → IdP redirect → `/callback`). This component picks the right
 * affordance from the live login descriptor and falls back to the legacy link
 * when no browser login is configured, so non-identity deployments are unchanged.
 */
import React from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { fetchLoginConfig } from "../../lib/identity/login-config.js";
import { LoginGate } from "./LoginGate.js";

export function AuthRequired({ apiBase }: { apiBase: string }): React.JSX.Element {
  const { t } = useI18n();
  const [active, setActive] = React.useState<boolean | undefined>(undefined);
  const [starting, setStarting] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void fetchLoginConfig().then((c) => {
      if (alive) setActive(c.active);
    });
    return () => {
      alive = false;
    };
  }, []);

  const legacyLink = (
    <a
      href={`${apiBase}/auth/login?return=${encodeURIComponent(window.location.pathname)}`}
      className="underline hover:text-amber-300"
    >
      {t("connection.signIn", undefined, "Sign in")}
    </a>
  );

  // Sign-in clicked with browser login active → mount the start-phase gate,
  // which auto-redirects to the IdP (and shows its own manual affordance). The
  // gate falls back to the legacy link if the descriptor vanished meanwhile (F5).
  if (starting) {
    return (
      <div className="fixed inset-0 z-50 bg-neutral-950">
        <LoginGate phase="start" fallback={<div className="p-4 text-center text-amber-400">{legacyLink}</div>} />
      </div>
    );
  }

  return (
    <div className="bg-amber-600/20 text-amber-400 text-xs px-3 py-1 text-center">
      {t("connection.authRequired", undefined, "Session expired")}
      {" - "}
      {active ? (
        <button type="button" onClick={() => setStarting(true)} className="underline hover:text-amber-300">
          {t("connection.signIn", undefined, "Sign in")}
        </button>
      ) : (
        legacyLink
      )}
    </div>
  );
}
