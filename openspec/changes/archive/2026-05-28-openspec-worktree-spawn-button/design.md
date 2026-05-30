# Design — openspec-worktree-spawn-button

## Context

Three streams of work converged on one PR (#46):

1. **Original scope** (proposal.md, archived 2026-05-28): per-change `⑂+` spawn-attached-in-worktree button + `gitWorktreeEnabled` global preference.
2. **Orphan-path recovery** (commit `070fb2e2`): post-archive expansion adding `POST /api/git/worktree/orphan-cleanup` + dialog warning UX. Spec lives at `specs/git-operations-api/spec.md`.
3. **Engines-range startup guard** (commits `63a8d531` + follow-up): post-archive expansion adding `isOutOfEnginesRange` predicate to `node-guard.ts`. Acts as the engines-field mirror at startup: refuses below the pi-0.75 floor and above the (current) `<26` cap. Spec lives at `specs/server-startup-node-version-guard/spec.md`.

This design doc records the cross-cutting decisions that span all three streams.

## Goals

- One-click "give this change its own branch + worktree + session" from the OpenSpec section of any folder.
- A global preference to hide all worktree UI without disabling the REST endpoints (preference, not capability gate).
- Self-recovery from the most common failure mode (orphan dir left by a previous failed spawn).
- Surface engines-range mismatch at server start with a single actionable message, instead of letting downstream `npm ci` calls surface a cryptic EBADENGINE.

## Non-Goals

- Per-folder override of `gitWorktreeEnabled` (global only for v1).
- Disabling REST routes when the flag is off (still reachable for tooling).
- Auto-derived worktree path UX changes.
- Recovery from orphan dirs that contain a `.git` entry (refuse and surface a manual-fix hint).
- Bumping `engines.node` above `<26` (Node 26 is untested; future change).

## Decisions

### D1. `gitWorktreeEnabled` is a preference, not a capability gate

UI flag only. REST routes `/api/git/worktree*` remain unguarded — they're already localhost-gated and capability-bound to git availability. Tooling and other clients keep working when the flag is off.

**Why:** turning off UI ≠ turning off the underlying feature. Capability gates leak into the protocol; preferences don't.

**Default:** `true`. Older clients without the flag treat it as `true` (additive, backward-compat).

### D2. Branch suggestion: `os/<change-name>` verbatim

The `⑂+` button prefills the dialog with `initialBranch="os/<change-name>"`. No slug variants — `slugifyBranch` is already applied downstream by the worktree route.

**Why:** less invention up front, fewer surprises for the user, and the canonical `os/` prefix makes it trivial to grep / filter / clean up.

### D3. `attachProposal` reuses existing protocol field

`spawn_session.attachProposal` and `spawn_session.gitWorktreeBase` both exist in `browser-protocol.ts`. The new per-change call site passes both; no protocol changes.

**Why:** zero migration burden, exact match for the intent ("the new session, in a new worktree, has this change attached").

### D4. Orphan-cleanup endpoint is deliberately conservative

`POST /api/git/worktree/orphan-cleanup` refuses if the target:
- contains a top-level `.git` entry (file OR directory) — looks like a broken worktree link,
- contains more than 20 files,
- contains any file > 1 MB,
- is not under the repo root (anti-traversal),
- is in `git worktree list --porcelain` (not orphan — refuse).

Stable error codes: `outside_repo`, `not_a_directory`, `looks_like_worktree`, `too_many_files`, `file_too_large`, `not_orphan`.

**Why:** the endpoint exists for ONE purpose — unblocking the spawn dialog when a previous failed attempt left a stray dir. Anything that looks like real work refuses. Better to surface a manual-fix hint than silently delete user content.

**Where the limits come from:** 20 files / 1 MB easily covers a half-bootstrapped worktree (just `tsconfig.json`, `vitest.config.ts`, maybe a partial `.git` link) while rejecting anything resembling a real working copy.

### D5. Orphan detection is two-tier (preflight + post-submit backstop)

- **Preflight:** dialog runs a debounced effect on `derivedPath` change — if the path exists on disk AND is NOT in the worktree list, show the warning + `[Clean up]` button BEFORE the user submits.
- **Backstop:** server's `addWorktree` includes `orphanLikely: boolean` in the `path_exists` error envelope. Dialog uses this signal to show the same warning + cleanup affordance if the race window opens between preview and submit.

After a successful cleanup from the backstop path, the dialog auto-retries submit ONCE.

**Why:** two-tier handles both the common case (user types branch name → instant feedback) and the race case (orphan appears between check and submit, e.g. parallel session).

### D6. Engines-range guard is a startup preflight, not a wrapper

`assertNodeVersionSupported()` is called at the TOP of every server entry point (`cmdStart`, `runForeground`). Before Fastify, before any route registers. On a hit it writes a multi-line message to stderr and `process.exit(1)`.

**Why:** any downstream `npm ci` (worktree-spawn bootstrap, extension install, pi-core update) inherits the running Node version. If that Node is below the pi-0.75 floor, every such call surfaces EBADENGINE in a different code path with no clear root cause. Failing at startup with `Required: >=22.19.0 <26` + three remediation hints is one error, one place to fix it.

**Why not a runtime wrapper around `npm ci`?** The wrapper would catch the EBADENGINE later, but every server hot-path that ever shells out to npm would need it. One preflight covers them all.

**History note on the cap:** commit `63a8d531` originally landed `<25` (refusing Node 25) on the theory that subprocess `npm ci` would EBADENGINE on Node 25. In practice the CI smoke matrix had been running Node 25 cleanly all along (because it passes `--engine-strict=false`). The dev-reported EBADENGINE was almost certainly an nvm subprocess-PATH artifact — the parent shell's `nvm use 24` doesn't always propagate to spawned children, and the child picked up a system Node 25 against a `<25` engines field. Fix: bump engines to `<26` instead of refusing Node 25. The predicate now mirrors the new cap.

### D7. Two distinct predicates, not one

`isAffectedNode` (Fastify bug, 22.0–22.18 + 24.1–24.2) and `isOutOfEnginesRange` (engines cap, `<22.19` or `>=26`) overlap on the 22.x lower edge but are conceptually distinct. Keeping them separate means:

- The Fastify-bug message survives even after the Node 22.18 Fastify fix is widespread, in case a user pins an affected version.
- The engines-cap message names the engines floor + cap explicitly.
- When `engines.node` moves, only the engines arm changes; the Fastify arm is untouched.

`assertNodeVersionSupported()` runs them in order — Fastify-bug first (more specific failure mode → more specific message), engines-cap second (catch-all for everything else outside the cap).

### D8. Bundled-Node remediation hint is advisory text

`buildEnginesRangeMessage()` includes the hint `PATH="$HOME/.pi-dashboard/node/bin:$PATH" pi-dashboard start`. This is **string content only** — no read or write of `~/.pi-dashboard/`. The hint matters because users who installed via the standalone installer already have a vendored Node at that path; pointing them at it is the fastest fix.

**Lint interaction:** `packages/shared/src/__tests__/no-managed-dir-reference.test.ts` (change `eliminate-electron-runtime-install` R3) bans new `.pi-dashboard` literals outside an allowlist. `node-guard.ts` is added to the allowlist with rationale comment ("advisory help-text only, no read/write").

### D9. CI lockstep with `engines.node`

`.github/workflows/ci.yml` smoke matrices (`standalone-install-smoke-linux`, `standalone-install-smoke-windows`) SHALL include every Node major in the engines range; nothing the predicate refuses should appear there.

**Today:** matrices on `[22, 24, 25]`, matching `>=22.19.0 <26`.

**When `engines.node` moves:** the matrices, the predicate, and the engines field move together in one change. Captured as task 9.7 (forward audit).

## Risks

- **R1 — Orphan-cleanup deletes real work.** Mitigated by conservative refuse arms (D4). The 20-file / 1-MB caps + `.git` refusal block every realistic accidental-target.
- **R2 — Engines guard refuses a user on the LTS edge.** Anyone on 22.18.x is refused even though `npm ci` may work for them. Acceptable — the upgrade is one nvm command, and the message says exactly what to do.
- **R3 — Engines guard drifts from `engines.node`.** Mitigated by tasks 9.7 (forward audit) + the lockstep contract written into both the spec and the in-file comments. If the cap ever changes, the predicate, the smoke matrices, AND this design doc move together.
- **R4 — Double protocol bookkeeping.** The active dir now duplicates content from the archive (`16c84ba6` archived an earlier snapshot). The active dir is the authoritative working copy for the stepper; the archive is a historical snapshot. On final archive, the active set wins. Captured as a doc-debt followup, not a behavior risk.

## Test Strategy

- `node-guard.test.ts` — 12 predicate cases + 4 message-shape assertions (covers each arm boundary).
- `WorktreeSpawnDialog.test.tsx` — orphan warning visibility, cleanup click flow, backstop error path with `orphanLikely:true`, plain-error path with `orphanLikely:false`.
- `git-routes` integration tests — every refuse code + happy path for `/api/git/worktree/orphan-cleanup`.
- `FolderActionBar.test.tsx` — `gitWorktreeEnabled=false` hides `+Worktree`.
- `no-managed-dir-reference.test.ts` — green after `node-guard.ts` allowlist entry.
- CI smoke — green on Node 22 + 24 (linux container matrix + windows runners). Node 25 removed.

## Open Questions

None blocking. Forward-looking only:
- When Node 26 reaches general availability and the dependency tree is verified against it, raise the `<26` cap in lockstep across `package.json`, `isOutOfEnginesRange`, the smoke matrix, and this design doc.
- Consider folding the `git-operations-api` orphan-cleanup delta into `openspec/specs/git-operations-api/spec.md` at final archive (sync glitch from commit `070fb2e2` left it un-synced — see "R4 / R-archive followup").
