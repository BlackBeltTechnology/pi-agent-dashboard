/**
 * Sign-in / unavailable / not-admitted gate (A1). Wraps the app only when the
 * host asks for it (standalone); an embedded host is already signed in.
 * See change: add-team-plugin.
 */
import { useOptionalIdentity } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.js";
import { useTeam } from "../state/team-store.js";
import { Icon } from "../ui/icons.js";

type GateKind = "signin" | "redirecting" | "unavailable" | "not-admitted";

function GateView({ kind, onSignIn, onRetry }: { kind: GateKind; onSignIn?: () => void; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="gate">
      <div className="card">
        <span className="brand-mark" aria-hidden="true" style={{ width: "2.5rem", height: "2.5rem" }}>
          <Icon name="people" />
        </span>
        {kind === "signin" || kind === "redirecting" ? (
          <>
            <h1>{t("auth.title")}</h1>
            <p>{t("auth.body")}</p>
            <button type="button" className="btn btn-primary" data-testid="signin" disabled={kind === "redirecting"} onClick={onSignIn}>
              {kind === "redirecting" ? t("auth.redirecting") : t("auth.signIn")}
            </button>
            {kind === "redirecting" ? <span className="sr-only" role="status">{t("auth.redirecting")}</span> : null}
          </>
        ) : kind === "unavailable" ? (
          <>
            <h1>{t("auth.title")}</h1>
            <div className="callout callout-error" role="alert">
              <Icon name="alert" className="ic sm" />
              <div className="grow">
                <p><strong>{t("auth.unavailable")}</strong></p>
                <p>{t("auth.unavailableDetail")}</p>
              </div>
            </div>
            {onRetry ? (
              <button type="button" className="btn btn-secondary" onClick={onRetry}>
                <Icon name="refresh" className="ic sm" />
                {t("grid.retry")}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <h1>{t("app.name")}</h1>
            <div className="callout callout-warning" role="alert">
              <Icon name="warning" className="ic sm" />
              <div className="grow">
                <p><strong>{t("auth.notAdmitted")}</strong></p>
                <p>{t("auth.notAdmittedDetail")}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Gate({ children }: { children: ReactNode }) {
  const id = useOptionalIdentity();
  const team = useTeam();
  const status = team.state.status;

  if (id) {
    if (id.mode === "unavailable") return <GateView kind="unavailable" onRetry={() => window.location.reload()} />;
    if (id.loading && !id.authenticated) return <GateView kind="redirecting" />;
    if (id.mode === "oidc" && !id.authenticated) return <GateView kind="signin" onSignIn={id.signIn} />;
  }
  if (status === "not-admitted") return <GateView kind="not-admitted" />;
  if (status === "unauthorized") {
    return id?.available ? <GateView kind="signin" onSignIn={id.signIn} /> : <GateView kind="unavailable" onRetry={() => void team.refresh()} />;
  }
  return <>{children}</>;
}
