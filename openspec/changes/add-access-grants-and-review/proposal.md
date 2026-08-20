# Add access grants and a unified review surface

## Why

Every access guard in the dashboard denies **silently and terminally**. A blocked
request returns a 403 and stops there: the filesystem containment sites in
`file-routes.ts` return a bare `"path outside working directory"`, and four HTTP
routes return an unknown-`cwd` refusal (while the knob that would *unblock* them
— a pinned directory — already exists and is never mentioned). The user is
expected to guess which of eight scattered trust stores to edit, and most of them
are not reviewable or revocable from the UI at all.

Exactly one guard already does this properly. `distinguish-offline-from-network-denied`
plus `add-tunnel-providers` built the full loop for the network plane: a
self-describing 403, a typed client error, a remedy surface, and a
"Trust this network" banner that writes `config.trustedNetworks`. That loop is
the proof the pattern works — it has simply never been generalized.

This change makes a denial **name its remedy**, gives the filesystem plane a real
grant it never had, and gives every grant in the system a single reviewable,
revocable home.

## What Changes

- **Filesystem grants exist for the first time.** A persisted grant store adds
  directories to what the containment check will admit — the knob that simply did
  not exist for `/api/file*` before. Grants are created from a remedy surface and
  from the new Access tab, and revoked from the Access tab.

- **A grant admits its own subtree only.** Grants are checked by a dedicated
  subtree predicate, *not* by appending to the `isAllowed` anchor list: that
  function runs a git-common-root widening pass over every anchor it is given, so
  appending a grant for `…/repo/sub` would silently admit all of `…/repo`. The
  check resolves symlinks on both sides, preserving the symlink safety the
  existing git-root layer already provides, and the subject is stored as its
  `realpath` so a grant cannot follow a symlink that is later repointed.

- **Denial bodies name their remedy.** The bare-string denial sites gain `reason`
  and `hint` fields alongside their existing, unchanged `error` string — matching
  the shape `localhost-guard` already emits. A client reading only `error` sees
  no difference.

- **Network / CORS / auth planes get request→accept.** The requester there is
  untrusted by definition, so asking *it* for permission is not a gate. Worse,
  once `add-universal-network-guard` lands, a new device is denied at the
  ws-ticket mint endpoint and never opens a WebSocket at all — so it has no
  channel to ask over. Instead: **the 403 itself is the request.** The denial is
  recorded server-side, a trusted client sees the pending entry and accepts, and
  the denied client's next retry succeeds. The untrusted side sends nothing, so
  this adds no inbound attack surface.

- **New `Settings → Access` tab.** One list of every grant across every plane —
  path grants, `config.trustedNetworks`, `auth.bypassHosts`, CORS origins, pinned
  directories, KB source trust, worktree-init hook trust, project trust — each
  showing subject, origin, grant time, and a revoke action.

  Two of those stores (`git-worktree/worktree-init-trust.ts` and
  `kb/src/trust.ts`) expose only `isTrusted`/`recordTrust` and have **no revoke
  function today** — this change adds one to each. `kb-source-trust.json` is
  keyed `sha256 → true` with no record of the subject, so its entries are
  listable only as opaque hashes until the store records a subject alongside the
  hash; that is an additive field, not a format migration.

- **No new guards, and no guard is widened by default.** Every gate keeps its
  current default-deny behaviour. The grant store starts empty, so behaviour is
  byte-identical to today until the operator grants something. No grant is ever
  created without an explicit human action.

- **Out of scope: the blocking grant dialog.** Asking at the moment of denial is
  split into `add-access-grant-dialog`, which depends on this change. The reason
  is recorded there and is worth stating here too: deciding *which requests may
  raise a dialog on the operator's screen* was attempted four times and defeated
  four times (by drive-by requests, by the auth model, by the CORS policy
  admitting any zrok share, and by DNS rebinding). It is a genuinely separate
  design problem, and holding this change hostage to it would strand the parts
  that did converge. Everything here is a prerequisite for that change anyway.

- **Out of scope:** `tool_call`-level approval of `bash`/`write`/`edit` (that is
  `add-supervised-tool-approval`). Agent-side file access is already gated by
  pi's project-trust at session start.

