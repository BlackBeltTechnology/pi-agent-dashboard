# Design — Access grants and review surface

## Context

Every access guard in the dashboard denies terminally. The one exception — the
network plane's `403 network_not_allowed` → `NetworkNotAllowedError` → remedy
surface → "Trust this network" banner → `config.trustedNetworks` — proves the
loop works and has never been generalized.

Current state, verified against source:

- **`isAllowed(resolved, { anchors })`** (`lib/path-containment.ts:110`, **async**
  since `widen-containment-to-resolved-checkout`) is the containment predicate
  used at 7 sites in `file-routes.ts` plus `grep-routes.ts` and
  `resolve-file-mention.ts`. Anchors are **not** purely derived: `homePiAnchor()`
  (`~/.pi`) is passed at `file-routes.ts:350,746,901` and the pinned directories
  at `:661`. Critically, `isAllowed` runs a **bound-checkout-root widening pass
  over every anchor it is given** (`checkoutAnchors()`, `:85`) — so it is not a
  safe injection point for grants (D1).
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
`checkoutAnchors(anchor)` over **every** anchor it receives
(`path-containment.ts:85-127`) and admits anything under that anchor's bound
checkout roots (`thisCheckout` + `mainCheckout`). Appending a grant for
`…/repo/sub` would therefore admit all of `…/repo` — the UI would say one thing
and the system would do another, silently.

Grants are instead evaluated by a **dedicated subtree predicate** applied *after*
`isAllowed` returns false.

The predicate **must still resolve symlinks**. Layer 2 realpaths precisely so a
symlink whose target escapes the boundary is refused; a grant check that compared
lexically would reintroduce that escape inside granted directories. So the check
is `within(realpath(resolved), storedSubject)` — realpath on the **request side
only**. The grant side is NOT re-resolved at check time: the stored subject is
already a realpath (D2), and re-resolving it would let a symlink swapped in over
the subject (or any ancestor of it) silently migrate the grant — reopening the
exact hole D2 exists to close. Like `isAllowed`, the predicate is `async`.

*Corrected a third time, in planning:* an earlier formula read
`within(realpath(resolved), realpath(grant))`, which contradicted D2.

**Ordering against the existing artifact-root layer.** `GET /api/file/raw`
(`file-routes.ts:724`, `isAllowed` at `:746`) already carries an image-only third admission (`isImageUnderArtifactRoot`,
commented "Layer ③" in source, from `serve-agent-artifact-previews`). The grant
check runs **after** it and is type-agnostic. To avoid colliding with that
numbering, this change refers to its own check as the **grant layer**, never as
"layer 3".

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
- **`auth.bypassUrls`** (`auth-plugin.ts:137,161`; checked via `isBypassed`,
  `:36`) — grants *unauthenticated route
  access*, not access to a resource. It belongs to the auth configuration
  surface.

### D7 — Denial bodies gain additive fields only

The bare-string sites gain `reason` and `hint` — and, at the containment sites,
the grantable `subject` plus the `denialId` of D20's registry entry — beside
their existing `error` string, which is left byte-identical.

*Scope correction from cross-model review (twice):* "the suite passes with zero
edits" was overclaimed, and the first correction undercounted. Strict `toEqual`
denial-body assertions live in **five** test files, not one:
`file-absolute-containment.test.ts` (10 — including the `"unknown cwd"`
assertion, which widens once task 3.1 enriches that site), `file-artifact-serving.test.ts` (7),
`file-kind-endpoint.test.ts` (1), `file-raw-render-endpoints.test.ts` (1),
`resolve-mention-endpoint.test.ts` (1) — 20 assertions. Each must widen. The invariant that actually holds — and
the one worth asserting — is that **no containment outcome changes**: every allow
stays an allow, every refusal stays a refusal with the same status code and the
same `error` string. Those five assertion edits are mechanical and must not touch
a single status code or string.

Per-site rejection strings are NOT uniform: `GET /api/file/exists` rejects with
`"unknown cwd"` and `"path outside cwd"` (`file-routes.ts:657,663`), not the
`"path outside working directory"` the other sites use.

Two of the ten containment sites have **no response body at all** and therefore
cannot carry remedy fields: `grep-routes.ts:60` silently drops non-contained
matches, and `resolve-file-mention.ts:76` returns `null`. They consume grants but
can never originate one — consistent with D12/D15, since a grant must trace to a
denial the operator actually saw.

