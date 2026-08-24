## Why

A small trusted team holds several subscription OAuth accounts (Anthropic, openai-codex) across several machines. Today each account lives as a single entry in one person's `~/.pi/agent/auth.json`, and there is no way to (a) share it, (b) keep its refresh token alive when that machine is off, or (c) fail over when one account is rate-limited mid-turn. The team wants a self-hosted service — an npm package plus a docker image — that stores the accounts, performs refresh keepalive, and lets every member's pi sessions draw on the pool, with GitHub/Google login and a super-admin who can grant and revoke access.

**The service is a provider-shaped proxy, not a credential distributor.** Members point pi at the keysync endpoint and authenticate with a keysync-issued key; keysync holds the pooled provider accounts and forwards upstream on their behalf. No *teammate's* provider token ever reaches a member's machine, and none persists there after enrolment — stated precisely, because enrolment itself necessarily creates a credential on the enrolling member's own machine before uploading it (see below). During steady-state operation a member's disk holds one secret: their keysync key.

### Why the proxy shape, and not credential sync

An earlier revision of this proposal synced credentials down into each member's `auth.json`. Source investigation established the mechanics that would have made that work — `auth.json` is revision-checked on every read (`core/auth-storage.js:337-339`), OAuth credentials are re-resolved per call (`provider-composer.js:260`), and pi's agent-level retry re-runs `getAuth()` so an externally swapped credential lands on the next attempt (`agent-session.js` `_willRetryAfterAgentEnd` → `:169`). That design was viable. It was also strictly worse, for three reasons that only became visible once the proxy alternative was on the table:

- **It forced plaintext provider tokens onto every member's disk.** `resolveConfigValue` is applied only to `credential.key` (`auth-storage.js:377`), so an OAuth access token cannot be fetched at call time and must rest at mode `0600` on each laptop. The confidentiality ceiling of the whole system was therefore the least-secure teammate's machine — a ceiling that no server-side cryptography could raise. Under the proxy the tokens never leave the server and that ceiling disappears.
- **It made exhaustion a matter of trust.** With the client issuing the request, only the client sees the 429, so the server had to either believe an unverified report — letting one buggy or hostile client disable the pool — or run its own verification probes. Under the proxy the server issues the request and observes the 429 first-hand. The entire trust boundary, and the state machine built to defend it, cease to exist.
- **It could not retry the failing request.** A swapped credential landed one agent-level retry later at best. The proxy holds the request, so on a 429 it can select another account and forward the *same* request upstream: rotation becomes lossless rather than costing a turn.

Revocation improves for the same reason. Under sync, a departed member kept working until their lease expired; under the proxy, revoking their key stops them at the next request. And per-member attribution — which the sync design gave up and tried to recover with account pinning — is native, because every forwarded request carries the key that authorised it.

### Prior art in this repository

`packages/server/src/model-proxy/` already implements most of these mechanics for the dashboard's own proxy, and is the reference for how each part is known to work rather than assumed:

- `internal-auth-storage.ts` — `ensureFreshOAuth` refreshes OAuth credentials 30s before expiry, serialises concurrent refreshes per provider through `refreshLocks`, and persists via `writeCredential`. `OAUTH_PROVIDER_MAP` already covers `anthropic`, `openai-codex`, `github-copilot`.
- `api-key-store.ts` — issued-key lifecycle: `hashKey` (sha256), constant-time `verifyKey`, `generateKey`, and a discriminated `FindResult` of valid/revoked/expired/miss.
- `auth-gate.ts` — bearer enforcement with `AUTH_REVOKED` / `AUTH_EXPIRED` / `SCOPE_INSUFFICIENT`, plus per-IP failed-auth backoff.
- `concurrency.ts` — nested per-key and per-provider concurrency caps returning `retryAfterMs`.

This change does **not** extend that subsystem — see the standalone-deployable decision below — but it treats these as proven designs to follow rather than problems to re-solve.

### Constraints carried forward

