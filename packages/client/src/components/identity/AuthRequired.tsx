/**
 * `auth_required` reconciliation (D16/D18/D19). Core is a seam only: when a
 * trusted browser-login provider is configured, sign-in invokes it. Two kinds:
 *
 *   - SEPARATE-VIEW provider (D19) — the descriptor carries `loginUrl`, so the
 *     affordance is a plain same-origin LINK to the plugin's own page. No
 *     component is mounted and nothing provider-specific enters this bundle.
 *   - COMPONENT provider (D16) — the bundled `login-provider` contribution is
 *     mounted in start phase (IdP redirect → `/callback`).
 *
 * When NO browser login is configured, core ships no sign-in UI of its own: the
 * banner states that no sign-in method is installed. The legacy server-rendered
 * `/auth/login` page is never linked from this client (D18).
 */
import React from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { providerRedirect } from "../../lib/identity/gate.js";
import { fetchLoginConfig, type LoginConfig } from "../../lib/identity/login-config.js";
import { LoginGate } from "./LoginGate.js";

export function AuthRequired({ apiBase: _apiBase }: { apiBase: string }): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = React.useState<LoginConfig | undefined>(undefined);
  const [starting, setStarting] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void fetchLoginConfig().then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const noMethod = <span>{t("connection.noSignInMethod", undefined, "No sign-in method installed")}</span>;
  const signInLabel = t("connection.signIn", undefined, "Sign in");

  // SEPARATE-VIEW provider (D19): a real anchor, so sign-in works without any
  // client JS and nothing provider-specific is bundled. Validated same-origin —
  // an unsafe URL reads as no-method rather than an open redirect.
  const loginUrl = config?.active === true ? providerRedirect(config.loginUrl, window.location.origin) : null;

  // Sign-in clicked with a COMPONENT provider → mount the start-phase gate,
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
      {loginUrl ? (
        <a href={loginUrl} className="underline hover:text-amber-300">
          {signInLabel}
        </a>
      ) : config?.active === true && !config.loginUrl ? (
        <button type="button" onClick={() => setStarting(true)} className="underline hover:text-amber-300">
          {signInLabel}
        </button>
      ) : (
        noMethod
      )}
    </div>
  );
}
