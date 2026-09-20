## Context

See `proposal.md — Why` for motivation. This document decides the one thing the
proposal deliberately left open: **which denials may raise a dialog on the
operator's screen, and which may additionally suspend a request.**

Four prior eligibility rules were defeated (proposal table). Since they were
written, two changes landed that move the ground:

- **`add-host-allowlist-admission`** added `auth/host-admission.ts` +
  `auth/host-gate.ts`. Defeat #4's load-bearing claim — *"there is no `Host`
  validation anywhere in the server"* — is **no longer true**. `isHostAdmitted`
  is a hostname-only, fail-closed allowlist (loopback → IP literal → bindHost
  name → `*.local` → publicBaseUrls → CORS origins → live tunnels →
  `allowedHosts`), gated by `resolveHostGateMode`. **But the shipped default is
  `report`** (`shared/src/config.ts:1086`), i.e. observe-and-log, not refuse.
- **`fix-ws-origin-cswsh`** split read-admission from act-admission
  (`isOriginAdmitted` / `isWsOriginTrusted` / `isMutationOriginTrusted`) and
  added `auth/mutation-origin-gate.ts`, a cross-site mutation gate over `/api/*`
  matched on `req.routeOptions.url` (the post-routing pattern, not raw `req.url`).

Other constraints that shape the approach:

- `BrowserGateway` (`pairing/browser-gateway.ts`) is the only push channel to a
  browser. Its upgrade is gated by `isWsOriginTrusted`, plus — where auth is
  configured or the caller is off-host — a cookie session, a local-IPC token, a
  trusted CIDR, **or** a single-use scope-bound `ws-ticket`
  (`auth/ws-ticket.ts`, ~15 s TTL, `consume` deletes on first attempt). These
  are **disjuncts, not a chain**: with no auth secret, `server.ts:2934-2946`
  admits any genuinely-local peer with no ticket at all, and
  `device-auth.ts:85-88` says an unpaired browser deliberately connects
  ticketless. So for the primary audience the channel is gated by origin
  admission and `isGenuinelyLocal` alone — exactly the residual D1a names. It exposes only a per-session `getSubscriberCount`
  (declared `:278`, implemented `:2060`) — there is no global connected-browser count.
- `PromptBus` prompts are **session-scoped** and live in `packages/extension/`.
  A guard hit is sessionless. The existing relay cannot carry this.
- `ResyncRequesterRegistry` (`pairing/subagent-resync-routing.ts`) is the
  in-repo precedent for a bounded, TTL'd, take-once correlation registry.
- Fastify runs with `connectionTimeout: 10_000` (`server.ts:1314`). The
  clear-and-restore pattern for a long-running request is
  `git-routes.ts:470-478` (capture `socket.timeout`, `setTimeout(0)`, restore on
  `reply.raw.once("finish")` behind `!socket.destroyed`).
- `POST /api/git/worktree/init` already ships the DEFERRED shape: an untrusted
  hook returns `init_untrusted` **carrying the definition for the client to
  confirm**, and the client retries with `confirmHash`. Nothing is held.
- `index.html` is served by `@fastify/static` with `preCompressed: true`, and in
  dev by a Vite proxy in `setNotFoundHandler` (`server.ts:2137-2166`). There is
  no HTML templating step.

## Goals / Non-Goals

**Goals:**

- A single eligibility rule that survives the four recorded defeats **and** the
  widening to every plane, stated as a positive proof rather than a heuristic.
- One registry and one dialog serving planes whose requesters have opposite
  trust properties.
- Fail closed on every path, including the paths that are not about security
  (no audience, disabled, over capacity, timeout, disconnect).
- A registration seam so a future guard is a registration, not a redesign.

**Non-Goals:**

- Defending a dashboard origin that is already executing attacker script (XSS in
  the SPA, or a malicious extension). Such code can call the API directly; a
  dialog is not the weakest link.
- Giving non-browser local clients (curl, CLI, scripts) a held request. They are
  explicitly served by DEFERRED only.
