# Design — Access grants and review surface

## Context

Every access guard in the dashboard denies terminally. The one exception — the
network plane's `403 network_not_allowed` → `NetworkNotAllowedError` → remedy
surface → "Trust this network" banner → `config.trustedNetworks` — proves the
loop works and has never been generalized.

Current state, verified against source:

- **`isAllowed(resolved, { anchors })`** (`lib/path-containment.ts:106`) is the
  containment predicate used at 7 sites in `file-routes.ts` plus `grep-routes.ts`
  and `resolve-file-mention.ts`. Anchors are **not** purely derived:
  `homePiAnchor()` (`~/.pi`) is passed at `file-routes.ts:348,744,899` and the
  pinned directories at `:659`. Critically, `isAllowed` runs a **git-common-root
  widening pass over every anchor it is given** — so it is not a safe injection
  point for grants (D1).
- **`resolved` is lexical** — `path.resolve(...)`, symlink-unresolved, at every
  call site.
- **`BlockEventBuffer`** (`tunnel/tunnel-block-events.ts`) is a hardened denial
  ledger: socket-peer IP only (never `X-Forwarded-For`), dedupe by IP, cap 50,
  `trustable:false` for loopback/proxy-terminated peers, advisory-only.
- **`git-worktree/worktree-init-trust.ts`** stores a flat `Record<string, true>`
  keyed `repoRoot\0hash`, and already implements a
  `TrustScope = "session" | "project"` split with an in-memory `sessionTrust`
  Set — the closest in-repo precedent for scoping a grant. It exposes
  `isTrusted`/`recordTrust` and **no revoke**.
- **`kb/src/trust.ts`** is `sha256 → true`; the subject is unrecoverable from the
  store. Its only `promptTrust` caller is `kb/src/cli.ts`, gated on
  `process.stdin.isTTY`.
- **`auth.bypassHosts`** is merged with `trustedNetworks` at `auth-plugin.ts:138`
  and is named the canonical UI write path by the `trusted-networks` spec — a
  distinct store from `config.trustedNetworks`.

> **Provenance.** This change was split out of a larger one that also proposed a
> blocking grant dialog. Three adversarial review cycles (single-model plus
> cross-model) ran against that artifact. Every decision below survived them; the
> dialog's eligibility question did not, and was carved into
> `add-access-grant-dialog`. The corrections those cycles forced are recorded
> inline rather than quietly folded in.

## Goals / Non-Goals

**Goals:**

- The filesystem plane gains a grant mechanism it has never had.
- A denial names the remedy that would unblock it.
- Every grant in the system is reviewable and revocable from one place.
- No gate's default-deny behaviour changes.
- With an empty grant store, behaviour is byte-identical to today.

**Non-Goals:**

- **Asking at the moment of denial.** That is `add-access-grant-dialog`. Nothing
  here suspends or holds open a request.
- Migrating the existing trust stores into one file. The Access tab reads them
  where they live.
- **Rewiring `kb/src/trust.ts`'s prompt.** Its only `promptTrust` caller is the
  CLI, gated on a TTY that a dashboard session (a PTY) actually has. The original
  justification for touching it was false.
- `tool_call`-level approval. Agent file access is gated by pi's project-trust.

## Decisions

### D1 — Grants are a subtree check, NOT an extra `isAllowed` anchor

This is the decision that carries the security weight. `isAllowed` loops
`gitRoot(anchor)` over **every** anchor it receives (`path-containment.ts:106-125`)
and admits anything under that anchor's git common root. Appending a grant for
`…/repo/sub` would therefore admit all of `…/repo` — the UI would say one thing
and the system would do another, silently.

Grants are instead evaluated by a **dedicated subtree predicate** applied *after*
`isAllowed` returns false.

The predicate **must still resolve symlinks**. Layer 2 realpaths precisely so a
symlink whose target escapes the boundary is refused; a grant check that compared
lexically would reintroduce that escape inside granted directories. So the check
is `within(realpath(resolved), realpath(grant))` — realpath yes, git widening no.

*Corrected twice during review:* the first draft called `isAllowed` "a clean
seam" for injecting anchors (it is a widening seam); the fix then specified
"plain `within()` only, no realpath", which closed the widening hole by opening a
symlink one.

Consequences:

- `isAllowed`'s semantics and its existing per-site anchor sets (including
  `homePiAnchor()` and the pinned-directory anchor) are **untouched**, so the
  existing `file-read-containment` suite must pass unchanged.
- What the UI names is exactly what is granted.

### D2 — The subject is stored as a real path, not a lexical one

`resolved` at every call site is lexical. If the grant subject were stored
lexically, granting a symlinked directory (`/wt/current`, a worktree pointer)
would bind the grant to the *link*, and the admitted set would silently follow
wherever that link was later repointed — with no new approval.

So the subject is `realpath`'d at grant time, and that value is what is persisted
and displayed. A grant is bound to the directory the operator actually saw.

### D3 — Grant scope reuses the `"session" | "project"` precedent

`worktree-init-trust.ts` already implements exactly this split, with an in-memory
`sessionTrust` Set for the ephemeral case. Reusing the shape avoids inventing a
second vocabulary for the same idea.

### D4 — The store is richer than `worktree-init-trust.json`, deliberately

*Correction:* an earlier draft claimed the new store "mirrors the shape already
used by `worktree-init-trust.json`". It does not — that store is a flat
`Record<string, true>` keyed `repoRoot\0hash` with no subject, time, or origin.
The Access tab must display all three, so this store is necessarily richer. What
it borrows from that file is the scope split (D3), not the record shape.

### D5 — Network / CORS / auth planes get request→accept, never a request to ask

