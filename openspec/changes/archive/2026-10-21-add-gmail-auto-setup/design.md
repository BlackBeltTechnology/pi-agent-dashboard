## Context

See proposal.md for motivation and the 2026-10-17 spike. Current shape (verified 2026-10-17):

- `packages/gmail-plugin` server routes live under `/api/plugins/gmail`, one scope with `@fastify/rate-limit` and `preHandler: networkGuard` (`src/server/routes.ts:132-139`). No run/setup/progress route exists.
- `PUT /client` validates with `validateClientJson` (`src/shared/client-json.ts:25-53`: `installed` only, client-id regex, secret required, `project_id` kept when `^[a-z][a-z0-9-]{4,62}$`) and refuses a different client id or secret while accounts exist with 409 `client_in_use` (`routes.ts:149-164`). The client record `{clientId, clientSecret, projectId?}` is stored by `AccountStore.setClient` under credentials ns `gmail`, key `client` (`src/server/accounts.ts:14-23`).
- Sign-in: `buildAuthUrl` (`src/server/google-oauth.ts:87-111`) sends `prompt="consent select_account"`, PKCE, nonce, loopback redirect; `login_hint` only when `startSignIn` receives `expect.email` (`routes.ts:84`), i.e. re-auth and level raise. `POST /accounts {tier?}` never sets it.
- Progress today: the host OAuth flow store, polled by the client every 500 ms (`src/client/GmailSettings.tsx:75-100`; host `/api/provider-auth/flow/:flowId`, `packages/server/src/routes/provider-auth-routes.ts:237-265`).
- Secrets discipline: fixed codes only (`src/shared/flow-codes.ts:6-35`, `safeCode` `google-oauth.ts:38-40`), no redaction helper; tests assert no secret strings in captured logs (`src/server/__tests__/routes.test.ts:217-225`, `:311`; `lease.test.ts:208-217`; `capturingLogger` in `src/__tests__/fakes.ts`).
- Wizard: steps 1–6 (`src/client/wizard.ts:10`), `SetupWizard` takes `highlight: WizardStep | null` (`GmailSettings.tsx:165-180`); `consoleLinks(projectId)` (`wizard.ts:23-32`).
- Cross-plugin: `ServerPluginContext` offers `provide(name, value)` / `consume<T>(name)` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:771-800`, `:1109-1122`); load order follows `manifest.dependsOn`, which is a hard dependency (an absent or disabled dependency keeps the dependent from loading). The browser plugin provides nothing today (`packages/browser-plugin/src/server/index.ts:67` registers only `browser/open`). No `getPort` on the context.
- CDP from Node: no server package drives Chrome; `ws ^8.18.0` is a dependency of `packages/browser-plugin` and `packages/server` but not of gmail-plugin.
- i18n: `src/i18n.ts` holds zh-CN and hu leaf keys merged under `plugin.gmail.*`; English fallbacks at call sites; parity enforced by `scripts/i18n-parity`.
- Upstream contract: `add-dedicated-agent-browser` (dedicated profile over pipe, `{cdpUrl, instanceId}`, one client at a time, 409 `busy` with `holder`, hidden server-owned tabs, `downloadsDir`, deny set allowing only `https:`/`http:`/`about:blank` navigation).

## Goals / Non-Goals

**Goals:**
- One click starts a run that produces a stored Desktop OAuth client, with the user's input reduced to sign-in, the policy checkbox, publish confirmation and audience/link review.
- The client secret never reaches a log, a transcript, the audit, a status payload or the client UI.
- Every step is verified and idempotent; a re-run resumes; any surprise stops and hands off to the manual wizard at the matching step.

**Non-Goals:**
- An agent or model driving the console.
- Surviving console redesigns automatically (hand-off is the answer).
- Organisation-provided clients, Google verification, shared public clients.

## Decisions

### D1. Deterministic server-side recipe

A `SetupRun` in `packages/gmail-plugin/src/server/setup/` drives the console over CDP with a fixed step recipe. No model is involved, so page content (including the secret dialog) never reaches a transcript. Alternative (agent skill) rejected: it puts page content through a model and is untestable.

### D2. Reaching the dedicated browser: in-process service

The browser plugin calls `ctx.provide("browser.dedicated", service)` with:
- `status(): DedicatedStatus` (the `status.dedicated` object, plus `enabled`);
- `connect({client, takeover?, private?, ephemeral?}): Promise<{cdpUrl, instanceId}>` (same rules and errors as `POST /api/browser/dedicated/connect`, refusals `{status, reason, holder?, instanceId?}`). `ephemeral` makes the browser plugin create a `Target.createBrowserContext` for the instance on its own server session, force every client `Target.createTarget` into it, filter discovery to it, set its download path, and `Target.disposeBrowserContext` on close (Chrome drops it on exit too). Clients cannot create or dispose contexts themselves (`Target.createBrowserContext` / `disposeBrowserContext` are proxy-handled);
- `open({url, instanceId?}): Promise<{tabId}>` (same rules as `POST /api/browser/dedicated/open`; in the instance's context when given);
- `focus(tabId)`, `tabOrigin(tabId)` for server-owned tabs (origin only);
- `disconnect(instanceId): Promise<void>`.

The gmail manifest does NOT declare `dependsOn: ["browser"]`: `dependsOn` is hard and transitive (`openspec/specs/dashboard-plugin-loader/spec.md:924-945`), and the browser plugin ships `defaultEnabled: false`, so the gmail plugin would stop loading for most users. Instead the gmail server calls `ctx.consume("browser.dedicated")` lazily on every state request and run start, so load order does not matter; `undefined` → feature hidden. No HTTP hop, no auth token, no port lookup. The CDP socket itself goes to the returned loopback `cdpUrl` with `ws` (added to gmail-plugin dependencies, already hoisted), with no `Origin` header (the proxy refuses one).

### D3. Run model

- One run per dashboard at a time, held in memory by the gmail server. Routes (same scope and guard as the other gmail routes; start additionally requires a genuinely local request, else 403 `remote_dashboard`, because every checkpoint needs the dedicated Chrome window on the host. "Genuinely local" mirrors the host rule in `packages/server/src/auth/localhost-guard.ts:17-42`: loopback peer AND no `x-forwarded-*`, `forwarded` or `via` header, so a same-host tunnel (zrok) is remote. The plugin context offers no such helper, so the gmail routes implement the predicate with a test; `fix-trusted-network-tunnel-bypass` covers the host side):
  - `POST /api/plugins/gmail/setup/run {mode: "new" | "existing", projectId?, ownerEmail}` → `{runId}` (409 `run_active`);
  - `GET /api/plugins/gmail/setup/run/:runId` → run view;
  - `POST /api/plugins/gmail/setup/run/:runId/continue {audience?, links?, confirmLinks?}` answers a decision;
  - `POST /api/plugins/gmail/setup/run/:runId/takeover`;
  - `DELETE /api/plugins/gmail/setup/run/:runId`.
- `GET /api/plugins/gmail/state` gains `autoSetup: {available, reason?, local}` so the client can show, hide or explain the entry.
- Run view (secret-free): `{runId, state, step, steps: [{id, status}], checkpoint?: {kind}, decision?: {kind: "audience", detected, org?} | {kind: "links", links}, busy?: {holder}, handoff?: {step, wizardStep, reason}, projectId?, created: {projectId?, clients: string[]}, clientId?}`; step ids `project`, `api`, `branding`, `publish`, `client`, `capture`.
- `wizardStep` map (manual wizard steps, `src/client/wizard.ts:10`, `:104-110`): `project`, `api` → 1; `branding` → 2; `publish` → 3; `client`, `capture` → 4.
- The client polls the run view every 1 s while a run is live (mirrors `useFlowPoll`).
- Project id and owner email are saved in the config keys `improve-gmail-plugin-setup-ux` introduces (`plugins.gmail.projectId`, `plugins.gmail.ownerAccount`); the confirmed publishing links in credentials ns `gmail`, key `setup` (non-secret). The dedicated Chrome closes on dashboard restart, so a live run is not resumed; the user starts it again and it continues from the first unverified step.
- Observability: one log line per step `[gmail] setup step <id> <done|skipped|handoff:<reason>> <ms>ms`, masked (D8), no URLs.

### D4. Step recipe

Each step = `{check(page) → done?, act(page), verify(page) → done?}`; the run executes `check`, and if not done, `act` then `verify`. A `verify` failure, an unknown page, or a step exceeding 60 s → `handoff`.

| step | check | act | verify |
|---|---|---|---|
| `project` | project dashboard for `projectId` shows "Project ID" = `projectId`; also reads the parent ("No organization" or an org name) | new mode only: `projectcreate`, fill name + id, Create | as check (poll up to 60 s) |
| `api` | API overview shows "Disable API" | API library page, "Enable" | "Disable API" present |
| `branding` | `auth/audience` shows a user type | audience decision (D6) first; `auth/overview/create` 4-step form: app name, support email = owner, audience, contact email, `policy` checkpoint (D5), Create | `auth/audience` shows the chosen user type |
| `publish` (External) | `auth/audience` shows "In production" | links decision (D7); `auth/branding` fill + Save; `auth/audience` → "Publish app" → `publish` checkpoint | "In production" |
| `client` | never done (an earlier client's secret is unrecoverable) | `auth/clients/create`: Desktop app, name `pi-dashboard`, or `pi-dashboard-<n>` with the smallest free `n` when the clients list has that name; Create | creation dialog present; name appended to `created.clients` |
| `capture` | — | D8 | store accepted (refusal `client_in_use` → handoff) |

- Navigation URLs carry `authuser=<ownerEmail>`, `project=<projectId>` and `hl=en`. Selectors are role + accessible name (English) via `Accessibility.queryAXTree` on the run's own page, clicked at the element's box centre. A non-English `document.documentElement.lang` → handoff `locale`.
- A navigation denied by the dedicated deny set or allowed domains → handoff `domain_blocked` naming `console.cloud.google.com` and `accounts.google.com`.
- While in any non-terminal state (including `waiting_decision` and `busy` after connect) the run sends a cheap command (`Runtime.evaluate("1")`) every 30 s, so the browser plugin's idle sweep never closes it. A socket close the run did not initiate → handoff `browser_closed`.
- New-mode project id: `pi-dashboard-<6 random [a-z0-9]>` unless supplied; validated with the plugin's single project-id rule (adopted from `improve-gmail-plugin-setup-ux`, task 0.1).

### D5. Human checkpoints

The run sets `state: "waiting_user"` with `checkpoint.kind` and polls the page every 1 s. Checkpoints:
- Redirect guard: on its page session the run enables `Fetch` with a `Document` request pattern for `https://accounts.google.com/*` (page-level `Fetch` passes the upstream deny set; only browser-level `Fetch` is denied). A paused top-level request there is failed with `Fetch.failRequest` before anything renders, and the run enters `sign_in`. This covers expired sessions, the account chooser and "verify it's you" re-auth mid-step.
- `sign_in`: triggered by the redirect guard or when the account chooser lacks `ownerEmail` → navigate the run's tab to `about:blank`, `open({url: <accounts.google.com sign-in with login_hint>, instanceId})` (hidden tab in the run's ephemeral context), `focus` it, and keep the run's tab on `about:blank` until `tabOrigin` leaves `https://accounts.google.com` or the user presses "I've signed in" (`continue`). Then load the console; a further redirect is again stopped by the guard. The run's own tab therefore never renders a password form.
- `console_terms`: first-visit Terms of Service dialog → wait until it is gone.
- `policy`: User Data Policy checkbox → `Page.bringToFront` and wait until the user checks it; the run never clicks it.
- `publish`: "Push to production?" dialog → wait until "In production"; dialog cancelled → handoff `publish_cancelled`.
Each checkpoint times out after 15 min → handoff `timeout`. The run never types a password and never clicks a sign-in, consent, terms, policy or publish confirmation.