- Changing any guard's default-deny behaviour, or making the dialog the only way
  to reach a grant. The Access tab stays a complete, prompt-free path.
- Tool-call approval (`add-supervised-tool-approval`).

## Decisions

### D1 — Eligibility is proven by possession of a live operator channel, not by request shape

**Decision.** A denial may raise a dialog only when the server can attribute it
to an **already-authenticated operator channel**. Concretely: on connect,
`BrowserGateway` issues each browser socket a **socket-bound prompt capability**
(`grant_channel` frame carrying a high-entropy nonce, rotated per connection,
held only in memory and never persisted). A request becomes **prompt-eligible**
by echoing that nonce in `X-Pi-Grant-Channel`. The server resolves the nonce to
the issuing socket and raises the dialog **on that socket's operator**.

**Why this survives the four defeats.**

| Defeat | Why it does not apply |
|---|---|
| #1 caller-is-human | This is not an inference about the caller. A drive-by page has no `BrowserGateway` socket, therefore no nonce, therefore no **held** dialog and no suspension. It may still reach a DEFERRED prompt — see the accepted residual **D3-R1**, which states that scope honestly rather than claiming "no dialog". |
| #2 auth credential | The nonce is independent of auth configuration. It is issued to a loopback browser with auth off exactly as to a paired device — the primary audience is served, which is where #2 died. |
| #3 CORS-gated custom header | Eligibility does not consult `isCorsOriginAllowed` at all. A zrok-share attacker who passes preflight and sets the header still has to *guess the value*. The header is a carrier, not the credential. |
| #4 header-shape / legacy browsers | No `Sec-Fetch-*` dependence **for request eligibility** — a request proves itself by the nonce alone. Issuance *does* consult `Sec-Fetch-Site` (D1a), so a browser that omits it is issued no capability and never gets a held dialog; that degradation is surfaced on the Access tab rather than left silent. And the legacy-browser-vs-local-curl ambiguity that killed #4 is **dissolved rather than solved**: neither has a nonce, and neither needs one, because both are served by DEFERRED. |

**Why a WS-issued nonce rather than the proposal's "secret in the served HTML".**
Same security property (a cross-origin page cannot read either), but: the WS
channel already exists and is already gated (single-use `ws-ticket` + origin
trust); it needs no HTML templating, which would otherwise have to thread through
`@fastify/static` + `preCompressed` siblings + the Vite dev proxy; it rotates
naturally per connection instead of per boot; and it **solves the cross-origin
shell case the proposal flagged as the known cost** — `pi-dashboard.dev` connects
the same WebSocket, so it gets a nonce with no separate delivery path.

**Alternatives considered.** (a) Per-boot secret in HTML — rejected above on
cost, not on security. (b) Origin/`Sec-Fetch` heuristics — the four defeats. (c)
A signed token derived from the OAuth session — reintroduces defeat #2 (absent
for the primary loopback-auth-off audience).

### D1a — Correction: the nonce alone proves "admitted origin **or** local process"

An adversarial review defeated D1 as originally written, and the defeat was
confirmed against source rather than accepted on assertion:

- `cors-origin.ts:192` — `isOriginAdmitted` returns `true` when `Origin` is
  **absent**, deliberately, so that non-browser local clients keep working. The
  comment says so explicitly.
- `auth-plugin.ts:296` — `if (isGenuinelyLocal(request.ip, ...)) return;` skips
  the credential check for loopback callers.

So a local process could mint a ticket, open the browser WebSocket with no
`Origin`, and be issued a prompt capability. D1's claim to prove *"the operator's
own client"* was false, and D13's stated honest cost (*"a local CLI gains nothing
from YOLO"*) was exactly backwards: such a process gained automatic filesystem
allow.

**Correction.** Capability *issuance* is now gated on browser-shaped provenance:
a **non-absent** admitted `Origin`, a `Sec-Fetch-Site` consistent with a page
this server served, and the credential tier the UI itself requires. An absent
`Origin` no longer qualifies.

