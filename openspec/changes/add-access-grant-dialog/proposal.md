# Add access-grant dialog (ask at the moment of denial, on every plane)

## Why

`add-access-grants-and-review` gives every access plane a grant mechanism and a
review surface, but a denial still can only *name* its remedy — the operator has
to go somewhere else and act. The stated requirement is stronger: **when any
guard hits — filesystem, network, CORS, auth/pairing, or a plane added later —
ask.** An active dialog raised on the operator's screen at the moment of denial,
with `Allow this request` / `Allow always` / `Deny`.

That is not what makes this change hard. This change exists as a separate change
because of one question that resisted four attempts:

> **Which requests may raise a dialog on the operator's screen?**

A dialog is an action performed *on the operator*. If any web page the operator
visits can provoke one, the dialog is a confused-deputy weapon: an attacker
generates a denial, a modal appears, and one habituated "Allow always" click
persists a grant. So the dialog cannot ship until that question has a defensible
answer — and generalizing from one plane to every plane **widens** that question
rather than answering it (see *Eligibility* below).

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

## Two settlement modes

Generalizing past the filesystem forces one structural distinction. A local
filesystem request can be **held open** while the operator decides. A denial from
an untrusted remote peer cannot: the parent change already established that the
denied party is untrusted by definition, and once
`add-universal-network-guard` lands a new device is denied at the ws-ticket mint
endpoint and never opens a WebSocket at all. Asking *it* to wait is neither safe
nor possible.

The dialog is raised on the **operator**, never on the requester, so it serves
both — with different settlement:

| Mode | Denied request | Verdict applies | Planes |
|---|---|---|---|
| **HELD** | suspended pending the verdict; on `Allow` the original request proceeds and returns its real result | to *this* request, plus persisted on `Allow always` | filesystem containment, unknown-`cwd` — and only when the request is **eligible** |
| **DEFERRED** | denied immediately with today's 403 | to the requester's **next retry**; nothing is held | network / trusted-networks, CORS origin, auth / pairing, and any plane whose requester is untrusted or unreachable |

DEFERRED is the existing request→accept flow from the parent change with a
**prompt** attached instead of only a passive pending-list entry. It adds no
inbound attack surface: the untrusted side still sends nothing it could not send
today, and it learns nothing from the verdict except that a later retry works.

An **ineligible** HELD-plane denial degrades to DEFERRED — it is recorded and may
prompt, but the request is never suspended. Fail-closed on every path.

## What Changes

- **A server-owned, plane-agnostic pending-grant registry.** Today the server
  only *relays* `prompt_request`/`prompt_response` between a pi session's
  `PromptBus` (which lives in `packages/extension/`, is session-scoped, and has
  no bearing on a sessionless guard hit) and the browser. This adds a registry
  that can record a denial on **any** plane, push a dialog over
  `BrowserGateway`, and settle on the first reply — modelled on the existing
  `ResyncRequesterRegistry` (record / take / forget, TTL, bounded). Entries are
  keyed `(plane, subject)`; HELD entries additionally carry the suspended
  request's continuation.

- **A plane registration seam, so "any other access" is not a rewrite.** Each
  plane contributes: its subject extractor, its settlement mode, the grant store
  the `Allow always` verdict writes to, and its revoke path. A future guard
  becomes a registration, not a new dialog. The planes registered by this change
  are exactly those the parent change already made grantable — filesystem path
  grants, pinned directories, trusted networks, CORS origins, auth bypass hosts,
  worktree-init trust, KB source trust, project trust.

- **An eligibility policy** answering the question above. **Undecided — this is
  the substance of the change and must be designed and adversarially reviewed
  before anything else here is built.** Generalizing widens it in two ways that
  the design must address explicitly: (a) the **proof differs per plane because
  the question differs** — a HELD plane asks "may this request be suspended and
  resumed?", which only the request can answer, so it must carry a
  request-binding proof; a DEFERRED plane asks "may the operator be told?", and
  its requester is untrusted by definition and will never hold such a proof, so
  the authority to prompt comes from the **operator's own live channel** rather
  than from the request. Neither plane is exempt from proof; they require
  different proofs of different parties. (b) the prompt surface is larger, so
  **prompt flooding** becomes a denial-of-attention vector — rate limiting
  per plane **and per requester**, plus the settled-subject backoff, are part of
  the policy, not an add-on.

- **The dialog overlay and its protocol frames** — `grant_request`,
  `grant_response`, `grant_dismiss` — carrying the plane so the overlay can
  render plane-appropriate copy (a path, a CIDR, an origin, a device) and the
  correct verdict vocabulary. First-response-wins across multiple connected
  clients.

- **Opt-in and a kill switch.** The prompt ships behind a setting that defaults
  off, plus `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1` for automated environments.
  Both suppress *prompting* only; grants already given stay in force, and
  DEFERRED denials still land in the pending list the Access tab shows. The
  no-audience rule is necessary but **not sufficient** for automated
  environments, because Playwright E2E runs with a browser connected.

- **Held-request transport.** Fastify is configured with
  `connectionTimeout: 10_000` (`server.ts:1119`), so a HELD request must clear
  its socket timeout and restore it on `finish` — the pattern `git-routes.ts:401`
  already uses, including its `!socket.destroyed` guard. DEFERRED denials need
  none of this, which is the main reason the two modes are kept distinct rather
  than forcing every plane through a hold.

