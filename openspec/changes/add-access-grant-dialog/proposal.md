# Add access-grant dialog (ask at the moment of denial)

## Why

`add-access-grants-and-review` gives the filesystem plane a grant mechanism and a
review surface, but a denial still can only *name* its remedy — the operator has
to go somewhere else and act. The stated requirement is stronger: **when a guard
hits, ask.** An active blocking dialog at the moment of denial, with
`Allow this request` / `Allow always` / `Deny`.

That is not what makes this change hard. This change exists as a separate change
because of one question that resisted four attempts:

> **Which requests may raise a dialog on the operator's screen?**

A dialog is an action performed *on the operator*. If any web page the operator
visits can provoke one, the dialog is a confused-deputy weapon: an attacker
generates a containment miss, a modal appears, and one habituated
"Allow always" click persists a filesystem grant. So the dialog cannot ship until
that question has a defensible answer.

## Prior attempts and why each failed

Recorded so the next attempt does not rediscover them. All four were defeated by
adversarial review against source, not in the abstract.

| # | Proposed rule | Defeated by |
|---|---|---|
| 1 | "The caller is always a human — every `/api/file*` caller is in `packages/client/`" | True but irrelevant. Nothing *binds* an inbound HTTP request to the dashboard app; any page can emit one. |
| 2 | Require a dashboard-issued auth credential | `device-auth.ts:72-80` attaches `Authorization` **only** when a paired-device bearer exists; `auth-plugin.ts:296` bypasses auth entirely for loopback; and the OAuth session is a **`SameSite=Lax` cookie**, which a cross-site GET *does* carry. So it denies the prompt to the primary audience (local browser, auth off) *and* fails to exclude a drive-by. |
| 3 | Require a custom `X-Pi-Dashboard` header, relying on CORS preflight to gate it | Delegates the decision to `isCorsOriginAllowed`, which admits far more than the configured origins — `cors-origin.ts:84` allows **any** `*.share.zrok.io` / `*.shares.zrok.io` host. An attacker hosting a free zrok share passes preflight and sets the header. |
| 4 | `Sec-Fetch-Site: same-origin` + `Origin` matching the request's own `Host` + genuinely-local source | **DNS rebinding.** Deriving the expected origin from the request's own `Host` is self-referential: an attacker domain rebound to `127.0.0.1` produces `Sec-Fetch-Site: same-origin`, a matching `Origin`, and a loopback peer. There is **no `Host` validation anywhere** in the server. Also: `Sec-Fetch-*` is absent on Safari < 16.4, so a legacy-browser `<img>` drive-by lands in the both-headers-absent branch and is indistinguishable from a local curl. Also: the cross-origin `pi-dashboard.dev` shell is `cross-site` **by construction**, so it would never get a dialog at all. |

Two lessons the next attempt should carry:

- **Never delegate eligibility to a policy tuned for something else.** Attempts
  2 and 3 both failed this way (auth, then CORS).
- **Header-only eligibility appears to be insufficient in principle**, not just
  in these four spellings: it cannot distinguish a legacy-browser drive-by from a
  legitimate local non-browser client, and it cannot serve a cross-origin shell.
  A per-boot secret the SPA holds and echoes (delivered in the served HTML, which
  no cross-origin page can read) is the untried direction, and its known cost is
  needing a separate delivery path for the shell deployment.

## What Changes

- **A server-owned pending-grant registry.** Today the server only *relays*
  `prompt_request`/`prompt_response` between a pi session's `PromptBus` (which
  lives in `packages/extension/`, is session-scoped, and has no bearing on a
  sessionless guard hit) and the browser. This adds a registry that can hold a
  request open, push a dialog over `BrowserGateway`, and settle on the first
  reply — modelled on the existing `ResyncRequesterRegistry` (record / take /
  forget, TTL, bounded).

- **An eligibility policy** answering the question above. **Undecided — this is
  the substance of the change and must be designed and adversarially reviewed
  before anything else here is built.**

- **The dialog overlay and its protocol frames** — `grant_request`,
  `grant_response`, `grant_dismiss` — with first-response-wins across multiple
  connected clients.

- **Opt-in and a kill switch.** The prompt ships behind a setting that defaults
  off, plus `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1` for automated environments.
  Both suppress *prompting* only; grants already given stay in force. The
  no-audience rule is necessary but **not sufficient** for automated
  environments, because Playwright E2E runs with a browser connected.

- **Held-request transport.** Fastify is configured with
  `connectionTimeout: 10_000` (`server.ts:1119`), so a held request must clear
  its socket timeout and restore it on `finish` — the pattern `git-routes.ts:401`
  already uses, including its `!socket.destroyed` guard.

**Depends on `add-access-grants-and-review`**, which supplies the grant store,
the subtree predicate, the Access tab, and the denial bodies. Without it a
verdict would have nothing to persist into and no way to be revoked.

## Capabilities

### New Capabilities

- `access-grant-eligibility`: the rule deciding which denials may raise a dialog.
  Must survive the four defeats above.
- `access-grant-registry`: server-owned pending-grant registry — hold a denied
  request, push a prompt, settle on reply, coalesce by `(plane, subject)`, fail
  closed on every path.
- `access-grant-dialog`: the client overlay and its protocol frames.

### Modified Capabilities

- `file-read-containment`: a containment miss may suspend pending a verdict
  instead of refusing immediately.
- `pinned-directories`: an unknown-`cwd` denial may raise a dialog whose
  `Allow always` verdict pins the directory.
- `path-anchor-grants`: grants become creatable from a verdict, not only from the
  Access tab.

## Impact

- **Affected code:** a new grant registry under `packages/server/src/access/`,
  `packages/server/src/pairing/browser-gateway.ts` (prompt push, response
  routing, and a new **global** connected-browser count — only a per-session
  `getSubscriberCount` exists at `:111`),
  `packages/shared/src/browser-protocol.ts`, the containment and cwd denial
  sites, plus a new overlay component in `packages/client/`.
- **Behaviour change:** only when the operator opts in. Then denials that are
  terminal today may suspend for the prompt window.
- **Risk:** a held HTTP request consumes a connection. Coalescing must be by
  `(plane, subject)` — keying on the bare path would let a cwd denial join a
  path-grant verdict and apply the wrong remedy — and a settled subject must
  back off before re-prompting, or a polling client re-prompts on every poll.

## Discipline Skills

- `security-hardening` — the eligibility policy *is* a security control, and it
  is the reason this change exists separately.
- `doubt-driven-review` — mandatory on the eligibility decision before anything
  is built. Four prior attempts were each defeated only under adversarial review;
  none looked wrong when written.
- `scenario-design` — the fail-closed matrix (timeout, no audience, disabled,
  ineligible, disconnect, client abort, over-capacity, revoke-while-pending,
  duplicate and malformed responses) is where correctness lives.
- `observability-instrumentation` — a suspended request and its verdict need to
  be diagnosable after the fact.
- `review-code` — before commit, per project default.