**What this does and does not buy — stated plainly.** These are **provenance
signals, not an authentication boundary**. A process on the same machine can
forge headers, so this does not exclude a determined local attacker. Two things
bound that residual:

1. A local process running as **the operator's own user** needs no escalation —
   it can read the files directly, without the dashboard. Nothing is gained.
2. The case that *is* an escalation is a **different-user or sandboxed** local
   process, since `isGenuinelyLocal` is address-based and treats any loopback
   caller as local. That is a real residual gap, it is named here rather than
   discovered later, and it is routed to `security-hardening` in the task gate.

This is why the earlier "defeated" list still stands: `Sec-Fetch` shape *alone*
was defeated, and it is not being used alone — it gates issuance of a
per-connection secret, it does not replace it.

### D2 — DNS rebinding is out of D1's reach, so **prompting at all** requires `hostGate.mode === "enforce"`

**Decision.** D1 alone does **not** beat rebinding: an `attacker.com` rebound to
`127.0.0.1` is same-origin with the dashboard, so it can open the WebSocket and
be issued a nonce. Only Host validation stops that. Therefore
**prompt-eligibility on every plane requires `hostGate` in `enforce` mode**; in
`report` mode (the shipped default) every plane degrades to **record-only**.

**Why the precondition covers prompting and not merely suspension.** An earlier
spelling gated only *suspension* on `enforce`, leaving `report`-mode denials to
prompt as DEFERRED. That was defeated against source: in `report` mode
`isSameOriginByHost` short-circuits to `true` without consulting
`isHostAdmitted` (`cors-origin.ts:181`), and with no auth secret the browser WS
upgrade admits any genuinely-local peer with no ticket and no credential
(`server.ts:2934-2946`). A rebound page therefore satisfies every D1a issuance
signal, is issued a capability, and raises a real dialog. The hold is not the
prize — the **persisted grant** is, and because the page is same-origin by
rebinding it can read the retry that grant enables. The proposal's DEFERRED
safety claim (*"it learns nothing except that a later retry works"*) is false
against a rebound same-origin reader, so the precondition has to sit above the
whole prompt path.

