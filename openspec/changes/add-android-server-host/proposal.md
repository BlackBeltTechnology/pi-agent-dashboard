## Why

The dashboard reaches phones only as a PWA (`public/manifest.json`, `public/sw.js`) or the neutral shell at `pi-dashboard.dev` (`packages/shell`). Three gaps remain:

1. **No installable Android app.** Users cannot install pi-dashboard as an app with its own icon, launcher entry and notification channel.
2. **No LAN discovery or LAN pairing on the phone.** Browsers cannot do mDNS. A PWA served over `https` (tunnel) cannot talk to `http://192.168.x.x` (mixed content), and the QR pairing payload lists `https` endpoints only (`lan-knock-pairing` "Plain-http transport is permitted for knocks only").
3. **No reliable phone push.** WebView and Android Chrome Web Push depend on the page origin being `https`, and on the PWA being kept around.

The previous plan (`add-capacitor-mobile-shell`) bundled `packages/client/dist` into a Capacitor APK. A spike on 2026-10-24 (Android 14 emulator, WebView 113, Capacitor 7, isolated auth-enforcing server) disproved that design:

- **Bundled client cannot reach LAN servers.** A page on a secure app origin (`https://appassets.androidplatform.net`, the same class as Capacitor's `https://localhost`) gets `Mixed Content` / `SecurityError` for `fetch` and `ws://` to `http://192.168.16.203:8123`.
- **Bundled client loses runtime plugins and drifts from the server.** `runtime-plugin-loader.ts` returns `"remote-server"` whenever `getApiBase()` is non-empty, so a bundled client never loads server-installed plugins. It would also run one client version against servers of many versions, with no protocol version handshake.
- **Capacitor exposes its native bridge to remote pages.** Dynamic per-user server origins force `server.allowNavigation: ["*"]`. Capacitor then falls back to `addJavascriptInterface("androidBridge")` for every origin (`MessageHandler.java:38`). The spike's remote server page called `Preferences.set/get` and `CapacitorCookies.getCookies` directly, without Capacitor JS.
- **`@capacitor/preferences` is plaintext** `SharedPreferences` (read back from `shared_prefs/CapacitorStorage.xml`).
- **`network_security_config` does not accept CIDR.** `<domain>192.168.0.0/16</domain>` is ignored; only exact host or IP literals match. The WebView enforces the config too (`ERR_CLEARTEXT_NOT_PERMITTED`).
- **FCM does not fit self-hosted servers.** FCM HTTP v1 needs a service-account key of the app's own Firebase project on every sending server.

The same spike validated the alternative:

- **A plain WebView loading the server's own origin works.** The app does a native `POST /api/device-session` with the bearer and copies `Set-Cookie` into `CookieManager`. The full dashboard then renders authenticated: WS ticket via cookie, runtime-plugin listing `200`, all 192 shipped client chunks (Monaco, xterm, mermaid, pdf.js, KaTeX, cytoscape) importing on WebView 113, zero console errors.
- **This is the model Electron already ships** (`electron-server-windows`): the host owns discovery, identity, pairing and credentials; each remote dashboard runs its own client on its own origin; server auth is unchanged.

## What Changes

- **NEW** `packages/android/`: a native Android app in Kotlin + Jetpack Compose (Gradle project, committed wrapper, no npm package). Android only; iOS is a later change.
  - **Host screens (Compose):** server list, LAN discovery, pairing, per-server settings. No WebView and no JavaScript in the host UI.
  - **Discovery:** `NsdManager` browses `_pi-dashboard._tcp` and reads the advert's `fp`.
  - **Pairing, reusing existing server flows with no server change:**
    - LAN knock (`POST /api/pair/challenge` → `/api/pair/request` → `/api/pair/poll`) per `lan-knock-pairing` "Native knocking clients verify the discovered identity first". Needs the operator's "Accept LAN requests" switch (default off) and an on-link or configured network;
    - QR / pasted payload (`/api/pair/challenge` → `/redeem` → `/poll`) per `neutral-shell-pairing`.
  - **Access level:** the server screen needs `operate` tier, because `POST /api/ws-ticket` is `operate`. Pairing defaults to `operate`; a lower-tier device is shown as "Needs full access".
  - **Keyring:** one entry per server fingerprint (pin, label, verified routes, bearer). Encrypted at rest under an Android Keystore key and excluded from backup.
  - **Server screen:** one hardened `WebView` showing the server's own origin.
    - No JS interface. Same-origin navigation only, including redirects; other `http(s)` links open in Custom Tabs; everything else is dropped.
    - File-chooser and download handlers are explicit.
    - Identity is re-proven every 60 s and on resume.
  - **Cookie bootstrap:** native `POST /api/device-session` with `Content-Type: application/json`. Android's `HttpURLConnection` defaults to form encoding, which the spike showed gets `415`. The cookie value is the bearer, so it is copied session-only and re-exchanged on every open.
  - **Revocation:** a refused exchange (`401`, or `403 network_not_allowed`) marks the server "needs pairing". It is re-checked on resume and on `/api/*` refusals while open, rate-limited. Without this the in-page client shows a misleading "Server offline / Retrying…".
  - **Cleartext policy:**
    - `base-config cleartextTrafficPermitted="true"`, because CIDR rules are ignored;
    - the native gate admits `http` only to **IP literals** in loopback, RFC 1918, link-local, CGNAT (`100.64.0.0/10`) or ULA ranges;
    - hostnames need `https`;
    - http servers carry an "Unencrypted connection" badge.
  - **Push via UnifiedPush:**
    - one UnifiedPush instance per paired server;
    - the distributor endpoint plus RFC 8291 keys is registered with that server as a `web-push` subscription through the existing `POST /api/push/register`. The server needs `push.webPush.contactEmail` and an `https` distributor endpoint;
    - tapping a notification opens that server at the payload's path;
    - Android 13+ `POST_NOTIFICATIONS` permission is requested on enable;
    - no Google or Firebase project anywhere.
- **SERVER** — none planned. Push reuses the existing `web-push` transport and `operate`-tier registration route. If the spike task (1.3) shows a distributor rejects VAPID / RFC 8291 delivery, the change gains an additive `unifiedpush` transport (raw JSON POST), and its spec delta is added then. Server-side pruning of a revoked device's push tokens is a noted follow-up.
- **CLIENT** (`packages/client`) — none. The server's own client runs unmodified in the WebView.
- **CI:**
  - new `ci-android.yml`: path-filtered `packages/android/**`, JVM unit tests plus a debug build;
  - `publish.yml` gains a `mobile-android` job (`needs: [resolve, publish, github-release]`, final `vX.Y.Z` tags only) that builds a release APK signed with the upload keystore and uploads it to the existing GitHub Release; the AAB is kept as a workflow artifact. `github-release` never depends on it;
  - a workflow contract test pins both.
- **DOCS** — `docs/android-app.md` (build, signing, keystore custody, install, pairing, push setup with a distributor), an architecture section, and `packages/android/AGENTS.md`.

## Capabilities

### New Capabilities

- `android-server-host` — native Android app that discovers, pairs with and stores credentials for dashboard servers, opens each server's own client in a hardened WebView, and delivers server push through UnifiedPush.

### Modified Capabilities

None. Server routes, auth, pairing, push transports and the web client are reused as specified. A `push-notifications` delta is added only if the UnifiedPush spike (task 1.3) forces a new transport.

## Out of Scope

- **iOS.** Separate change. It needs its own push story (APNs has the same self-hosted key problem as FCM).
- **Play Store listing.** v1 ships a signed APK on GitHub Releases. The same upload key serves a later Play listing.
- **Bundled or offline client, and any Capacitor dependency.** Rejected by the spike (see design D1).
- **Several servers open at once.** One server screen at a time in v1 (design D5, cookie jar is per process).
- **Passkey and OIDC login inside the WebView.** WebView 113 exposes no `PublicKeyCredential`, and WebAuthn support was `false`. Device-bearer pairing is the v1 credential. OIDC via Custom Tabs is a follow-up.
- **In-app update check.**
- **Bearer confidentiality in transit on plain-`http` LAN servers.** Same posture as browsers and Electron today; the app shows an "Unencrypted connection" badge and recommends https or a tunnel (design Risks).
- **Server-side pruning of push tokens when a device is revoked.** The app unregisters locally; server pruning is a follow-up (design D9).
- **Removing the "Capacitor-readiness contract"** requirement in `push-notifications`. Left as is; it stays true and harmless.

## Discipline Skills

- `security-hardening` — bearer custody (Keystore-backed encryption, session-only cookie copy, backup exclusion), WebView hardening against an untrusted remote page (no JS interface, navigation and redirect gate, deep-link path validation), TOFU identity pinning and periodic re-proof, the cleartext-to-LAN policy and its accepted in-transit residual, dropping undecryptable push messages.
- `doubt-driven-review` — irreversible choices before they stand: `applicationId`, the upload signing key (losing it orphans every install), and dropping FCM for UnifiedPush.
- `observability-instrumentation` — new external calls (challenge, knock, exchange, push registration); log short fingerprint + host + outcome, never bearer, code, cookie or push endpoint.
- `performance-optimization` — explicit latency budgets: 5 s route selection and challenge deadline, 2 s mDNS browse at open, 60 s re-proof and 5 min re-check cadence, without starving the UI thread.
- `review-code` — before commit.