- **Exactly one refresher may exist per account.** Anthropic and openai-codex rotate `refresh` on use, so two concurrent refreshers produce a lost-update race that revokes the token family. The proxy shape makes this nearly free: the account exists in exactly one place, so there is one candidate refresher by construction rather than by distributed coordination.
- **Not every model is reachable over an OAuth credential.** `packages/server/src/model-proxy/oauth-compat.ts` maintains a per-provider set of model ids that OAuth credentials cannot route, and the dashboard registry already filters them. A pooled-OAuth proxy inherits this restriction; it is a property of the providers, not of this design.
- **Accepted risk, recorded deliberately:** pooling subscription OAuth accounts across team members is contrary to Anthropic's and OpenAI's terms of service. Concentrating that traffic behind one server address is a *more* recognisable signature than several laptops, not less. The team has chosen this trade knowingly. The design therefore prioritises per-account attribution and fast revocation so a flagged account can be isolated without disrupting the pool.

## What Changes

- Add `packages/keysync-server/` — a standalone npm package (`bin` entry) plus a docker image, runnable with no pi-dashboard present. It owns authentication, the encrypted account vault, the refresher, the pool, and the forwarding proxy. It is deliberately **not** built by extending `packages/server/src/model-proxy`, so that key availability does not depend on anyone running a dashboard; the cost is that key-store, auth-gate, and refresh logic are reimplemented rather than shared.
- **Clients hold no provider credentials.** A member configures a provider entry pointing at keysync — `baseUrl`, an `api` of `anthropic-messages` / `openai-completions` / `openai-responses`, and a keysync-issued key — which is the documented shape for routing pi through a proxy (`docs/models.md`, Provider Configuration). Their `auth.json` holds only that key.
- **The pool lives server-side, with per-account visibility.** Each enrolled account is `private` (usable only by the member who enrolled it) or `shared` (usable by any member). A member's selection pool is their own private accounts plus every shared account, so rotation spans both and cannot distinguish them. Visibility is toggleable, and clearing `shared` withdraws the account from other members at their next request.
- **Several accounts per provider, captured in isolation and uploaded.** Enrolment runs against a scratch config directory via `PI_CODING_AGENT_DIR` (`docs/environment-variables.md`) so the member's existing credential is never touched, then uploads the captured credential and destroys the scratch directory. **The capture mechanism itself is not yet settled** — an earlier revision of this proposal asserted that pi's own login could be run non-interactively, which is false: `pi auth` is read-only and the only login surface is the interactive TUI. Three candidates remain, and a spike selects one before any enrolment code is written (design D10).
- **Per-member primary selection, restricted to accounts the member owns.** Each member marks one account per provider as their primary; it is selected whenever healthy, and rotation returns to it once it recovers. A teammate's shared account may be rotated *to*, but may not be pinned as a default — sharing offers overflow capacity, not someone else's steady-state spend. This restriction is also what makes the admin kill-switch below a genuine guarantee.
- **Rotation is per-request, server-side, and lossless.** On an upstream 429 the proxy marks the account cooling using `retry-after`, selects the next account from that member's pool, and forwards the same request. The member's turn does not fail. No client hook, no `auth.json` write, and no dependence on pi's retry behaviour.
- **Rotation is switchable, and gated twice.** An admin-owned global switch and a per-member switch both default on; rotation occurs only when **both** are on. With rotation off, only the member's primary account is used and an upstream 429 is returned to the client unchanged. Both switches take effect at the next request, so the admin switch works as a live kill-switch during an incident — the moment cross-account traffic needs to stop, it stops, without waiting for members to cooperate or sessions to restart. Enforcement is in the proxy, so a member cannot override the admin switch.
- **Exhaustion is observed, not reported.** The proxy is the party making the upstream call, so account health is first-hand fact. There is no client report to authenticate and no verification probe to schedule.
- A **single refresher** loop keeps every enrolled account's refresh token alive, guarded so a second server instance cannot act on the same account.
- Authentication via **better-auth**: GitHub and Google social providers, plus its `admin` plugin for the super-admin role. Chosen over Ory/Keycloak/Zitadel/SuperTokens because it is a TypeScript library rather than a separate identity service, keeping deployment to one container with embedded SQLite; and over Auth.js because Auth.js supplies no admin/RBAC layer.
- The vault is **built, not delegated** to OpenBao or Infisical. Neither performs OAuth refresh keepalive nor exhaustion rotation — the two things this change exists for — so standing on one would add a mandatory unseal ceremony (hostile to an unattended always-on refresher) or a Postgres+Redis dependency, while leaving the novel work still to be written. Storage is SQLite with libsodium envelope encryption: per-account DEK wrapped by a KEK supplied at boot.
- Add `packages/keysync-client/` — a thin pi-dashboard plugin. It performs enrolment capture and upload, writes the local provider configuration pointing at keysync, and surfaces pool state. It handles no credentials and performs no rotation.

