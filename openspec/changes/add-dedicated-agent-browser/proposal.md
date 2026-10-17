## Why

Today the agent's only logged-in browser routes go through an extension inside the user's real Chrome profile: the browser relay (Playwright extension) and Panerelay. Both drive tabs with `chrome.debugger`. A live spike on 2026-10-17 showed that this breaks on exactly the pages logged-in browsing needs:

- **Relay → `Profile 21` (blackbelt.hu, LastPass + iCloud Passwords installed).** `connect` succeeded in 8.6 s. `myaccount.google.com`, `github.com` and `example.com` attached and read fine. Loading a page with a password field (`the-internet.herokuapp.com/login`) detached the controlled tab at once. `server.log`: `instance Profile 21 close (extension-closed:All controlled tabs detached)`. agent-browser silently relaunched into a fresh `about:blank`. Reproduced twice.
- **The detach is not audited.** `GET /api/browser/audit` listed only `attach`, `navigate` and `createTarget`, although the `browser-relay` "Audit trail" requirement lists `detach`. The only trace is `server.log`.
- **Panerelay in the same profile** failed every command with `CDP error (Page.enable): Cannot access a chrome-extension:// URL of different extension`. Panerelay was also disabled in two profiles (`disable_reasons: [1]`). `/api/browser/status` returned 404 because the browser plugin ships `defaultEnabled: false`, so the routing silently degraded to Panerelay.
- **Control.** Panerelay in the clean `AgentAutomation` profile, which has no password manager, handled Google sign-in, OAuth consent, the Admin console and bulk Gmail work for three accounts without one detach.

The missing piece is a provider with no extension in the loop: a dedicated Chrome profile owned by the dashboard, driven over plain CDP. Chrome's M136 block on `--remote-debugging-port` covers only the default user-data dir, so a dedicated `--user-data-dir` is allowed. Outside evidence points the same way. Tatár Gábor's Claude Cowork capability study (2026-09/10, Mac + Windows) found Cowork's own Browser pane to be a separate, persistent cookie jar that the agent uses by default, with the user's Chrome extension (Claude in Chrome) as the fallback when the pane is blocked. `docs/research/browser-provider-registry.md` already names an `automation` browser backed by a `dedicated-cdp` provider; this change builds that provider.

## What Changes

- **Dedicated agent profile provider.** The browser plugin launches a Chrome it owns:
  - its own `--user-data-dir` under the dashboard data dir;
  - driven over `--remote-debugging-pipe`, so no other local process (including the agent) can reach Chrome directly and bypass the deny-list, navigation fence or audit. Chrome is restarted with the dashboard; open tabs are lost, sign-ins persist;
  - no extension, no pairing token, no Allow dialog;
  - one agent client at a time. A second connect gets `busy` naming the holder. Several sessions sharing the dedicated profile need a CDP multiplexer and are a follow-up change.
- **Persistent logins.** The profile survives restarts. The user signs in once per account inside it, and the agent never types credentials.
- **Same handle as `connect`.** `POST /api/browser/dedicated/connect` returns `{cdpUrl, instanceId}` on the same `/ws/browser-cdp/` proxy, so `agent-browser connect <cdpUrl>` works unchanged. It is loopback-only, and the existing deny-list, navigation fence and audit apply. Other plugins (`add-gmail-auto-setup`) use this route.
- **Session-aware `browser_connect {target?}` tool.** Applies the default browser, the unavailable policy and the live-view setting, knows the calling session, and names the browser it used. The REST routes stay.
- **Routing order.** The `default-browser-skill` login-state routing becomes: dedicated agent profile, then a real Chrome profile only when chosen (target argument, default-browser setting, or the "try next" policy), then Panerelay only when the dashboard browser is unavailable. Every result names the browser used; a login task never falls back to headless.
- **Behaviour settings** (Settings > Browser Relay, new "Agent browsing" group). Today these rules live only in skill text, and `defaultBrowser` / `allowMultipleInstancesPerProfile` exist in `configSchema.json` with no UI. New settings:
  - default browser: dedicated profile (default), one of my Chrome profiles, or headless;
  - when it is unavailable: ask me (default), try the next browser, or stop the task. The session always says which browser it used;
  - disconnect when idle (default 30 min) and connections per Chrome profile (one or several, `allowMultipleInstancesPerProfile`; the dedicated profile always serves one);
  - open the live view in the session's pane when the agent connects;
  - global default allowed domains, overridable per profile.
