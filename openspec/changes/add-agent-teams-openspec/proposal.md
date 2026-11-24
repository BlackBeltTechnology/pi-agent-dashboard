## Why

Changes 1–3 of the `agent-teams` group give the dashboard a generic team runtime (lead + named teammates + shared task list + mailbox), a Team view, and file-based team templates with hooks. Nothing yet connects that runtime to the workflow this repository actually uses: OpenSpec.

Two real shapes of work fit a team:

1. **A whole OpenSpec group** (`openspec/groups/groups.json`) — N independent-ish changes with `dependencies.yaml` edges. Today only `ship-batch` ships a group: a detached, unattended runner that never answers questions. There is no *interactive* counterpart where the owner watches, chats with a teammate, and answers `ask_user` while several changes ship in parallel.
2. **One wide change** — a `tasks.md` with dozens of checkboxes across sections. Today a single session works through it serially.

Both need glue the generic runtime deliberately does not have: seeding tasks from OpenSpec files, one git worktree per teammate, a lock for the docker harness (which cannot run twice concurrently on the dev VM), and — for the wide change — checkbox updates in `tasks.md` written by exactly one writer.

`ResourceLock` (a new teammate tool and a `lock_grant` mail kind) goes beyond the minimal D1 cut for change 4; it is a deliberate addition because the harness cannot be shared and `docker/test-up.sh` only refuses, it never queues. The simpler alternative (`openspecGroupParallel: 1`, no lock) is recorded in the design Risks.

## What Changes

