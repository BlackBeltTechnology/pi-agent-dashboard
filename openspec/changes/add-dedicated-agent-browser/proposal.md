## Why

Today the agent's only logged-in browser routes go through an extension inside the user's real Chrome profile: the browser relay (Playwright extension) and Panerelay. Both drive tabs with `chrome.debugger`. A live spike on 2026-10-17 showed that this breaks on exactly the pages logged-in browsing needs:

- **Relay → `Profile 21` (blackbelt.hu, LastPass + iCloud Passwords installed).** `connect` succeeded in 8.6 s. `myaccount.google.com`, `github.com` and `example.com` attached and read fine. Loading a page with a password field (`the-internet.herokuapp.com/login`) detached the controlled tab at once. `server.log`: `instance Profile 21 close (extension-closed:All controlled tabs detached)`. agent-browser silently relaunched into a fresh `about:blank`. Reproduced twice.
- **The detach is not audited.** `GET /api/browser/audit` listed only `attach`, `navigate` and `createTarget`, although the `browser-relay` "Audit trail" requirement lists `detach`. The only trace is `server.log`.
- **Panerelay in the same profile** failed every command with `CDP error (Page.enable): Cannot access a chrome-extension:// URL of different extension`. Panerelay was also disabled in two profiles (`disable_reasons: [1]`). `/api/browser/status` returned 404 because the browser plugin ships `defaultEnabled: false`, so the routing silently degraded to Panerelay.
- **Control.** Panerelay in the clean `AgentAutomation` profile, which has no password manager, handled Google sign-in, OAuth consent, the Admin console and bulk Gmail work for three accounts without one detach.

The missing piece is a provider with no extension in the loop: a dedicated Chrome profile owned by the dashboard, driven over plain CDP. Chrome's M136 block on `--remote-debugging-port` covers only the default user-data dir, so a dedicated `--user-data-dir` is allowed. Outside evidence points the same way. Tatár Gábor's Claude Cowork capability study (2026-09/10, Mac + Windows) found Cowork's own Browser pane to be a separate, persistent cookie jar that the agent uses by default, with the user's Chrome extension (Claude in Chrome) as the fallback when the pane is blocked. `docs/research/browser-provider-registry.md` already names an `automation` browser but maps it to an extension provider.

## What Changes

- **Dedicated agent profile provider.** The browser plugin can launch, or attach to, a Chrome it owns:
  - its own `--user-data-dir` under the dashboard data dir;
  - a loopback-only `--remote-debugging-port`;
  - no extension, no pairing token, no Allow dialog.
- **Persistent logins.** The profile survives restarts. The user signs in once per account inside it, and the agent never types credentials.
- **Same handle as `connect`.** A connect for the dedicated profile returns `{cdpUrl, instanceId}`, so `agent-browser connect <cdpUrl>` and the existing skill recipe work unchanged. It is still gated loopback-only, and the existing deny-list, navigation fence and audit apply.
- **Routing order.** The `default-browser-skill` login-state routing becomes: dedicated agent profile, then the real-profile relay as an explicit opt-in, then Panerelay as the legacy fallback. No step falls back silently.
- **Real-profile relay is honest about its limit.**
  - An extension-caused detach is audited as `detach`, with a reason.
  - It is surfaced to the CDP client and viewers the way the DevTools conflict already is.
  - The skill states that a profile running a password manager detaches on login pages.

Non-goals:
- Building the full named-browser registry (`docs/research/browser-provider-registry.md`). This change adds one provider and keeps the shape compatible with it.
- Importing cookies or passkeys from the user's real profiles.
- Remote, docker or headless hosts. They keep the bundled agent-browser.
- Fixing the relay pane input defects. They are covered by `fix-browser-relay-pane-input`.

## Capabilities

### New Capabilities

- `dedicated-agent-browser`: lifecycle of the dashboard-owned Chrome profile:
  - launch and attach;
  - a loopback CDP endpoint exposed as `cdpUrl`;
  - persistence of the user-data-dir;
  - one instance per host;
  - liveness and shutdown.

### Modified Capabilities

- `browser-relay`:
  - Audit trail: record an extension-caused tab detach as `detach` with a reason.
  - Debugger conflict is surfaced: cover non-DevTools detaches, such as a password-manager frame.
- `default-browser-skill`: Dashboard-relay recipe for logged-in browsing:
  - routing order with the dedicated profile first;
  - troubleshooting for the extension-frame detach and for a disabled extension.
- `browser-plugin-settings`: Browser settings section shows the dedicated profile, its status, and an "open to sign in" action.

## Impact

- `packages/browser-plugin/src/server/`:
  - `capability.ts`: launch argv, a user-data-dir resolver;
  - `connect.ts` and `routes.ts`: connect for the dedicated profile;
  - `audit.ts`: detach entries;
  - relay status: surfacing the detach.
- `packages/browser-plugin/src/client/`: settings section.
- `packages/extension/.pi/skills/browser/references/dashboard-relay.md`, `own-browser.md` and `SKILL.md` routing.
- `docs/research/browser-provider-registry.md`: provider row and spike evidence.
- No new dependency. Chrome is already required for `canOpenChrome`.

## Discipline Skills

- `security-hardening`: a new loopback CDP endpoint grants full control of a logged-in browser. It must not be reachable over a tunnel, LAN or zrok, and the user-data-dir holds session cookies.
- `observability-instrumentation`: detach reasons and instance lifecycle must reach the audit, not only `server.log`.
- `doubt-driven-review`: before the user-data-dir location and the launch flags are fixed, because moving them later strands the user's sign-ins.