**Is this defeat #2/#3's mistake — delegating eligibility to a foreign policy?**
No, and the distinction is the point. Attempts 2 and 3 borrowed policies tuned
for *other questions* (is this caller authenticated; may this origin read a
response) and hoped they answered *this* one. `host-admission` is tuned for
exactly one question — *is this `Host` one we serve* — and anti-rebinding is its
stated reason for existing (issue #637). It is also used as a **precondition**,
never as the affirmative grant: a request with an admitted Host but no nonce is
still ineligible.

**Consequence, stated plainly.** Most installs ship `report`, so most installs
get **no prompts at all** at first — every plane, filesystem included, is
record-only and the Access surface is the whole product. That is a large,
deliberate product cost and is not papered over: the Access tab SHALL state
*"prompting unavailable — hostGate mode is `report`"* with a link to the
setting, so the degradation is visible rather than silent, and the prompting
toggle SHALL render inert rather than hidden for the same reason. Auto-enabling
`enforce` is rejected: it can lock an operator out of their own deployment, and
this change must not be able to do that. The install-wide default flips when
`harden-server-request-surfaces` lands (D2b); this change gains prompting
automatically at that point and re-decides nothing.

### D3 — Two settlement modes, with an explicit degrade ladder

HELD and DEFERRED are as specified in `proposal.md — Two settlement modes`. The
ladder is one-way: **HELD → DEFERRED → record-only**.

- `hostGate` not `enforce` (D2) → **record-only**, on every plane, skipping
  DEFERRED entirely. This rung is evaluated first.
- not eligible (D1) on a HELD plane → DEFERRED
- prompting disabled, no audience, registry at capacity, or rate-limited →
  record-only (the denial lands in the pending list; no prompt)

**Accepted residual (D3-R1).** In `enforce` mode, an *ineligible* HELD-plane
denial still degrades to DEFERRED, and a DEFERRED prompt requires no
request-borne proof (D2a) — so a request that carries no capability can still
cause a modal to appear. D1's defeat-#1 row must therefore be read as *"no
nonce ⇒ no **held** dialog"*, not *"no dialog"*. This is accepted rather than
closed: the requester must already have passed Host admission under `enforce`,
it is never suspended, and the alternative — record-only for every
proof-less denial — would also silence the natively-deferred planes
(network, CORS, pairing), where prompting the operator is the only remedy the
untrusted requester can ever have. The dialog's plane-appropriate copy and the
anti-habituation rules (D12) are the compensating controls, and the flooding
layers (D9) bound the denial-of-attention cost.

Every rung returns today's denial. No rung can produce an allow. Merging the two
modes into a single "always hold" was rejected: a held request costs a connection
and a remote untrusted peer must never be able to pin one.

### D4 — One registry, keyed `(plane, subject)`, modelled on `ResyncRequesterRegistry`

`packages/server/src/access/pending-grant-registry.ts` — `record` / `take` /
`forget`, TTL, bounded, take-once, first-response-wins. A HELD entry additionally
holds a continuation (`resolve`/`reject` of the suspended handler); a DEFERRED
entry holds none, which is the only structural difference.

Keying: **`(plane, subject)`**, never the bare subject. A bare-path key would let
an unknown-`cwd` denial coalesce with a path-grant denial and apply the wrong
remedy; across planes a network subject could collide with a filesystem one.
Subject normalisation is the plane's job (D5) — filesystem normalises to
`realpath`, matching the parent change's grant-store subject so a verdict and its
grant cannot disagree.

Capacity is a hard cap with **fail-closed overflow**: at capacity, a new denial
is recorded but does not prompt.

### D5 — A plane registration seam

```ts
interface AccessPlane<S> {
  readonly id: string;                       // "filesystem" | "cwd" | "network" | "cors" | ...
  readonly mode: "held" | "deferred";        // ceiling, not a guarantee — D3 may degrade
  subjectOf(denial: DenialContext): S | null;   // null ⇒ not promptable
  keyOf(subject: S): string;                    // normalised, stable
  describe(subject: S): GrantPromptCopy;        // dialog title/body/verdict labels
  grant(subject: S, scope: GrantScope): Promise<void>;   // writes THIS plane's store
}
```

Planes registered by this change are exactly those the parent change made
grantable. `grant` delegates to the parent change's stores — this change adds no
store of its own, so there is nothing new to revoke and nothing new to migrate.
`mode` is a per-plane ceiling: declaring `"held"` never bypasses D1/D2.

### D6 — Eligibility is evaluated at the denial sites, never inferred later

The universal network guard's single `onRequest` denial point and the containment
sites pass a `DenialContext` to the registry. Eligibility is computed **there**,
with the live request in hand. Nothing downstream re-derives it from stored
fields — a stored "was eligible" flag is exactly the kind of thing that survives
a refactor after the fact that produced it has changed.

### D7 — Transport for a HELD request

Reuse `git-routes.ts:470-478` verbatim in shape: capture `socket.timeout`,
`socket.setTimeout(0)`, restore on `reply.raw.once("finish")` behind
`!socket.destroyed`. The hold is additionally bounded by the registry TTL and by
`request.raw.once("close")` → `forget` + deny, so a client abort never leaks an
entry or a socket.

### D8 — First-response-wins, and the losers are told

The dialog is broadcast to every connected browser socket (the operator may have
several). The first well-formed `grant_response` settles the entry via take-once;
every other socket receives `grant_dismiss` carrying the outcome, so a stale
modal disappears instead of being clicked into a second verdict. A duplicate or
malformed response after settlement is ignored and counted.

### D9 — Prompt flooding is a first-class control, not a nicety

Generalizing to every plane makes denial-of-attention the realistic attack even
when no grant is ever obtained. Three layers: per-`(plane, subject)` **backoff
after settlement** (a polling client must not re-prompt on every poll — a
`Deny` is remembered for a backoff window); a per-plane rate limit; and a global
concurrent-prompt cap. Exhausting any layer degrades to record-only (D3), never
to auto-allow. This reuses the ring buffer's existing dedupe and IP cap rather
than adding a parallel mechanism.

### D10 — Off by default, with a kill switch, and prompt-free parity

A setting (default **off**) plus `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1`. Both
suppress *prompting only*: existing grants stay in force, and denials still land
in the pending list. The no-audience rule is necessary but not sufficient for
automation — **Playwright E2E runs with a browser connected**, so the env var is
the thing CI relies on.

### D11 — Observability

Every transition (`recorded`, `prompted`, `degraded:<reason>`, `settled:<verdict>`,
`expired`, `aborted`, `flooded`) is logged with plane, normalised subject, mode,
and the degrade reason. A verdict that produced a grant records which store it
wrote. Without this, a HELD request that quietly degraded to DEFERRED is
indistinguishable from one that was never eligible.

### D2b — The reporting-mode default is a sibling change's job, not this one's

An obvious reading of D2 is that this change should flip the Host-admission
default so its headline capability works out of the box. It should not:
`harden-server-request-surfaces` already owns that flip, with a migration story
this change has no business re-deciding — the default moves in
`parseHostGateMode`, an **absent** value resolves to `enforce` while an
**unrecognised** one stays `report` so a typo cannot lock an operator out, the
opt-out is preserved, and it is marked BREAKING for anyone reaching the dashboard
through a non-admissible hostname.

**This change therefore assumes neither value and must be correct under both.**
That is exactly what the degrade ladder already provides, and it is why D13a
matters: with the ladder honoured, this change ships useful behaviour on a
reporting-mode install today, and silently gains suspension on the day the
sibling change lands — with no requirement here needing to be rewritten.

**Sequencing.** Neither change blocks the other. If `harden-server-request-surfaces`
lands first, most installs get HELD from the start and the "held prompts
unavailable" banner becomes a rarity rather than the norm. If this change lands
first, it is correct and useful on the shipped default. The only thing that would
be wrong is *assuming* one ordering, which is why no requirement here names a
default — they name the **live resolved mode**.

### D2a — Correction: what the capability authorises differs by settlement mode

The proposal said eligibility was per-plane; the spec said it was unconditional.
Both cannot hold, and each alone is wrong: unconditional kills every network,
CORS, auth and pairing dialog (no untrusted requester will ever hold a
capability), while per-plane-with-no-proof lets an unauthenticated remote peer
put a modal on the operator's screen.

**Resolution — the proof differs because the question differs.**

- **Held planes** ask *"may this request be suspended and resumed?"* Only the
  request itself can answer, so it must carry the capability. Suspension spends
  server resources for the requester and returns real data to it.
- **Deferred planes** ask *"may the operator be told about this?"* The requester
  is untrusted by definition and will never hold a capability, so the authority
  to prompt comes from **the operator's own live channel**, never from the
  request. The requester gains no *inbound surface* and no *information*: it is
  still denied, and the verdict tells it nothing a retry would not have. On an
  `allow-always` verdict it does gain exactly the access the operator
  deliberately granted — that is the feature, not a leak, and it is why D2
  refuses to let a prompt happen at all while Host admission is unenforced.

Because a deferred prompt is raised on behalf of a requester that did not earn
it, deferred planes are subject to the volume controls without exception, and a
plane may declare that a class of denial never prompts at all.

### D13 — YOLO is an auto-answer at the prompt point, not a bypass anywhere else

**Decision.** YOLO substitutes an automatic `allow-once` verdict **at the exact
point a dialog would have been raised** — after eligibility (D1), after every
containment layer, after the forbidden-subject filter. It is not a branch that
skips the guard, and it cannot become one: an implementation that short-circuits
earlier would have to bypass code that YOLO never touches.

Three properties make it defensible rather than a hole:

1. **Plane-scoped structurally, not by configuration.** YOLO-eligibility is a
   field on the plane registration (D5), and a plane whose `mode` is `deferred`
   cannot declare itself eligible. So network / CORS / auth / pairing are
   unreachable by YOLO *by type*, not by a check someone can invert later. This
   matters because the naive version of this feature is one boolean consulted in
   the registry, which would auto-trust unknown remote peers on day one.
2. **It requires prompt-eligibility.** YOLO answers only what could have been
   asked. A drive-by page holds no prompt capability, so it is denied while YOLO
   is on exactly as when it is off. The honest cost: a local `curl` or CLI client
   holds no capability either and gains nothing — stated in the spec rather than
   discovered later.
3. **Allow-once, never allow-always.** YOLO persists nothing, so there is no
   residue to forget to revoke and the admitted set snaps back on expiry. This is
   the whole point: the failure mode YOLO exists to prevent is a habituated
   `Allow always`, so YOLO producing persisted grants would cause exactly what it
   is meant to avoid, only faster.

**Scope is a second axis, and it is the one operators actually mean.** YOLO is
bounded on two axes: *plane* (which guards it can answer for) and *place* (where
it applies). The plane axis is fixed by type; the place axis is chosen at
activation, as either a root directory or an explicit unscoped session. "Stop
asking about files" almost always means *in this repo*, not *on this disk*, and
the global-only version silently also covers `~/Downloads`, `/tmp`, and every
other concurrently running session's workspace.

The roots on offer are **the existing ancestor ladder**, not a new computation:
real-path derived, truncated at the git checkout root (inclusive) or the home
directory / mount point (exclusive), with the forbidden-subject filter applied
per rung. Reusing it means there is exactly one definition of "a directory the
operator may widen to" in the system, and no free-text path entry anywhere.
Activation from a prompt uses that denial's ladder; activation from Settings
computes one from the session `cwd` by the same rule.

**A session holds a set of roots, and the set never becomes "everywhere."** Real
work spans a repo plus a scratch directory plus a fixture tree, so one root would
push operators toward unscoped for a reason that has nothing to do with wanting
unscoped. Roots may therefore be added to a live session — but adding one
**never extends the expiry** (otherwise the session renews itself through use,
the exact failure the fixed timer exists to prevent) and **never promotes to
unscoped**. There is deliberately no threshold at which N roots collapse into a
global session: a union of ten named directories is still a union of ten named
directories, and auto-widening would convert a series of small decisions into one
large one nobody made.

**Scope defaults to the session `cwd`, not to global.** Not choosing is the most
common path, so what it yields is the de-facto policy. Defaulting to the working
directory means inattention produces the narrow session; unscoped requires
someone to say so. Unscoped is offered but never pre-selected, and is rendered
distinctly while active — the difference between the two is the whole reason the
choice exists.

**The planes YOLO cannot reach are the planes with nowhere to scope to.** A
network source, an origin, and a paired device have no directory; their guards
stay global exactly as today. Directory scope is meaningful only on the two
planes whose subject *is* a path — which is why the place-axis and the plane-axis
partition the same way rather than by coincidence.
An environment-supplied root that is forbidden or unresolvable leaves YOLO
**inactive** rather than falling back to unscoped: a typo in a container env var
must not silently upgrade the blast radius from one directory to the filesystem.
With multiple roots the same rule holds per-root and fails the whole activation —
activating on the subset that happened to resolve would mean a typo silently
changes *which* directories are open, which is a quieter version of the same bug.

**Where it lives: three entry points, one state.** The Access settings page holds
the full control; the grant dialog holds an inline "stop asking for a while"; the
directory settings page holds a pre-scoped "in this folder". The dialog one is
the load-bearing one — it is the only surface present at the moment someone
actually wants YOLO, and without it the realistic path from *annoyed* to *relief*
is clicking `Allow always`, which is the outcome this entire change exists to
prevent. It is deliberately **not** a fourth verdict button: the denial in hand
still gets an explicit answer, so "stop asking" never doubles as a silent allow.

The directory page pre-fills a root; it does **not** introduce per-directory YOLO
state. One session, one store, three ways in — otherwise "is YOLO on?" becomes a
question with several answers.

**Indicator placement — sidebar header, with the mobile gap named.** The
indicator rides three surfaces: a compact pill in the **sidebar header's
app-level control row**, the session surfaces in scope, and the Access page.

The sidebar row is chosen because it already carries exactly this class of
signal — `specs/sidebar-header` puts `TunnelButton` there, the repo's existing
"something is exposed right now" affordance. A YOLO pill beside it reads as the
same kind of fact and costs no new pattern.

The **app-root banner stack** (`App.tsx`, alongside `ConnectionStatusBanner` /
`PluginStalenessBanner` / `InstallBanner`) was the alternative and was not taken.
Its advantage is that it survives a collapsed sidebar; its cost is permanent
vertical space on every route, against a shell already bounded to the viewport on
mobile.

**The accepted gap, stated plainly: on mobile the sidebar collapses, so the pill
is not visible — and a forgotten YOLO session is most likely exactly there.**
This is why the session-surface indicator is specified as a peer rather than a
fallback: the sidebar is not permitted to be the only place YOLO is visible. What
further bounds the exposure is that a session is time-boxed, persists nothing,
and logs every auto-allow. Promoting to the app-root banner stack remains a
purely additive follow-up if mobile blindness proves uncomfortable.

**D13a — Correction: YOLO requires `enforce`; it has no degraded-plane behaviour.**
As first written, YOLO was incoherent on the default configuration. `hostGate`
ships `report` (`config.ts:1086`), so under D2 nothing on YOLO's two planes can
prompt at all, and *"the original request SHALL proceed"* had nothing to
proceed. The feature was either dead on every default install or it was the one
rung that produces an allow the fail-closed ladder refused.

YOLO now answers **the prompt and only the prompt**, and inherits whatever the
ladder decided about the request. An earlier spelling tried to rescue YOLO on a
`report`-mode install by letting the automatic verdict *"apply to the next
attempt"*. That was defeated: it contradicts the registry's `allow-once`
requirement (*"SHALL permit only the suspended request that raised it"*), and it
handed YOLO a privilege the operator's own click does not have, since D12 offers
no allow-once on a deferred plane. A verdict that outlives its originating
request is an unbound floating allow keyed on `(plane, subject)`.

**Resolution.** YOLO is available exactly when `hostGate.mode === "enforce"` and
the denial is HELD-eligible. There is **no degraded-plane YOLO**: on a
`report`-mode install YOLO is unavailable, its controls render inert carrying the
same reason string the Access tab shows, and an env-activated session does not
start. This is a smaller feature than the original sketch, and it is the only
version that does not smuggle an allow past the fail-closed ladder.

The proof requirement follows the same rule: an auto-allow requires **exactly
what the prompt would have required**, no more and no less. Degradation changes
what happens to the request; it does not lower the bar for answering.

**Expiry does not renew on activity.** A sliding window would keep a forgotten
session alive all day precisely because it is being used. Env activation is the
deliberate exception — a container has no operator to re-arm it, so it lasts the
process lifetime.

**Interaction with the prompt kill switch.** They are orthogonal and both may be
set: `PI_DASHBOARD_DISABLE_GRANT_PROMPT` means *do not ask*, YOLO means *the
answer is yes*. Together, on YOLO-eligible planes, denials are auto-allowed
silently. That is the container case working as intended, and it is why every
auto-allow is logged and listed.

**An automatic verdict never overrides an explicit one.** A subject the operator
deliberately denied is not auto-allowed by a later YOLO session, even inside a
root in scope. Silently reversing a refusal nobody re-examined is worse than the
habituated `Allow always` YOLO exists to prevent, because no click occurs at all.

**Rejected.** (a00) Collapsing an accumulating root set into a global session —
see above; it launders many small choices into one unmade large one. (a0) A
scope-free, global-only YOLO — it conflates "this repo" with
"this disk" and is what makes the mode indefensible over a tunnel. (a) A global
all-planes YOLO — it hands the server to any remote
peer that finds it, which is the confused-deputy outcome this change exists to
prevent, reached through the front door. (b) Auto-persisting grants — see (3).
(c) Refusing to enable YOLO when a tunnel is connected — considered and not
taken; the indicator plus the auto-allow ledger carry that risk instead.

### D12 — UI surfaces reuse the shipped dialog shell

Mockups: `mockups/index.html` (served locally; dark + light). Plan and token map:
`mockups/ui-plan.md`.

The prompt is `client-utils`' `Dialog` at `size="md"`, non-flush — it therefore
inherits the `bg-black/60` backdrop, `z-dialog`, focus trap, `aria-modal`, the
shared escape-stack dismissal, and the built-in ✕ without new code. Verdicts are
`Dialog.Action` and `Dialog.Cancel` for *Deny*. No new button or overlay
primitive is introduced.

**Verdict emphasis.** Both *Allow once* and *Allow always* take
`intent="neutral"`. An earlier spelling gave *Allow always* `primary`, making the
widest, persistent verdict the visually emphasised one — directly against the
anti-habituation goal this change exists to serve. `intent` is purely visual in
`client-utils/Dialog.tsx` (`INTENT_CLASS`; the shell sets no autofocus), so this
is emphasis only, but emphasis is the mechanism under discussion.

Three UX rules are load-bearing rather than cosmetic and are specified, not just
drawn: the dialog names **the store an `Allow always` answer will write** before
the buttons; `Allow once` is **absent on deferred planes** rather than disabled
(there is nothing in flight to allow once, and a disabled control would imply
otherwise), so a deferred dialog offers **exactly two** answers — *Allow always*
and *Deny*; and no verdict is pre-selected or focus-defaulted.

## Risks / Trade-offs

- **Default `report` mode means no prompts at all for most installs (D2)** →
  made visible in the Access tab with the reason and the setting link; the
  Access surface still delivers the full review-and-grant loop, and prompting
  arrives for free when `harden-server-request-surfaces` flips the default
  (D2b). This is the largest product cost in the change, accepted deliberately:
  prompting under unenforced Host admission is exploitable by a rebound page.
- **A proof-less denial can still raise a deferred dialog in `enforce` mode
  (D3-R1)** → accepted residual; bounded by Host admission, the flooding layers
  (D9), and the anti-habituation rules (D12). It never suspends a request.
- **The nonce is a bearer secret inside the browser** → memory-only, never
  persisted, rotated per connection, scoped to *raising a prompt* (it grants
  nothing on its own; the operator still has to click). Same-origin script that
  could steal it can already call the API directly.
- **A held request occupies a connection (D7)** → HELD is gated by D1+D2, capped
  by the registry, TTL-bounded, and released on client abort.
- **Cross-plane subject collision** → `(plane, subject)` keying (D4), with
  plane-owned normalisation.
- **Prompt fatigue habituating "Allow always"** → D9 limits volume; the dialog
  defaults to the least-privilege verdict and never pre-selects `Allow always`;
  plane-specific copy (D5) names the exact subject and the store that will be
  written.
- **Two modes are more surface than one** → accepted: one mode would either hold
  requests for untrusted remote peers or deny local users the thing that makes
  the feature feel like an answer.

## Migration Plan

Additive and behind a default-off setting; the empty-registry, prompting-off
state is byte-identical to the parent change's behaviour. Rollback is the
setting or the env var. One piece of persisted state **does** belong to this
change: the **remembered-refusal ledger** that stops a later YOLO session from
reversing an explicit `Deny` (`access-grant-yolo`). It is durable across restart
and is listed and clearable on the Access surface like any other recorded
decision. Rollback therefore also means: the ledger stops being consulted and
may be cleared from that surface; it grants nothing on its own, so leaving it in
place is fail-safe. Every other store a verdict writes belongs to the parent
change (D5) and is unwound there. Ships after `add-access-grants-and-review`, which itself
ships after `add-universal-network-guard`.

## Open Questions

- Which per-plane rate-limit numbers (D9) to ship as defaults. Deferrable: the
  layers and their degrade behaviour are specified; only the constants are open,
  and changing a constant changes no spec, approach, or task.
