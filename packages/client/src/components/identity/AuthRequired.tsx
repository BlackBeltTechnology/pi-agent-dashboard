/**
 * `auth_required` reconciliation (D16/D18, H5). Core is a seam only: when a
 * trusted browser-login resolver is active, sign-in invokes the core gate
 * (start phase → IdP redirect → `/callback`). When NO browser login is
 * configured, core ships no sign-in UI of its own — the banner states that no
 * sign-in method is installed. The legacy server-rendered `/auth/login` page
 * is never linked from this client (D18).
 */
import React from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { fetchLoginConfig } from "../../lib/identity/login-config.js";
import { LoginGate } from "./LoginGate.js";

export function AuthRequired({ apiBase: _apiBase }: { apiBase: string }): React.JSX.Element {
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

  const noMethod = (
    <span>{t("connection.noSignInMethod", undefined, "No sign-in method installed")}</span>
  );

  // Sign-in clicked with browser login active → mount the start-phase gate,
  // which auto-redirects to the IdP (and shows its own manual affordance). If
  // the descriptor vanished meanwhile (F5), the gate's fallback states the
  // no-method fact — it never routes to the legacy page (D18).
  if (starting) {
    return (
      <div className="fixed inset-0 z-50 bg-neutral-950">
        <LoginGate phase="start" fallback={<div className="p-4 text-center text-amber-400">{noMethod}</div>} />
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
        noMethod
      )}
    </div>
  );
}
