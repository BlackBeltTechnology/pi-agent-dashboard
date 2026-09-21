/**
 * `login-provider` slot component (D16). Core renders it pre-shell with
 * `{ phase, returnTo, onComplete }`; the plugin owns all OIDC mechanics.
 *
 * `start` phase auto-initiates the redirect once (single-flight ref guard) and
 * always renders a manual sign-in affordance (F4/H4) in case the automatic
 * `location.assign` is blocked. `callback` phase runs the code exchange, then
 * calls `onComplete(returnTo)` so CORE performs the client-side navigation
 * (a full-page nav would discard the in-memory token).
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { SlotPropsMap } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import React from "react";
import { beginLogin, completeLogin } from "./login-flow.js";

type Props = SlotPropsMap["login-provider"];

type Status = "working" | "idle" | "error";

export function KeycloakLogin({ phase, returnTo, onComplete }: Props): React.JSX.Element {
  const t = useT();
  const [status, setStatus] = React.useState<Status>("working");
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (phase === "start") {
      beginLogin(returnTo).catch(() => setStatus("error"));
      return;
    }
    completeLogin(window.location.search)
      .then((r) => {
        if (r.kind === "done") onComplete(r.returnTo);
        else setStatus(r.kind);
      })
      .catch(() => setStatus("error"));
  }, [phase, returnTo, onComplete]);

  const signIn = (): void => {
    setStatus("working");
    beginLogin(returnTo).catch(() => setStatus("error"));
  };

  const manualAffordance = (
    <button
      type="button"
      onClick={signIn}
      className="rounded bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100"
    >
      {t("signIn", undefined, "Sign in")}
    </button>
  );

  const homeLink = (
    <a href="/" className="text-sm text-blue-300 underline">
      {t("returnHome", undefined, "Return home")}
    </a>
  );

  return (
    <div
      data-testid="keycloak-login"
      data-status={status}
      className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-neutral-100"
    >
      {status === "error" ? (
        <>
          <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
            {t("failed", undefined, "Sign-in failed.")}
          </p>
          {homeLink}
        </>
      ) : status === "idle" ? (
        <>
          {manualAffordance}
          {homeLink}
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-400">
            {phase === "callback"
              ? t("completing", undefined, "Completing sign-in…")
              : t("signingIn", undefined, "Redirecting to sign in…")}
          </p>
          {phase === "start" ? manualAffordance : null}
        </>
      )}
    </div>
  );
}