- **A time-boxed YOLO mode, filesystem and working-directory planes only.** The
  realistic failure of an ask-at-denial design is not a wrong click, it is
  *clicking `Allow always` until the prompt stops meaning anything*. YOLO is the
  pressure valve: while active, a prompt-eligible containment or unknown-`cwd`
  denial is auto-allowed **once**, persisting nothing, under a countdown that
  activity cannot extend. It is structurally incapable of reaching the network,
  CORS, auth or pairing planes — auto-answering for an untrusted requester would
  not skip a prompt, it would remove the guard. It requires prompt-eligibility,
  so a drive-by is still denied while it is on, and the forbidden-subject rule
  (`/`, `$HOME`, `~/.ssh`, `~/.pi`, system directories) stays absolute. An
  environment variable covers containers; an operator toggle with a chosen
  duration covers a live session, behind an undismissable indicator.

- **Out of scope: agent tool calls.** `bash` / `write` / `edit` approval is
  `add-supervised-tool-approval`, which gates pi's blocking `tool_call` event and
  reuses the existing `PromptBus` round-trip. It is the **tool-call plane** of
  the same product idea and should converge on this dialog's copy and verdict
  vocabulary, but it is not absorbed here: different mechanism (in-session
  extension hook, not an HTTP guard), different trust model (the caller is the
  operator's own agent), and it needs none of the eligibility work that is this
  change's reason to exist.

**Depends on `add-access-grants-and-review`**, which supplies the grant stores,
the subtree predicate, the Access tab, the generalized pending-access-request
queue, and the denial bodies. Without it a verdict would have nothing to persist
into and no way to be revoked. That change in turn depends on
`add-universal-network-guard`, which collapses ~20 per-route denials into one
`onRequest` hook — the single instrumentation point this registry hangs off.

## Capabilities

### New Capabilities

- `access-grant-eligibility`: the per-plane rule deciding which denials may raise
  a dialog, and which may additionally suspend a request. Must survive the four
  defeats above, plus prompt-flooding.
- `access-grant-registry`: server-owned, plane-agnostic pending-grant registry —
  record a denial, push a prompt, settle on reply, coalesce by `(plane, subject)`,
  fail closed on every path. HELD entries hold a continuation; DEFERRED entries
  do not.
- `access-grant-dialog`: the client overlay and its protocol frames, rendering
  plane-appropriate subject and verdict copy.
- `access-grant-yolo`: time-boxed automatic answering on the filesystem and
  working-directory planes — allow-once only, nothing persisted, structurally
  unable to reach an untrusted-requester plane.

### Modified Capabilities

- `file-read-containment`: a containment miss may suspend pending a verdict
  instead of refusing immediately (HELD).
- `pinned-directories`: an unknown-`cwd` denial may raise a dialog whose
  `Allow always` verdict pins the directory (HELD).
- `path-anchor-grants`: grants become creatable from a verdict, not only from the
  Access tab.
- `network-denial-ring-buffer`: the pending-access-request queue gains an active
  push — an entry can raise a prompt, not only wait to be noticed (DEFERRED).
- `trusted-networks`: a network denial may prompt; `Allow always` writes
  `config.trustedNetworks` and the requester's next retry succeeds.
- `server-cors`: an origin denial may prompt instead of surfacing only as an
  opaque browser CORS failure.
- `access-settings-tab`: shows pending prompts and recent verdicts alongside the
  grants they produced, and is the place a prompt-suppressed environment still
  reviews denials.

## Related changes

- **`harden-server-request-surfaces`** — owns the Host-admission default flip
  (`report` → `enforce`). It is **not** a prerequisite: this change assumes
  neither value and reads the **live resolved mode**, so it is correct and useful
  on a reporting-mode install today and gains suspension automatically when that
  change lands. Neither change blocks the other, and this one SHALL NOT
  re-decide that default. See `design.md` D2b.
- **`add-access-grants-and-review`** — owns the grant stores, the Access surface,
  the forbidden-subject rule, and the bounded ancestor ladder. This change
  **consumes** the ladder and never recomputes it.
- **`add-supervised-tool-approval`** — the tool-call plane, deliberately separate.

## Impact

- **Affected code:** a new grant registry and plane registry under
  `packages/server/src/access/`,
  `packages/server/src/pairing/browser-gateway.ts` (prompt push, response
  routing, and a new **global** connected-browser count — only a per-session
  `getSubscriberCount` exists at `:111`),
  `packages/shared/src/browser-protocol.ts`, the containment and cwd denial
  sites, the universal network guard's denial path, the CORS origin check, plus a
  new overlay component in `packages/client/`.
- **Behaviour change:** only when the operator opts in. Then HELD-plane denials
  that are terminal today may suspend for the prompt window; DEFERRED-plane
  denials keep their current status code and timing and only gain a prompt.
- **Risk:** a held HTTP request consumes a connection — which is why only
  eligible HELD planes may hold. Coalescing must be by `(plane, subject)` —
  keying on the bare subject would let a cwd denial join a path-grant verdict and
  apply the wrong remedy, and across planes it would let a network subject
  collide with a filesystem one. A settled subject must back off before
  re-prompting, or a polling client re-prompts on every poll; with every plane
  registered, that backoff is the difference between a prompt and a prompt storm.

## Discipline Skills

- `security-hardening` — the eligibility policy *is* a security control, and it
  is the reason this change exists separately. It now spans every plane,
  including ones whose requester is hostile by definition.
- `doubt-driven-review` — mandatory on the eligibility decision and on the
  HELD/DEFERRED plane assignment before anything is built. Four prior attempts
  were each defeated only under adversarial review; none looked wrong when
  written.
- `scenario-design` — the fail-closed matrix (timeout, no audience, disabled,
  ineligible, disconnect, client abort, over-capacity, revoke-while-pending,
  cross-plane subject collision, prompt flooding, duplicate and malformed
  responses) is where correctness lives.
- `observability-instrumentation` — a suspended request, a deferred denial, and
  every verdict need to be diagnosable after the fact, with the plane recorded.
- `review-code` — before commit, per project default.