**Correction — the `{ code, error }` shape never reaches the wire.**
`gateFilePath`/`gateOfficeFile` return `{ code, error }` to their *callers*, and
every caller converts before replying: `reply.code(gate.code); return { success:
false, error: gate.error }` — seven sites: `file-routes.ts:446,858,877,946,987`
plus the two EML callers at `:1021,:1069`. Every containment site that emits a
body at all therefore emits `{ success, error }` on the wire (the two body-less
sites named above emit nothing). "Preserving
the `{ code, error }` body shape" would mean *changing* responses — the opposite
of additive.

The genuinely different wire shapes are on the **cwd-allowlist** sites, not the
containment sites, and the earlier census of those was wrong (see D18).

Three denial sites are **not** HTTP routes and are excluded: the `plugin_action`
message handlers in `kb-plugin/src/server/index.ts:47` and
`apple-tools/src/server/index.ts:113`, and the internal promise rejection in
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

### D10 — The grant store is capped at 200 entries, oldest evicted

*Resolved from a scenario-design clarification (C1).* The store would otherwise
grow unbounded, and every containment miss scans it linearly with a `realpath`
per entry — an operator-visible cold-path cost with no ceiling. The cap is a
fixed 200 with oldest-first eviction, matching the ledger's cap-and-evict shape.

The cap applies **per scope**: persisted project grants evict only other
persisted project grants, and in-memory session grants evict only session grants.
Ties on `grantedAt` (same-millisecond writes) break by insertion order, so
eviction is deterministic.
A union cap ordered by `grantedAt` would let an ephemeral session grant delete a
persisted project grant from disk — a cross-scope destructive interaction nobody
asked for.

*Trade-off accepted:* eviction silently narrows what is admitted. That degrades
toward default-deny (the next read 403s and can be re-granted), never toward an
open gate — the same direction as the ledger's cap-50 eviction.

### D11 — A failed grant write is non-fatal; the grant is simply not recorded

*Resolved from C2, and this closes the `design.md` open question.* When the store
write fails, the operator's action does not persist and the denial will be raised
again on the next request — the TOFU precedent in `kb/src/trust.ts`.

*Trade-off accepted, with two guards:* pure silence would let the UI claim a
grant that does not exist — and "logged server-side" is invisible to an operator
on a tunnel. So (a) the write failure is logged, and (b) **the grant endpoint
reports the failure in its own response**, so the surface that asked can say the
grant did not stick. What is *not* failed is the read request that triggered the
denial; that still 403s exactly as it would have. This fails in the safe
direction — the admitted set never widens on a failed write.

The store write is **atomic** (temp file + rename). Both precedent stores use a
plain `writeFileSync`; a crash mid-write there truncates the file, and this
store's own malformed-degrades-to-empty rule (deliberate) would then silently
discard every project grant.

### D12 — The Access tab reviews and revokes; it never creates a grant

*Resolved from C3, and this closes the `design.md` open question.* A filesystem
grant is created only from the remedy surface attached to an actual denial, so
every grant traces to a concrete refused request the operator saw. A free-form
"add a directory" field in a settings page is a grant with no denial behind it,
and would be the one path by which trust widens without a triggering event.

### D13 — Project trust is listed with revoke routed through a pi API