### D6. Audience

The parent is read in the `project` check, in both modes. If `branding` is not done, the run pauses in `waiting_decision {kind: "audience", detected, org?}` (organization → `internal`, otherwise `external`; Internal not offered without an organization; choosing External explains the unverified-app warning). If `branding` is already done, the existing user type is reported and nothing is asked.

### D7. Publishing links

Defaults: home page and privacy policy both `https://github.com/BlackBeltTechnology/pi-agent-dashboard` (exists; `PRIVACY.md` does not), authorized domain `github.com`. The links decision requires an explicit confirmation (`confirmLinks: true`) and says these links appear on Google's consent screen for every account and that the user may replace them with their own. Each value must be `https:` with its host under the authorized domain (400 otherwise).

### D8. Secret capture

- The run connects with `private: true, ephemeral: true` (service D2): its tabs never reach `browser_relay_status` or a viewer pane (the creation dialog is never streamed), and the owner's Google session, console pages, download history and HTTP cache live in a throwaway browser context discarded when the run ends, fails, is cancelled or Chrome exits. Later agent sessions on the dedicated profile are never signed in as the owner.
- The run evaluates, in its own page session, a fixed function that reads the client id and secret from the creation dialog's DOM; the CDP response is consumed in memory only.
- Fallback: click "Download JSON"; read the newest `client_secret_*.json` in `status().dedicated.downloadsDir` created after the click; delete it in a `finally`.
- The captured values go through the function shared with `PUT client` (same validation, `client_in_use` rule, `projectId` stored). Never logged, never in the run view, the audit or an error.
- Neither read works but the dialog was shown → close it, handoff `secret_capture_failed`; the wizard names the created client and explains "Add secret".
- `maskSecrets(text)` replaces `GOCSPX-[A-Za-z0-9_-]+` with `GOCSPX-***` on every log line and handoff reason.