- **Out of scope: KB source TOFU rewiring.** An earlier draft claimed
  `kb/src/trust.ts` prompts on a `process.stdin` channel that a dashboard session
  lacks. That premise is false: the only caller passing `promptTrust` is
  `packages/kb/src/cli.ts`, gated on `process.stdin.isTTY`, and a
  dashboard-spawned session runs in a PTY. Its trust entries are still listed and
  revocable in the Access tab.

**Depends on `add-universal-network-guard`** (37 tasks, unstarted) landing first.
It collapses ~20 per-route `preHandler` denials into a single `onRequest` hook —
one instrumentation point instead of twenty — registers *last* so
`request.isAuthenticated` is settled when the denial is recorded, and already
commits to logging every denial with path, source IP and reason. It also creates
the denials this change exists to make recoverable.

## Capabilities

### New Capabilities

- `path-anchor-grants`: persisted filesystem grants checked by a dedicated
  subtree predicate — subject is a real directory path, keyed and revocable.
  Scope follows the `"session" | "project"` precedent already implemented in
  `git-worktree/worktree-init-trust.ts`.
- `access-settings-tab`: the unified `Settings → Access` review surface over
  every grant store, with revoke.

### Modified Capabilities

- `file-read-containment`: a persisted-grant subtree check is added after the
  existing layers, and denials name their grantable subject. The existing
  per-site anchor sets — including the `homePiAnchor()` (`~/.pi`) anchor on the
  render/preview sites and the pinned-directory anchor on `exists` — are
  preserved exactly.
- `network-denial-ring-buffer`: generalized past tunnel-only denials into the
  pending-access-request queue that backs request→accept, retaining its dedupe,
  IP cap, and `trustable` classification.
- `pinned-directories`: an unknown-`cwd` denial names pinning as its remedy,
  making the existing knob reachable from the denial.
- `trusted-networks`: entries become reviewable and revocable from
  `Settings → Access`, and acquirable via accept-a-pending-request rather than
  only the tunnel banner.
- `server-cors`: an origin denial becomes observable and reviewable instead of
  surfacing as an opaque browser CORS failure.

## Impact

- **Affected code:** `packages/server/src/lib/path-containment.ts` (grant subtree
  predicate, additive — the existing `isAllowed` semantics are untouched),
  `packages/server/src/routes/file-routes.ts` (7 `isAllowed` sites, incl. the
  `gateFilePath`/`gateOfficeFile` gates whose rejection bodies use a different
  `{ code, error }` shape), `packages/server/src/lib/resolve-file-mention.ts` and
  `packages/server/src/routes/grep-routes.ts` (the two containment sites outside
  `file-routes`), `packages/server/src/routes/session-routes.ts`,
  `packages/server/src/routes/goal-routes.ts`,
  `packages/server/src/routes/openspec-group-routes.ts`,
  `packages/kb-plugin/src/server/kb-routes.ts` (the four HTTP cwd-allowlist
  denials, plus `file-routes.ts:645` whose string is `"unknown cwd"`),
  `packages/server/src/tunnel/tunnel-block-events.ts` (generalized ledger),
  `packages/server/src/git-worktree/worktree-init-trust.ts` and
  `packages/kb/src/trust.ts` (add revoke),
  `packages/client/src/components/settings/` (Access tab).
- **New persisted state:** a path-grant store under `~/.pi/dashboard/`, alongside
  the existing `worktree-init-trust.json` and `kb-source-trust.json`. Unlike
  `worktree-init-trust.json` (a flat `Record<string, true>`), this store records
  subject, scope, grant time, and origin, because the Access tab must display
  them.
- **Behaviour change:** none until the operator grants something. Denial bodies
  gain additive fields; the pre-existing `error` strings are unchanged.
- **Not affected:** no request is ever suspended or held open by this change.
  That is entirely the dialog change's concern.

## Discipline Skills

- `security-hardening` — this change touches the trust boundary and adds a
  persisted grant store. Every task that widens what containment admits runs
  through it.
- `doubt-driven-review` — the grant store format is effectively irreversible once
  shipped, and the subtree predicate is the security core. Three cycles already
  ran on the parent change; the surviving decisions are carried here.
- `observability-instrumentation` — the denial ledger and every grant/revoke
  transition need to be diagnosable after the fact.
- `scenario-design` — the grant-semantics matrix (symlink escape, symlink
  retarget, git-root non-widening, empty-store equivalence, revoke-takes-effect)
  is where the correctness lives and needs deriving before implementation.
- `review-code` — before commit, per project default.
