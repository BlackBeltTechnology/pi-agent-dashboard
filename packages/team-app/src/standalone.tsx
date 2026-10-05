/**
 * Standalone entry (`/apps/team/`): own document, own chrome. Same origin as the
 * dashboard (default) signs in through the dashboard login seam; a foreign
 * origin (`config.json` `dashboardUrl`) uses app-kit's OIDC PKCE client.
 * See change: add-team-plugin (D11/D14/D16).
 */
import { dashboardOrigin, initIdentity } from "@blackbelt-technology/pi-dashboard-app-kit";
import {
  AppHostProvider,
  buildOidcConfig,
  createStandaloneHost,
  OidcIdentityBridge,
  StandaloneBar,
  useOptionalIdentity,
} from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "react-oidc-context";
import { Router } from "wouter";
import { TeamApp } from "./TeamApp.js";
import teamApp from "./team-app.js";
import { useT } from "./i18n/index.js";
import { Gate } from "./shell/Gate.js";
import { SeamIdentityProvider } from "./shell/seam-identity.js";
import { useTeam } from "./state/team-store.js";
import { Icon } from "./ui/icons.js";
import "./styles/index.css";

const BASE = "/apps/team";

function UserChip() {
  const t = useT();
  const id = useOptionalIdentity();
  const { state } = useTeam();
  if (state.me?.mode === "single") return <span className="pill-local">{t("user.local")}</span>;
  if (!id?.authenticated || !id.operator) return null;
  const name = id.username ?? id.operator.name ?? id.operator.sub;
  return (
    <span className="user-chip">
      <span className="initials" aria-hidden="true">{[...name][0]?.toUpperCase()}</span>
      <span className="user-name">
        {name}
        {state.me?.admin ? ` · ${t("user.admin")}` : ""}
      </span>
      <button type="button" className="btn btn-ghost btn-icon" aria-label={t("user.signOut")} onClick={id.signOut}>
        <Icon name="logout" />
      </button>
    </span>
  );
}

function Shell() {
  return (
    <>
      <StandaloneBar app={teamApp}>
        <UserChip />
      </StandaloneBar>
      <main id="main" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Gate>
          <TeamApp />
        </Gate>
      </main>
    </>
  );
}

async function main(): Promise<void> {
  const host = await createStandaloneHost({ appId: "team", basePath: BASE, defaultLanguage: "hu" });
  const foreign = dashboardOrigin() !== window.location.origin;
  let identity: ReactNode;
  if (foreign) {
    const login = await initIdentity();
    identity =
      login.mode === "oidc" ? (
        <AuthProvider {...buildOidcConfig(login.descriptor, { redirectUri: `${window.location.origin}${BASE}/auth/callback` })}>
          <OidcIdentityBridge providerLabel={login.descriptor.label}>
            <Shell />
          </OidcIdentityBridge>
        </AuthProvider>
      ) : login.mode === "none" ? (
        <OidcIdentityBridge>
          <Shell />
        </OidcIdentityBridge>
      ) : (
        <OidcIdentityBridge mode="unavailable">
          <Shell />
        </OidcIdentityBridge>
      );
  } else {
    identity = (
      <SeamIdentityProvider>
        <Shell />
      </SeamIdentityProvider>
    );
  }
  const root = document.getElementById("root");
  if (!root) throw new Error("#root missing");
  createRoot(root).render(
    <StrictMode>
      <AppHostProvider host={host}>
        <Router base={BASE}>{identity}</Router>
      </AppHostProvider>
    </StrictMode>,
  );
}

void main();