### D9. Busy and takeover

`connect` → `{status: 409, reason: "busy", holder, instanceId}` → `state: "busy"`, `busy: {holder}` (instanceId kept server-side). The UI shows the holder and a confirmed "Take over", which calls `connect({client: "gmail-setup", private: true, ephemeral: true, takeover: true})`, atomic in the browser plugin so an agent cannot reconnect in between. Other refusals (`disabled`, `unloaded`, `no-chrome`, `no-display`, `owned-by-other-server`, `profile-in-use`, `launch-failed`) → handoff at `project` with that reason.

### D10. Availability and existing setups

`autoSetup.available` requires: `consume("browser.dedicated")` defined (looked up per request), `status().enabled && status().dedicated.available`, a loopback peer, and either no client or a client with no accounts (the UI says the new client replaces it). The entry is a secondary button; "Add account" remains the one primary button and run inputs use the `settings-panel` field components, keeping "Settings section is readable and guarded".

### D11. Sign-in improvements

`POST /accounts {tier?, email?}`: `email` (validated, ≤ 254 chars) is passed as `login_hint`. The add-account UI offers an optional email field, prefilled with the owner email after a run. When the audience is External or unknown, the waiting-sign-in notice adds that Google may show "Google hasn't verified this app" and to continue through Advanced.