## Capabilities

### New Capabilities

- `keysync-server-scaffold`: The `packages/keysync-server` package — npm `bin` entry, dockerfile, config surface, SQLite schema and migrations.
- `keysync-authn`: GitHub and Google OAuth login via better-auth; session issuance for the admin and member UI.
- `keysync-authz`: Roles (`admin` / `member` / `revoked`), super-admin grant and revoke, and enforcement on every proxy and management route. Revocation cancels *every* key the member holds — they work across several machines — and simultaneously withdraws the accounts they contributed, so the team stops spending a departed member's subscription. Takes effect on the next request.
- `keysync-member-keys`: Issue, list, and revoke per-member keysync keys — hashed at rest, constant-time verified, with revoked/expired states and per-IP failed-auth backoff.
- `keysync-vault`: Envelope-encrypted account storage — per-account DEK wrapped by a boot-supplied KEK, ciphertext at rest, plaintext only in server memory.
- `keysync-refresher`: Single-writer refresh keepalive. Refreshes before `expires`, persists the rotated `refresh` atomically, and guarantees no second refresher acts on the same account.
- `keysync-enrolment`: Capture an additional provider account in an isolated scratch `PI_CODING_AGENT_DIR` and upload it to the pool without disturbing the member's existing credential. The capture mechanism is spike-selected (D10); the isolation guarantee and the upload path are fixed regardless of which candidate wins.
- `keysync-visibility`: Per-account `private` / `shared` selection. Sharing publishes an account to every member; unsharing withdraws it, taking effect at other members' next request.
- `keysync-primary-selection`: Per-member, per-provider primary account, constrained to accounts the member owns; selected whenever healthy and returned to after a rotation once it recovers.
- `keysync-pool-selection`: Ordered selection over a member's pool (own private plus all shared) with health states `ok` / `cooling` / `dead`, provenance-blind ordering, and defined behaviour when every account is cooling.
- `keysync-proxy-forwarding`: Provider-shaped endpoints (`anthropic-messages`, `openai-completions`, `openai-responses`) that authenticate the member key, select an account, forward upstream with that account's OAuth token, and stream the response back.
- `keysync-rotation`: On an upstream 429, mark the account cooling from `retry-after`, select the next account, and re-forward the same request transparently, with a bounded attempt limit.
- `keysync-rotation-toggle`: Admin-global and per-member rotation switches, both defaulting on and combined with AND. When rotation is off, selection is confined to the member's primary account and a 429 is returned to the client. Changes apply at the next request without a session restart, and enforcement is server-side so the admin switch cannot be bypassed by a client.
- `keysync-audit`: Append-only record of enrolment, forwarding, rotation, revocation, and refresh outcomes, attributable to member and account.
- `keysync-client-plugin`: Dashboard plugin that runs enrolment capture, writes the local provider configuration targeting keysync, and displays pool and account state.

### Modified Capabilities

(none — two net-new packages; no core dashboard package is modified)

## Discipline Skills

Tasks in this change trigger the following `eng-disciplines` skills:

