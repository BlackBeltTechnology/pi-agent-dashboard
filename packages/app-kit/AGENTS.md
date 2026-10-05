# packages/app-kit

`@blackbelt-technology/pi-dashboard-app-kit`. Client plumbing for a standalone SPA on a foreign origin talking to a pi-dashboard host. Public, ESM, built to `dist/` (`prepack` → `tsc -p tsconfig.build.json`). Entries `.` (framework-free) and `./react`. No host code. Ported from InvoiceBot (`invoice-bot-dashboard` `src/auth/*`, `src/reconnecting-socket.ts`).
See change: extract-standalone-app-kit.

| File | Purpose |
|------|---------|
| `README.md` | Install, `config.json`, boot example, identity-mode table, host prerequisites (CORS, host admission, HTTPS, audience mapper, exact redirect URI), CSP note, provenance. See change: extract-standalone-app-kit. |
| `package.json` | Public manifest. Exports `.`/`./react` → `dist/`. Deps `oidc-client-ts ^3.5.0`, `react-oidc-context ^3.3.1`; peer `react`. `files` excludes `**/AGENTS.md`, `**/*.AGENTS.md`. See change: extract-standalone-app-kit. |
| `tsconfig.json` | Type-check config (`noEmit`, `jsx: react-jsx`, DOM lib). See change: extract-standalone-app-kit. |
| `tsconfig.build.json` | Emit config → `dist/` with `.d.ts`; excludes `src/__tests__`. See change: extract-standalone-app-kit. |
| `vitest.config.ts` | Vitest project, jsdom env. Registered in root `vitest.config.ts`. See change: extract-standalone-app-kit. |
| `src/index.ts` | `.` barrel. Imports neither `react` nor `react-oidc-context` (pinned by `package-shape.test.ts`). See change: extract-standalone-app-kit. |
| `src/config.ts` | Runtime endpoint. `loadAppConfig(url="/config.json",{allowMissing,fetchImpl})`, `configureDashboard`, `apiUrl`, `wsUrl` (`http→ws`, absolute pass-through), `dashboardOrigin`, `isDashboardOrigin` (credential origin gate, ws≡http), `AppKitError` codes `invalid_dashboard_url`/`app_config_unavailable`/`no_page_origin`. See change: extract-standalone-app-kit. |
| `src/identity-state.ts` | Module holder: `IdentityMode` (`unknown`/`oidc`/`none`/`unavailable`), access token, acting `Operator`, session-refused listeners. `resetIdentityState` → `unknown`. See change: extract-standalone-app-kit. |
| `src/login-descriptor.ts` | `fetchLoginDescriptor` reads `/api/identity/login-config` (no bearer, `credentials:"omit"`) → `{ok,mode,descriptor|reason}`; `{active:false}` → `none`; failure/malformed/active-without-issuer → `unavailable` (fail-closed). `initIdentity` sets the mode. See change: extract-standalone-app-kit. |
| `src/transport.ts` | `authedFetch` (mode gate → `NoCredentialError`; bearer only to dashboard origin; `credentials:"omit"`; dashboard 401 → `notifySessionRefused`; `none` + 401/403 → `NotAdmittedError`), `mintWsTicket`, `appendWsTicket`, `ticketSocketUrl` (null in unknown/unavailable; foreign origin → no ticket; `none` → plain), test seams `setTicketMinterForTests`/`authorizeTestSockets`. See change: extract-standalone-app-kit. |
| `src/socket.ts` | `connectWithReconnect`: InvoiceBot option shape; `resolveUrl` per attempt; `maxRetries` = retries after first attempt; null/reject/throw resolver → terminal `disconnected`; error+close → one retry; `close()` never reconnects. See change: extract-standalone-app-kit. |
| `src/react/index.ts` | `./react` barrel. See change: extract-standalone-app-kit. |
| `src/react/oidc-config.ts` | `buildOidcConfig(descriptor,{redirectUri})`: code + PKCE, no secret, `automaticSilentRenew`, per issuer+client `sessionStorage` user store, strips callback params. See change: extract-standalone-app-kit. |
| `src/react/identity-context.tsx` | `Identity`, `IdentityProvider`, `useIdentity`, `useOptionalIdentity`, `operatorFromUser`, `LOCAL_OPERATOR`, `OidcIdentityBridge` (oidc: mirrors token/operator, clears on refusal/sign-out; none: local operator, no OIDC client; optional `resolveRole` → `role`, else `null`). See change: extract-standalone-app-kit. |
| `src/__tests__/config.test.ts` | E1–E5: URL resolution, invalid base, `loadAppConfig` decision table. See change: extract-standalone-app-kit. |
| `src/__tests__/login-descriptor.test.ts` | E6, X1 + ported descriptor cases + no-literal issuer/client scan. See change: extract-standalone-app-kit. |
| `src/__tests__/transport.test.ts` | E7–E11, X2, X3 + ported transport cases. See change: extract-standalone-app-kit. |
| `src/__tests__/socket.test.ts` | F5–F9, X4 + ported reconnect cases (fake socket, manual timers). See change: extract-standalone-app-kit. |
| `src/__tests__/oidc-config.test.ts` | E12: public PKCE client, sessionStorage store. See change: extract-standalone-app-kit. |
| `src/__tests__/identity-context.test.tsx` | F1–F4: token follows renewal, sign-out/refusal clear, none-mode local operator, `resolveRole`. Fakes `react-oidc-context`. See change: extract-standalone-app-kit. |
| `src/__tests__/package-shape.test.ts` | E13/E14: no product coupling, `.` entry React-free, publishable manifest. See change: extract-standalone-app-kit. |