### D12. Relationship to improve-gmail-plugin-setup-ux

That change lands first and owns the owner-account field, the existing-project path, the project-ID rule and the config keys `plugins.gmail.projectId` / `ownerAccount`. This change reuses them; its "Guided OAuth client setup" delta is rewritten on top of that change's archived text before implementation (task 0.1). The main-spec line "The plugin SHALL NOT execute cloud CLI commands" stays true: the run uses the browser, never a CLI.

## Risks / Trade-offs

- [Console redesign breaks a selector] → check/verify per step, handoff at that step, role+name selectors, `hl=en`; an integration fixture suite catches recipe regressions, real-console verification is manual (tasks).
- [Google adds bot detection to the console] → the run stops at an unknown page → handoff; nothing is half-written beyond Google-side resources the user can see.
- [Run creates a project/client the user did not want] → explicit start, decision checkpoints before audience and publish, and the run view lists what was created.
- [Secret in memory of the server process] → same trust boundary as the stored client secret today.
- [Unused orphan clients after secret-capture failure or a retry] → `created.clients` lists every client the run made, names are suffixed, and the handoff explains adding a secret or deleting the client.
- [Remote dashboard users] → the entry is local-only; remote users get the manual wizard.
- [The owner signs in on every run] → accepted: setup is a one-off, and the throwaway context keeps an owner-capable Google session out of the agent's default browser.

## Migration Plan

Additive. `setup` record optional. Rollback leaves stored clients untouched.

## Open Questions

- Whether `hl=en` is honoured on every `console.cloud.google.com/auth/*` page (the locale check hands off if not).