The requester on those planes is untrusted by definition, so asking *it* for
permission is not a gate. Once `add-universal-network-guard` lands, a new device
is denied at the ws-ticket mint endpoint and never opens a WebSocket — it has no
channel to ask over at all.

**The 403 is the request.** The denial is recorded in the ledger; a trusted
client sees the pending entry and accepts; the denied client's next retry
succeeds. No inbound message from an untrusted origin, so no new attack surface.

*Alternative rejected:* a "request access" button posting to a public endpoint —
an unauthenticated write reachable from any origin, exactly the poisoning vector
`BlockEventBuffer`'s threat model was designed to avoid.

### D6 — The Access tab reads the existing stores; it does not migrate them

**Eight** stores are in scope: `worktree-init-trust.json`, `kb-source-trust.json`,
the new path-grant store, pi's `ProjectTrustStore`, `config.trustedNetworks`,
`auth.bypassHosts`, `cors.allowedOrigins`, and `preferencesStore` pinned
directories.

The tab presents a **read-and-revoke view over all of them in place**. A
consolidating migration would be a one-way rewrite of security state — including
one store owned by pi, not by us — for a presentation-layer benefit.

Two gaps this forces, both additive:

- `worktree-init-trust.ts` and `kb/src/trust.ts` expose `isTrusted`/`recordTrust`
  and **no revoke**. Each gains one, and revoke must also clear in-memory
  session-scoped trust. "Revoke through the store's existing write path" was
  false as originally written.
- `kb-source-trust.json` is `sha256 → true`; an entry cannot be *displayed*. The
  store gains a subject field alongside the hash. Old entries without it render
  as an opaque hash rather than breaking.

Two further grant-bearing stores are **deliberately excluded**, with rationale
rather than by omission:

- **`paired-devices.json`** — device pairing has its own management surface;
  duplicating it would create two write paths to the same state.
- **`auth.bypassUrls`** (`auth-plugin.ts:304`) — grants *unauthenticated route
  access*, not access to a resource. It belongs to the auth configuration
  surface.

### D7 — Denial bodies gain additive fields only

The bare-string sites gain `reason` and `hint` beside their existing `error`
string, which is left byte-identical. Two shapes must be preserved separately:
the main sites use `{ success, error }`, while `gateFilePath`/`gateOfficeFile`
(`file-routes.ts:193,247`) use `{ code, error }`, and `kb-routes.ts:107` uses a
bare `{ error }`.

Three denial sites are **not** HTTP routes and are excluded: the `plugin_action`
message handlers in `kb-plugin/src/server/index.ts:48` and
`apple-tools/src/server/index.ts:169`, and the internal promise rejection in
`embed-lifecycle/visitor-session-registry.ts:155`. They have no response body to
enrich.

### D8 — What this consumes from `add-universal-network-guard`

- one `onRequest` denial site instead of ~20 per-route `preHandler`s, so the
  ledger has a single instrumentation point;
- guard registered **last**, so `request.isAuthenticated` is settled and the
  ledger entry can record *who* was refused;
- the denial logging (path, source IP, reason) it already commits to;
- the denials themselves — previously-ungated `/api` routes begin refusing over
  LAN/tunnel with auth off, which is the pain this change makes recoverable.

### D9 — No gate is widened by default

The grant store starts empty. With no grants, behaviour is byte-for-byte today's.
Nothing is granted without an explicit human action.

## Risks / Trade-offs

- **A grant silently widening to a whole repo** → D1's dedicated subtree
  predicate. Asserted by a scenario that grants a repo subdirectory and proves a
  sibling directory in the same repo is still refused.
- **A symlink escaping a granted directory** → D1's realpath requirement.
- **A grant following a retargeted symlink** → D2's realpath-at-grant-time.
- **Grant store becomes a silent permanent widening** → D6's Access tab is the
  mitigation and ships in the same change, not after it. A grant nobody can see
  is the failure mode this change exists to end.
- **Ledger poisoning via spoofed source IPs** → inherited unchanged from
  `BlockEventBuffer`'s threat model. The four properties survive mechanically,
  but the buffer changes role from *advisory ledger* to *actionable queue*, so
  cap-50 eviction now silently drops a legitimate pending request under IP churn.
  Accepted: a dropped entry degrades to today's terminal 403, and the denied
  client's retry re-records it.
- **A CORS refusal is not expressible in an IP-keyed `BlockEvent`** → the origin
  is recorded as an additional field; the IP remains the dedupe key.
- **`grep-routes.ts:60` filters matches rather than 403ing** → a granted
  directory would become readable via `/api/file` while still invisible to grep.
  It consumes grants; it never asks.
- **A future containment site forgets the grant check** → it simply 403s as
  today. Degrades to current behaviour, never to an open gate.

## Migration Plan

Additive. No data migration: the new store starts absent and is created on first
grant; the existing stores are read where they live (D6). The two additive fields
— kb subject, grant metadata — are read-optional.

Rollout order: `add-universal-network-guard` → this change → `add-access-grant-dialog`.

Rollback: deleting the grant store (or revoking entries in the Access tab)
returns containment to its current layers. No existing store's format changes
incompatibly.

## Open Questions

- **Does the network plane want an "accept once"?** A time-boxed trust is
  expressible but adds an expiry dimension `trustedNetworks` does not carry.
- **Can the Access tab *add* a grant proactively**, or only review and revoke?
  Without a dialog this matters more than it did: proactive add may be the
  primary way a filesystem grant gets created, alongside a remedy affordance on
  the denial.
- **Should `paired-devices.json` appear as a read-only cross-reference?**
- **Should `resource-activation-toggle` and `git-operations`' `outside_repo`
  gain remedy fields too?** Lower-traffic than the file routes.
- **What happens when a grant write fails?** The TOFU precedent swallows save
  errors, which for a grant would silently lie to the operator.