- **`security-hardening`** — the change stores long-lived provider credentials, authenticates untrusted callers over the network, forwards untrusted request bodies upstream, and handles secrets at rest and in memory. The auth, secrets, and untrusted-input checkpoints all fire.
- **`doubt-driven-review`** — the single-refresher invariant is irreversible in effect once accounts are enrolled: a mistaken refresher design revokes real token families. Runs before the refresher lands.
- **`observability-instrumentation`** — new network endpoints, a long-lived background refresher, and per-request account selection. Rotation and refresh failures must be diagnosable after the fact, not inferred.
- **`performance-optimization`** — fires unconditionally under the proxy shape, unlike the previous revision: keysync is now on the latency path of every model request, and streaming must pass through without buffering.
- **`systematic-debugging`** — reserved for refresh-race and streaming/rotation-timing failures, which resist guess-and-check fixes.
- **`review-code`** — non-trivial multi-package change; runs before commit.
- **`code-simplification`** — applies conditionally, if the vault or forwarding layer grows past the thin seam this proposal scopes it to.

## Impact

- New workspaces: `packages/keysync-server/`, `packages/keysync-client/`, both registered in `pnpm-workspace.yaml`.
- No core dashboard package is modified. `packages/server/src/model-proxy` is referenced as prior art and left untouched.
- **Availability changes shape.** keysync sits on the request path of every model call, so a keysync outage stops every member — where credential sync would have left a cached credential working offline. This is the principal cost of the chosen architecture and is accepted deliberately.
- Turning rotation off is the supported response to a flagged account or a ToS scare: it reduces keysync to a credential-isolating single-account proxy, which is still strictly better than credentials on laptops. The system remains useful in its most conservative configuration rather than becoming all-or-nothing.
- **Reimplementation cost, stated plainly.** `api-key-store.ts`, `auth-gate.ts`, and the OAuth-refresh logic in `internal-auth-storage.ts` are proven implementations that this package will duplicate in order to stay independently deployable. If the duplication drifts, the remedy is to extract the pure helpers into a shared workspace package — a follow-up refactor of working dashboard code, deliberately out of scope here.
- Client surfaces are plugin-contributed and modelled on the existing `ProviderAuthSection` rather than replacing it: an accounts panel (pool, primary, visibility, health), an enrolment flow, and an admin view for members and audit. UX mockups live in `mockups/` with rationale in `mockups/ui-plan.md`.
- **Enrolment carries the change's largest unknown.** Its isolation mechanism (`PI_CODING_AGENT_DIR`) is verified; its *capture* mechanism is not, and pi offers no non-interactive login to build on. A blocking spike settles it before implementation. If `PI_CODING_AGENT_DIR` is later withdrawn upstream, enrolment needs another isolation mechanism; forwarding and rotation are unaffected either way.
- **A second unverified assumption gates the refresher:** whether providers issue independent, concurrently-valid grants per authorization. If they do not, a member cannot both enrol an account and keep using it locally — each login would invalidate the other. Measured on a low-value account in the same spike.
- Models flagged in `oauth-compat.ts` as unroutable over OAuth remain unavailable through pooled OAuth accounts. The client plugin should surface this rather than let a member discover it as an opaque failure.
- New runtime dependencies confined to the new packages: better-auth, a SQLite driver, libsodium bindings.
- Deployment adds one container. Operators must supply a KEK at boot; the service must start unattended after a reboot, so a human-in-the-loop unseal ceremony is explicitly out of scope.
- Rollback: both packages are additive. Removing the client plugin and restoring a direct provider entry returns a member to normal single-account operation; nothing in their `auth.json` was overwritten.
- Compromise of the keysync host exposes every pooled account, since it necessarily holds plaintext in memory to forward requests. This is the concentrated-risk counterpart to removing per-laptop plaintext, and is bounded by host hardening and audit rather than by cryptography.
- Pooling subscription OAuth accounts across members violates the providers' terms of service and risks suspension of individual members' personal accounts. Accepted knowingly; per-account attribution and fast revocation limit how far one flagged account propagates.