*Resolved from C4; the "no revoke path exists" premise was then falsified during
cross-model review.* The write path is already wrapped in this repo:
`persistTrustDecision(agentDir, updates)` at `pi/resource-toggle-trust.ts:158`,
used today by `resource-activation-routes.ts:222`. Revoke therefore routes
through that existing wrapper — nothing is written directly against pi's store,
so D6 and the "read in place, never migrated" rule both hold (revoking one entry
through the owner's own API is not a migration).

What still needs confirming is the **delete semantics**, not the existence of an
API. The contract is `TrustUpdate = { path; decision: boolean | null }`
(`resource-toggle-trust.ts:44-47`), and whether `null` deletes the entry or
records a standing negative decision must be verified against pi before wiring.
The module's own decline option deliberately records nothing, precisely to avoid
enrolling a standing refusal — so "revoke" should mean delete.

*If it turns out `null` cannot express deletion*, project trust is listed
read-only and marked managed-by-pi. That is an explicit carve-out from "every
listed grant is revocable", written into the spec as such — the earlier draft
left the spec demanding universal revocability while a task quietly planned a
read-only fallback, which is a contradiction, not a fallback.

### D14 — The grant check closes its TOCTOU window by verifying an open handle

*Resolved from C5; the mechanism was corrected during cross-model review.*
`realpath` resolves at check time and the file is opened afterwards, so a symlink
swapped in between would be read despite the check.

The naive form — "ask the open `fd` for its path" — **is not implementable
portably**: no Node API maps an fd back to a path, `/proc/self/fd` is Linux-only,
and this repo ships macOS + Windows QA. The implementable form is an **identity**
check, not a path check:

1. `lstat` the verified real path and reject anything that is not a regular file
   **before opening**. Load-bearing beyond correctness: opening a FIFO blocks,
   which would hold a request open — forbidden outright by this change's own
   non-goal.
2. `open` the file.
3. `fstat(fd)` and compare `dev` + `ino` against the pre-open `lstat`. A mismatch
   means the path was substituted between check and open — close the handle and
   refuse.
4. Serve from the verified `fd`, never by re-opening the path.

**Scope: byte-serving read sites only** (`GET /api/file` read, `raw`, `render`,
and the EML parse/attachment gates, which this change routes through the verified
handle). The rule as first written would have broken the other
sites outright: `tree` admits a *directory* and calls `readdir` with no open at
all, `exists` calls `fs.access`, the mention resolver calls `stat`, grep opens
inside a `ripgrep` subprocess, and the office/PDF path hands a path to an
external engine. Those sites keep path-based grant checking only, and carry the
same pre-existing window as layer 2.

The **office gate belongs to that second group even though it shares a route
family with EML.** `file-routes.ts` runs `assertRegularFile(resolved)` on it — so
a FIFO, or a symlink, is refused before anything is spawned — and then hands the
**pathname** to an out-of-process renderer. It never performs
`open → fstat → serve from fd`, so it has no handle binding and is not claimed to
have one. Binding it would require the external renderer to consume a descriptor,
which its interface does not accept. The first draft of this decision was
ambiguous on exactly this point, listing the office gates both as in scope and as
path-based-only; corrected in task 4.5 round 2 (B3), as was the matching claim in
`verified-read.ts`.

Note this is deliberately *stricter than layer 2*, which carries the identical
window today. Closing it there is out of scope — a pre-existing gap, untouched
by this change and not widened by it. The asymmetry is intentional: the grant
layer is the one admitting paths outside every derived anchor, so it earns the
stronger check.

*Residual risk, accepted:* `dev`/`ino` identity is weaker on Windows than on
POSIX. The check degrades there to the same window layer 2 already has — never
worse than today.

*Residual risk, accepted (POSIX too):* the identity check binds the **final
component only**, so the window is *narrowed*, not *closed*. If an INTERMEDIATE
directory is replaced by a symlink between containment and the `lstat`, then
`lstat` and `open` both follow the escape and arrive at the same inode — they
agree, and the substituted file is served. Steps 1–3 catch substitution of the
last component; they cannot catch substitution of a parent, because both syscalls
resolve the same pathname.

The real close is a descriptor-relative component walk (`openat` with
`O_NOFOLLOW` per component, from a trusted root). It is deliberately not taken:
it is not portable to Windows, which this repo ships QA for, and layers ①/② carry
the identical window today, so the ordering is a narrowing of an existing gap
rather than a new one. Stated here because "verifies an open handle" reads as
*closed*, and a reader who believes the window is closed will not re-examine it.
See `verified-read.ts`, whose header states the same limit.

### D18 — Corrected census of the cwd-allowlist denial sites

*The original census was wrong on three counts; verified against source during
the second review cycle.*

- **`goal-routes.ts` does not exist** — but the goal routes' cwd denial does.
  The site is `packages/goal-plugin/src/server/routes.ts`, whose
  `rejectInvalidCwd` helper (`:80`) refuses
  `{ success: false, error: "cwd not allowed" }` at six call sites
  (`:165,:184,:236,:316,:346,:399`). The original citation was wrong about the
  path, not about the site; it stays in scope.
- `"unknown cwd"` appears **once** in the repo — `file-routes.ts:647` (not
  `:645`), shape `{ success, error }` — the single occurrence in the repo.
- `openspec-group-routes.ts:56` refuses with
  `{ success: false, error: "cwd not allowed" }`.
- `kb-plugin/src/server/kb-routes.ts` refuses through a `rejectCwd` helper at
  four call sites (`:175,:207,:224,:232`) with a **bare** `{ error: "cwd not
  allowed" }`.
- `mcp-client-plugin/src/server/routes.ts:131,:163` refuses with a **fourth**
  shape, `{ error: "not-allowed", message }` — previously unmentioned entirely.

Non-HTTP sites, excluded as before but re-cited correctly: the `plugin_action`
handler in `apple-tools/src/server/index.ts` is at `:113` (the file is 156 lines;
the cited `:169` was past EOF), `kb-plugin/src/server/index.ts:47`, and
`embed-lifecycle/visitor-session-registry.ts:155`.

### D19 — The tenth containment site, and what the "nine sites" census excludes

`session-routes.ts:350` (not `:146`) contains a tenth containment refusal, with
its own string `"path outside session directory"`. It is **in scope** and the
`file-read-containment` delta covers it explicitly rather than leaving a task to
assert a requirement that does not exist.

`openspec-routes.ts:541` performs its own local lexical containment check against
`knownCwds` plus pinned directories. It is **out of scope**: grants do not apply
there, and it is named here so the census is not mistaken for exhaustive.

Related coupling, previously unstated: pinned directories feed that route's
`knownCwds` set, so the pinned-directory remedy (which this change makes
reachable from a denial) also widens what `openspec-routes.ts` will read. That is
pre-existing behaviour of pinning, not new behaviour of granting — but an
operator accepting a pin from a file-denial should be told what else pinning
admits.

### D15 — A grant may only name a subject that a recorded denial actually named

*Added after cross-model review.* D12 removes the settings-page add field, but
nothing else constrained what a grant request could name. Three gaps followed:

- **Binding.** A grant request SHALL carry the identifier of a recorded denial,
  and the granted subject SHALL be the subject that denial named. An arbitrary
  directory cannot be grafted onto the grant path.
- **Forbidden subjects.** `/`, the user's home directory, `~/.ssh`, and `~/.pi`
  itself are refused as grant subjects regardless of the denial — one reflexive
  click should not be able to grant the entire filesystem.
- **Reachability.** The grant endpoint requires authentication and SHALL NOT be
  invocable cross-origin. A loopback-trusted server treats a drive-by page in the
  operator's own browser as loopback, so "only reachable from localhost" is not
  by itself a defence.

This mirrors the hardening `tunnel-block-events.ts` already applies to its own
one-click trust action, whose header states plainly that the Trust button *is*
the attack surface.

**Limit, stated rather than overclaimed (second review cycle).** "Enforced
server-side" holds against *remote and cross-origin* callers only. It does **not**
hold against a local process: `auth-plugin.ts:298` returns early for a genuinely
local request inside the auth hook itself, so any local caller —
including an agent's own `bash` tool — can read a 403, learn the subject it
names, and satisfy the denial binding itself. The binding constrains parties who
cannot see the denial body; it is not an operator-presence check.

Distinguishing *the operator* from *a local process* is precisely the eligibility
problem carved out into `add-access-grant-dialog`, which was defeated four times.
This change does not solve it and must not claim to. Two consequences are
accepted deliberately:

- Until that change lands, the grant endpoint exists with no human-facing
  caller other than the remedy surface.
- Local-process equivalence is the dashboard's pre-existing loopback trust model,
  not something this change introduces. It does not widen it — but the grant
  endpoint is a new thing reachable under it.

**Forbidden subjects are compared as real paths**, since `realpath("/etc")` is
`/private/etc` on macOS and a home directory may itself be a symlink. The list
covers the filesystem root, the home directory, `~/.ssh`, `~/.pi`, and the
platform system directories (`/etc`, `/usr`, `/var`, `/Library`, and their
Windows equivalents) — the earlier list omitted every one of the system
directories while `/etc` was the most obvious target of the sequence above.

### D20 — The denial binding needs a path-denial registry, which does not exist yet

*Gap found in the second review cycle.* D15 requires a grant request to reference
"a recorded denial" — but nothing records filesystem denials. The only ledger is
`BlockEventBuffer`, which is keyed by **IP** and carries no path or subject, and
no task built a replacement. D15 was, as written, untestable.

So this change adds a **path-denial registry**, separate from the network ledger:

- Keyed by grantable **subject** (the containing directory), not by IP.
- Each entry carries an opaque `denialId`, the subject, the site that refused,
  the originating session, and a timestamp.
- Entries **expire** (short TTL) and the registry is **bounded** with
  oldest-evicted, following the ledger's cap-and-evict precedent. An expired or
  unknown `denialId` makes the grant request fail.
- It is written only by the containment denial path — never by an inbound
  request, the same invariant the network ledger holds.

The denial body therefore carries `denialId` and the grantable `subject`
alongside `reason`/`hint`. These are still additive fields on an unchanged
`error` string, but D7's "exactly two new fields" framing was too narrow.

### D16 — The grant store is read from memory, not from disk, on the hot path

*Added after cross-model review.* Both precedent stores `readFileSync` on every
check. `path-containment.ts` is async **by explicit design** — its own comment
warns that one caller stalling blocks every other request — so a sync read on the
containment path would regress that deliberately.

The store is loaded once into memory and invalidated on write. The grant check
SHALL also short-circuit when the store is empty, doing zero syscalls: that is
what makes D9's "byte-identical with an empty store" true of *cost* as well as
outcome.

**Consequence for rollback (caught in the second cycle):** with load-once,
*deleting the store file changes nothing until the process restarts* — the
already-loaded grants keep admitting. The supported rollback is therefore
**revoke through the Access tab** (which invalidates the in-memory set), or
delete-then-restart. The Migration Plan says so explicitly rather than implying a
file deletion takes effect immediately.

*Single-process assumption, stated:* two server processes over one store
last-writer-wins. The failure degrades toward deny, and the dashboard is
single-instance per `~/.pi/dashboard`, so it is accepted.

The amplification this avoids is concrete: `grep-routes.ts:60` awaits the
containment predicate **per match**, so N matches x 200 grants x a `realpath`
each — plus a file read per miss — is the worst case the cap alone does not
bound.

### D17 — "Session" scope means the server process; every grant is process-global

*Added after cross-model review.* The reused precedent is explicit that a trust
recorded by any client is visible to all until the server restarts. The same is
true here: one grant widens the grant layer for every session and every connected
client, and `"session"` means *the server process*, not the pi session whose
denial produced it.

This is stated rather than fixed. Per-session grant isolation would need a session
identity threaded through the containment path, which no site carries today. The
Access tab (D6) is what keeps a process-global grant visible; the `origin` field
records which session's denial produced it.

Session-scoped grants carry the same four fields as persisted ones (subject,
scope, `grantedAt`, `origin`) and live in memory only. They are NOT a bare string
Set: the Access tab must display them like any other entry.

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

Rollback: **revoke the entries in the Access tab** — that is the path that takes
effect immediately, because it invalidates the in-memory set (D16). Deleting the
store file alone does not take effect until the server restarts. Either route
returns containment to its current layers. No existing store's format changes
incompatibly.

## Open Questions

- **Does the network plane want an "accept once"?** A time-boxed trust is
  expressible but adds an expiry dimension `trustedNetworks` does not carry.
- **Should `paired-devices.json` appear as a read-only cross-reference?**
- **Should `resource-activation-toggle` and `git-operations`' `outside_repo`
  gain remedy fields too?** Lower-traffic than the file routes.

*Resolved during planning:* the grant-write failure question → D11; proactive
grant creation from the tab → D12; store bounds → D10; project-trust revoke →
D13; the check→open TOCTOU window → D14.

*Resolved after planning:* the store's load-path hardening and its accepted
trade-offs → D21.

---

### D21 — The store's LOAD path re-validates; the write path alone was not enough

**Provenance.** Task 8.8 doubt-driven review of the persisted format, run before
ship because an on-disk grant format is effectively irreversible. Cross-model on
`@propose-review-2` (ZAI GLM); `@propose-review-1` was SKIPPED as same-family —
the author runs on `deepseek-flash`, so a reviewer on that family would share its
blind spots. 12 findings; the load-path ones were the highest severity, and all
were verified against source before classification rather than rubber-stamped.

**The defect class.** The write path enforced five invariants; the read path
enforced only *shape*. A store that was hand-edited, hostile, copied between
machines, or written by an **older build** — both the forbidden list and the
format changed during planning — therefore loaded the process into a state the
write path could never have produced. `loadFromDisk` now re-applies, each with a
regression test that fails on the pre-fix code:

- **Forbidden subject.** `isUngrantableSubject` ran only in `recordGrant`. A
  single on-disk `"/"` admits **every path on the machine**. The list GREW during
  planning, so an older build's store can legitimately hold a subject this build
  must refuse; a store copied to a machine with a different `$HOME` is re-checked
  against the new `sensitive` set.
- **`version === 1`.** The field was written and never read, so a future file was
  silently interpreted as v1. An unknown version is now refused **and logged** —
  failing closed (narrower, never wider) and loudly, not silently.
- **Cap 200/scope.** `enforceCap` ran only in `recordGrant`, so a 100k-grant file
  loaded in full: every one admitted, the hot path's `Set` rebuilt per request,
  memory unbounded. The cap is a property of the STORE, not of the write path.
- **`scope === "project"` only.** Loading a disk-resident `session` grant
  resurrected it across restarts (contradicting "session = until server restart")
  and left it unrevocable through the scoped API, which touches memory only.
- **Finite `grantedAt`.** `NaN`/`Infinity` pass a bare `typeof` check and poison
  the eviction sort. (`JSON.stringify(NaN)` emits `null`, so the regression test
  writes a raw `1e999` literal — otherwise it would exercise nothing.)
- **`origin` is a string**, coerced to `"unknown"` rather than rendering undefined.

**Plus one write-path fix.** `enforceCap` now never evicts the grant being
recorded (`protect`). A rolled-back clock — or a future-dated entry already in the
file — made the NEW grant sort oldest, so it was evicted *before* persisting while
`recordGrant` still returned `ok: true`: a UI claiming a grant that does not
exist, the exact failure D11 forbids. A malformed → empty store also logs now, so
an operator's vanishing grants are never *silent*.

**Accepted trade-offs** (reviewed and consciously kept, not overlooked):

- **Single writer.** Loaded once, whole-file rewrite, no lock: two processes
  sharing one path silently drop each other's grants. The dashboard is one server
  per machine and `PI_ACCESS_GRANTS_STORE` is a test seam.
- **No `fsync` before `rename`.** A power loss can leave a short file, which then
  hits malformed → empty. That path fails **closed** (narrower, never wider), so a
  sync per grant was not worth it.
- **Case-sensitive subject compare.** `realpath` does not canonicalise case on
  macOS, so a case-variant subject could duplicate a grant or miss a revoke.
  Unreachable through the UI — subjects come from denials, which use real paths —
  and the repo's `samePath` helper is not importable here (module cycle).
- **First load is a sync read** on the first containment evaluation. This is D16's
  documented lazy load; the "zero syscalls" claim is about the warm path.
- **`revokeGrant` partial failure** with an undefined scope: session grants are
  spliced before the persisted write, so a failed write returns `false` while the
  session removal stands. Fails closed; the route passes an explicit scope.
- **Relative/empty subject in `recordGrant`** resolves against the server's cwd.
  The route's denial binding makes it unreachable, so no second guard was added
  beyond the forbidden filter that D15 already requires.

---

### D22 — A read grant is not an app-launch capability (grant-eligibility policy)

**Provenance.** Task 4.5 review gate, blocking #2. Verified in source, then by a
regression test that fails on the pre-fix code.

`gateFilePath` is shared, so making it grant-aware also made
`/api/open-in-system` and `/api/reveal-in-file-manager` grant-eligible. Those
routes do not read: they spawn a local application (or reveal in the file
manager) on the path. A grant framed as *read-widening* therefore silently
became an **app-launch** capability. The pre-fix test shows the real severity —
both routes returned `200` and spawned.

**Decision.** Grant eligibility is now declared per site, not inherited from the
shared helper: `evaluateContainment` takes `allowGrant` (default `true`), and the
two spawn routes pass `false`, keeping exactly the pre-change `isAllowed`-only
decision. Reads opt in by default; a capability that is not reading opts out
explicitly.

This is a deliberate narrowing, not an oversight: opening a file in an external
application is a different primitive from reading its bytes into the dashboard,
and it is one the operator's remedy copy never described. If a future change
wants a grant to authorize spawning, that is a separate decision with its own
remedy text and tests — the flag makes it an explicit one-liner rather than a
silent consequence of sharing a helper.