- Consent stays as today: the dedicated profile never asks (it is the agent's own); a real profile asks through Chrome's Allow dialog unless `zeroDialog` and a token are set.
- **Dedicated profile panel.** Status, data location, size, last used, "Open to sign in", "Stop", and "Reset profile" behind a confirm.
- **Calmer profile list.** Only profiles with the extension are listed, as collapsible rows. A profile running a password manager shows a warning. The rest sit behind one "N more profiles without the extension" row.
- Mockup: `mockups/index.html` (in this change), with the states normal, dedicated not set up, relay off, and no Chrome. Plan and scored rubric are in `mockups/ui-plan.md`.
- **Real-profile relay is honest about its limit.**
  - An extension-caused detach is audited as `detach`, with a reason.
  - The skill states that a profile running a password manager detaches on login pages.

Non-goals:
- Building the full named-browser registry (`docs/research/browser-provider-registry.md`). This change adds one provider and keeps the shape compatible with it.
- Importing cookies or passkeys from the user's real profiles.
- Remote, docker or headless hosts. They keep the bundled agent-browser.
- Fixing the relay pane input defects. They are covered by `fix-browser-relay-pane-input`.
- Several concurrent agent clients on the dedicated profile (CDP multiplexer).
- A new consent prompt in the session; the Allow dialog and `zeroDialog` remain the real-profile consent.
- Changing the plugin's `defaultEnabled: false`.

## Capabilities

### New Capabilities

- `dedicated-agent-browser`: lifecycle of the dashboard-owned Chrome profile:
  - launch over a debugging pipe, availability, stop, reset, a sign-in window hidden from the agent;
  - a stricter deny set for browser-level CDP (chrome:// pages, browser-target attach, cookie writes);
  - connect through the dashboard proxy as `cdpUrl`, one client at a time;
  - persistence of the user-data-dir;
  - one Chrome per host, owned by one dashboard server, restarted with it, orphan cleanup.

### Modified Capabilities

- `browser-relay`:
  - Audit trail: record extension-caused instance closes and tab detaches as `detach` with a cause.
  - Relay-side CDP deny-list: effective allowed domains (profile list, else global list).
  - Per-session isolation via tab groups: scoped to extension-backed profiles; the dedicated profile serves one client.
  - Profile discovery and capability: per-profile password-manager detection; dedicated-profile availability in status.
  - New: session-aware `browser_connect` with the default-browser and unavailable policy; idle disconnect; global allowed domains.
- `default-browser-skill`: Dashboard-relay recipe for logged-in browsing:
  - routing order with the dedicated profile first;
  - troubleshooting for the extension-frame detach and for a disabled extension.
- `browser-plugin-settings`: Browser settings section gains the "Agent browsing" behaviour group, the dedicated profile panel, collapsible profile rows with a password-manager warning, and Activity entries for `detach`.

## Dependencies

Group `browser-agent` in `openspec/groups/groups.json`, execution order:

1. `fix-browser-relay-pane-input`: code-level dependency. It rewrites "Connect and CDP-URL lifecycle"; this change leaves that requirement untouched (the dedicated profile has its own route), but both edit `packages/browser-plugin/src/server/routes.ts`. Land it first to avoid a merge conflict.
2. `fix-empty-status-subcard`: soft dependency. It moves the relay status subscription into `BrowserRelayFeed` and adds `hasRelayTabs` in `relay-store`. The dedicated instance's status and badge build on those, not on the old `BrowserRelayBadge` subscription.
3. `add-dedicated-agent-browser` (this change).
4. `improve-gmail-plugin-setup-ux`: independent of this change; placed here because `add-gmail-auto-setup` builds on it.
5. `add-gmail-auto-setup`: depends on this change. It drives the Cloud console in the dedicated profile through the `{cdpUrl, instanceId}` connect handle, so that handle and the profile's sign-in flow are its contract.



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

- `security-hardening`: a browser-level CDP channel grants full control of a logged-in browser. Only the dashboard proxy may reach it, the proxy's `cdpUrl` must stay loopback-only, the deny set must cover browser-level methods, sign-in tabs must be hidden from the agent, and the user-data-dir holds session cookies (same-user access is a stated residual risk).
- `observability-instrumentation`: detach reasons and instance lifecycle must reach the audit, not only `server.log`.
- `doubt-driven-review`: before the user-data-dir location and the launch flags are fixed, because moving them later strands the user's sign-ins.
