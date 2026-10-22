import React from "react";
import ReactDOM from "react-dom/client";
import { Router, useLocation } from "wouter";
import { navigate } from "wouter/use-browser-location";
import App from "./App.js";
import { LoginPage, SigningInPage } from "./components/identity/LoginPage.js";
import { ThemeProvider } from "./components/settings/ThemeProvider.js";
import { MobileProvider } from "./hooks/useMobile.js";
import { I18nProvider } from "./lib/i18n/i18n.js";
import { fetchLoginConfig } from "./lib/identity/login-config.js";
import { bootLoginSession, useLoginSession } from "./lib/identity/login-session.js";
import "./index.css";
// KaTeX styles load with the lazy math engine (lib/preview/math-engine.ts).
// See change: shrink-client-entry-lazy-islands.

import { UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { hasLiveToken, setAccessToken, setIdToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { LoginGate } from "./components/identity/LoginGate.js";
import { installFetchWrappers } from "./lib/api/install-fetch-wrappers.js";
import { bootClient } from "./lib/boot/client-boot.js";
import { migrateLegacyDeviceBearer } from "./lib/pairing/device-auth.js";
import { createHostPrimitiveRegistry } from "./lib/plugins/host-primitives.js";
import { installUnhandledRejectionReporter } from "./lib/report-error.js";
import { installTrustedTypes } from "./lib/security/trusted-types.js";

// `/pair` is a device-only landing; load it on demand so it stays off the
// dashboard's cold-landing entry chunk (mdi-chunk-size gzip cap).
// See change: add-pairing-approval-dialog.
const PairLanding = React.lazy(() =>
  import("./components/connectivity/PairLanding.js").then((m) => ({ default: m.PairLanding })),
);

// Global unhandled-rejection reporter — the regression guard for the promise
// handling cleanup. Installed as the first executable statement so a rejection
// escaping any startup path is observed rather than silently dropped.
// See change: cleanup-client-plugin-promises (design D2).
installUnhandledRejectionReporter();

// Trusted Types policies (named + exactly one `default`) before any other code
// can reach an HTML / script sink. Idempotent; `bootClient` re-asserts it
// before the first render. See change: harden-client-sinks (D5).
installTrustedTypes();

// UI primitive registry — see change: add-plugin-ui-primitive-registry. The full
// registration list (every UI_PRIMITIVE_KEYS entry, incl. the self-providing
// `ui:chat-view` / `ui:elapsed-badge`) lives in `createHostPrimitiveRegistry()`,
// shared with the standalone chat-embed. See change: decouple-plugins-from-core.
const primitiveRegistry = createHostPrimitiveRegistry();

// Install the global fetch wrappers (single ordered seam — see
// lib/api/install-fetch-wrappers.ts): paired-device bearer on same-origin
// `/api/*` (make-pairing-qr-camera-scannable), access-prompt capability echo
// (add-access-grant-dialog), then the API-base rewrite that makes un-prefixed
// `/api/` fetches follow the selected server (fix-remote-relative-api-fetch).
// Installed before any fetch fires.
installFetchWrappers();
// Move a legacy localStorage device bearer into the httpOnly cookie (same-origin only).
// See change: harden-trust-and-credential-boundaries (D5).
void migrateLegacyDeviceBearer();

// D22 dashboard-UI login: consume the login plugin's return (`#pi_handoff`,
// `#pi_login_error`, `?pi_signed_out=1`) BEFORE <App/> mounts, stripping it from
// the address bar at once. A handoff code is exchanged for an IN-MEMORY bearer
// (no cookies), so App's first socket already carries a ticket. Enforced + no
// token ⇒ straight to the core login page `/login`: no dashboard ever renders
// while signed out.
void bootLoginSession({
  location: window.location,
  history: window.history,
  storage: window.sessionStorage,
  persist: window.localStorage,
  fetchFn: (...a) => window.fetch(...a),
  fetchConfig: fetchLoginConfig,
  setToken: setAccessToken,
  setIdToken,
  hasToken: () => hasLiveToken(),
  navigate: (to) => navigate(to, { replace: true }),
});

// `/pair` — the phone-camera pairing landing. A scanned pairing QR opens
// `https://<tls-endpoint>/pair#<payload>`; this route decodes the fragment and
// runs the challenge→redeem→confirm→poll handshake standalone (no dashboard WS
// connection needed). Rendered instead of <App/> so it works pre-auth.
// Reactive pre-shell route switch. `/callback` must resolve reactively (not a
// one-shot `window.location` read): the login gate completes the OIDC exchange
// then navigates client-side to the return-to, at which point this must swap the
// gate for <App/> WITHOUT a full-page reload (that would discard the in-memory
// token). `/pair` keeps its standalone pre-auth landing (D16).
function RootView(): React.JSX.Element {
  const [location] = useLocation();
  if (location === "/pair") {
    return (
      <React.Suspense fallback={null}>
        <PairLanding />
      </React.Suspense>
    );
  }
  if (location === "/callback") return <LoginGate phase="callback" />;
  if (location === "/logout") return <LoginGate phase="logout" />;
  return <AfterBoot login={location === "/login"} />;
}

// Nothing renders until boot has decided (`checking`); a handoff exchange shows
// the signing-in page; then the login page or the dashboard.
function AfterBoot({ login }: { login: boolean }): React.JSX.Element | null {
  const { phase } = useLoginSession();
  if (phase === "checking") return null;
  if (phase === "signing-in") return <SigningInPage />;
  return login ? <LoginPage /> : <App />;
}

// Policies, violation reporter and the service worker (PWA installability,
// script URL via pi-worker-url) before the first render; then non-English
// users fetch their catalog BEFORE the first frame (no English flash).
// See changes: harden-client-sinks, shrink-client-entry-lazy-islands.
void bootClient(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <UiPrimitiveProvider value={primitiveRegistry}>
          <Router>
            <ThemeProvider>
              <I18nProvider>
                <MobileProvider>
                  <RootView />
                </MobileProvider>
              </I18nProvider>
            </ThemeProvider>
          </Router>
        </UiPrimitiveProvider>
      </React.StrictMode>
    );
  })
  .catch((e: unknown) => {
    console.error("[pi-dashboard] failed to mount the app:", e);
  });