- **Bundled template source.** The plugin ships templates in its own package directory; they appear in `team.templates` with source `bundled` (lowest precedence, trusted because they are shipped code, `mode: session`). Two ship in v1: `openspec-group` and `openspec-apply`. Each is bound by name to a **server-side profile** (preflight + seed + launcher/sync + guards) that only the bundled source can activate, and only in a trusted project (`host.isProjectTrusted`, else `project_untrusted`). Validation runs in a `preflight` before `createTeam`, so a bad goal creates nothing.
- **`openspec-group` (interactive counterpart to ship-batch).** At lead bind the server reads the group named by the goal, creates one team task per active change (`blockedBy` from each change's `dependencies.yaml`, restricted to in-group changes, created in topological order), and a launcher spawns one teammate per change — lazily, at most `openspecGroupParallel` slots at a time (derived from state, so restarts cannot over-launch) — each in its own worktree `.worktrees/os-<change>` on branch `os/<change>` following the `ship-it` skill. The plugin creates the worktree through the dashboard git routes (in-process inject, the ship-batch flow) and then calls core `spawnMember` with `TrustedSpawnOptions.cwd`; no host worktree feature is needed. Completion is gated: `not_shipped` unless the change is archived (in the worktree, or on `origin/<base>` once `ship-change` removed it). A failed launch is recovered through an owner-gated relaunch route. ship-batch stays for unattended runs.
- **`openspec-apply` (wide change).** At lead bind the server parses `openspec/changes/<change>/tasks.md` and seeds team tasks (one per checkbox, or one per `##` section when the change is wider than `maxTasks`), keeps the numeric ids (`1.1`) as references, derives `blockedBy` from section order and optional ignored-by-parser hints `<!-- after: 1.2 -->`. Implementers self-claim; a read-only `reviewer` member is limited to the `review-code` skill. The lead is the sole committer (team committer `lead`).
- **Sole writer of checkboxes.** On a task completion the plugin server ticks the matching `tasks.md` lines through the existing `POST /api/openspec/tasks/toggle` (via `ctx.fastify.inject`, the mcp-server-plugin precedent). Teammates cannot edit `tasks.md` or `specs/` deltas through `write`/`edit` (guard); `bash` stays advisory.
- **Resource lock.** A tiny per-team mutex tool `ResourceLock` (`acquire` / `release` / `status`, FIFO queue, auto-release) serialises the docker harness among `ship-it` teammates.
- **Examples.** A judo-ng-style per-module template (rank → `blockedBy`, `TaskCompleted` hook) is documented as a non-discoverable example; no judo-ng repository change.
- **Core seams consumed, not redefined:** `store.on("task_completed" | "change")`, `registerOpGate`, `registerDispatchEligibility`, `registerSpawnContributor`, `registerMailKind`, `TrustedSpawnOptions {cwd, committer}`, `TEAM_TOOLS_BY_ROLE`, `Team.overrides`. **Own additive entry in change 3:** `registerStartProfile(name, {preflight, seed})` and the `bundled` source (kept here per the core gap decisions; requested from change 3 in a crossfix). **Requested of core:** an internal `requestShutdown(team, name, {actor:"server"})` op and per-member committer semantics.
- **Owner-ratified D4 exception (decision A2).** In `openspec-group` each teammate owns a worktree/branch and `ship-it` commits there. The exception to "lead is the sole committer" is scoped to the member that owns that worktree's branch (core per-member committer); the lead stays the only committer in the shared cwd of `openspec-apply`. Options are recorded in the tradeoffs file.
- **Hardening decided by the owner (B67–B93).** Fixed preflight precedence and new typed codes (`groups_invalid`, `nothing_to_do`, `tasks_unreadable`, `change_in_use`, `profile_unavailable`, `sidecar_write_failed`, `sidecar_missing`, `queue_full`, `owner_locked`, `kind_reserved`, `launch_timeout`), a preflight snapshot plan, repository-file caps, a fail-closed sidecar, atomic owner assignment, lock grant redelivery and a seventh config key `openspecFetchTimeoutMs`.

## Capabilities

### New Capabilities

- `agent-teams-openspec-templates`: bundled template source, name-bound profiles, seed-at-start contract, typed start failures, non-discoverable examples.
- `agent-teams-openspec-group`: group → tasks seeding, dependency mapping, launcher, per-teammate worktree and `ship-it` prompt, completion/shutdown, coexistence with ship-batch, cwd policy.
- `agent-teams-openspec-apply`: tasks.md → tasks seeding (granularity, hints), checkbox sync by the runtime as sole writer, write guard, reviewer member, lead-only commit.
- `agent-teams-resource-lock`: per-team named mutex tool with FIFO queue, TTL and automatic release.

### Modified Capabilities

<!-- none: changes 1–3 are unarchived, so their capabilities do not exist in openspec/specs yet; everything is additive in the capabilities above -->

## Impact

- `packages/agent-teams-plugin` (created by change 1): `src/server/openspec/` (profiles, preflight, groups reader, seeders, launcher, worktree, completion gate, checkbox sync, lock), `src/bridge/` (teammate guard additions, `ResourceLock` tool), `templates/` (two bundled templates), `examples/` (judo example), `configSchema.json` (seven keys).
- No change to `packages/server`, `packages/shared` or the OpenSpec CLI; only existing HTTP routes and shared readers are used through in-process injection (`GET /api/openspec/tasks`, `POST /api/openspec/tasks/toggle`, `POST /api/git/worktree` + `orphan-cleanup` + `init`, `@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js`) plus the core seams listed above. Whether a bare loopback inject passes the route guards is verified in tasks 3.3 and 5.5.
- Compatibility: additive; teams without a bundled-profile template behave exactly as in changes 1–3. Change 3's "two sources" and "no pre-authored tasks" wording gets two named exceptions (see the templates spec "Relation to the template requirements of change 3"); convert to MODIFIED blocks at archive if change 3 did not absorb them. Rollback: delete the bundled templates and the `src/server/openspec/` module; no persisted data of other changes is touched (own sidecar files under the plugin data dir are ignored when the module is absent).
- Migration: none. Sidecar files are versioned (`schemaVersion: 1`).
- Ordering: blocked by `add-agent-teams-templates-hooks` (template format, hooks, start paths). `add-plugin-spawn-worktree` is no longer a dependency; a later swap of the worktree step to the host feature is recorded in the tradeoffs file.

## Discipline Skills

- `security-hardening`: change names, group ids and `tasks.md` text are untrusted file input that reaches `git` (branch names), prompts and a file writer; the project-trust gate, the seeded-text-as-data rule, the checkbox writer and the `tasks.md`/`specs/` write guard are a trust boundary.
- `observability-instrumentation`: new launcher, seeding and sync paths need structured logs and counters (seeded, spawned, sync failed, lock waits).
- `doubt-driven-review`: the start-profile hook points, the per-member committer and the lead-commits rule (deliberate exception for per-teammate worktrees, owner-ratified) extend change 1 and 3's contracts.
- `performance-optimization`: not triggered (≤ 50 tasks, ≤ 10 teammates).
- `review-code`: before commit.

## Non-goals

- Replacing or modifying `ship-batch` or `ship-it`; unattended runs stay with ship-batch.
- Planning-phase teams: `plan-proposal` stays single-author. Reviewer teams for `doubt-driven-review` are noted as future work.
- Worktree removal or merge after a teammate finishes (owned by `ship-change` / worktree lifecycle); detection of already-shipped changes through `origin/develop` (ship-batch does it; the team uses the lead's checkout).
- File locking between teammates; teammate commits in the shared cwd of `openspec-apply`; a tool-renderer for `ResourceLock` (generic tool row in v1).
- Any judo-ng repository change; the judo template is an example only.
- A per-module hook that runs a build (hooks are clamped to ~12 s by change 3); the example uses a verification stamp instead.
