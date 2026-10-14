## Context

- Init-status per folder row comes from `useInitStatus(cwd)` (`packages/client/src/hooks/useInitStatus.ts:17-35`), called once per row by `FolderInitScope` (`packages/client/src/components/session/SessionList.tsx:3217`). It fetches on mount / `cwd` change only, and exposes an unguarded `refetch` (`useInitStatus.ts:20-22`) — overlapping calls resolve last-write-wins.
- `FolderActionBanner` renders twice per row (`SessionList.tsx:2196` compact chip, `:2237` full). Each instance owns `pendingSpawn` + `knownIdsRef` + `spawnedIdRef` and calls `onStatusChange` (= `refetch`) when the spawned session's status becomes `ended` (`FolderActionBanner.tsx:145-175`). No test covers that path today (`__tests__/FolderActionBanner.test.tsx`).
- `SessionStatus = "active" | "idle" | "streaming" | "ended"` (`packages/shared/src/types.ts:58`). The server sets `idle` on `agent_end` (`packages/server/src/session/event-status-extraction.ts:95`; `packages/server/src/event-wiring.ts` — "`agent_end` is the only path back to `idle`").
- The setup rung requires `isProjectRoot && setupState(status) === "not-a-project"` (`FolderActionBanner.tsx:84`); `isProjectRoot` (pinned ∨ workspace-added ∨ a session reports `isGitRepo` ∨ `folderGitMap` has the cwd) is computed inline at both call sites (`SessionList.tsx:2199-2201`, `:2245-2247`).
- `group.sessions` already includes worktree sessions grouped under their main checkout (`packages/shared/src/session-group-path.ts:58`); ended sessions are partially held/paged (`SessionList.tsx:607`).
- The rung ladder is `failed > running > retrust > init-needed > setup` (`FolderActionBanner.tsx:77-86`). The coding profile scaffolds a `worktreeInit` hook (`packages/extension/.pi/skills/project-init/profiles/coding/settings.json.tmpl`), so after a successful setup the next probe surfaces `retrust`, not a quiet card.
- `GET /api/git/worktree/init-status` resolves the config root via `resolveConfigRoot` → `checkoutRoots` (`packages/server/src/git-worktree/git-operations.ts:1060-1070`), which spawns `git`. Not a free stat — re-probes must be gated.
- Server readiness checks OpenSpec pi-wiring as `<configRoot>/.pi/skills/openspec-explore/` (`packages/server/src/directory-service.ts:453-460`) and suppresses opted-out cwds via `pathKey` matching (`isOptedOutCwd`, `:463-468`; `pathKey` at `packages/shared/src/session-group-path.ts:40-44`; config `openspec.optOutDirectories` at `packages/shared/src/config.ts:254`; plus `openspec.enabled`, `openspec.offerInitialization`).
- `openspec init` on an existing `openspec/` runs in extend mode (`node_modules/@fission-ai/openspec/dist/core/init.js:214`). With `--tools`, `canPromptInteractively()` is false (`init.js:221-226`), so legacy cleanup runs automatically (`init.js:327-332`) — `--force` adds nothing on this path. The dashboard init route documents and detects the legacy artifacts cleanup touches (`packages/server/src/routes/openspec-routes.ts:226-330`).
- Project-init Step 3b gates OpenSpec on `openspec/` absence only; Step 6 verifies `./openspec/`; the "Idempotent re-run" paragraph assumes Step 6 never runs when `openspec/` pre-existed (`packages/extension/.pi/skills/project-init/SKILL.md:101-111`, `:259-279`).

## Goals / Non-Goals

**Goals:**
- Setup rung clears on the turn that wrote `.pi/settings.json`, regardless of how setup was launched, and across banner remounts.
- Configured rows and non-project-root rows pay zero extra requests.
- Project-init leaves OpenSpec wired (readiness not `STALE · missing-skills`) when `openspec/` pre-exists — honoring disable/opt-out/offer switches — and discloses every destructive side effect.

**Non-Goals:**
- Server push / fs-watch of `.pi/settings.json`.
- Refreshing the OpenSpec pill — server poll + broadcast already re-derives `hasOpenSpecSkills` every tick (`directory-service.ts:1004-1009`).
- Changing the pill's `STALE · missing-skills → Update` action.
- Gating OpenSpec on a profile capability flag instead of the `coding` name (pre-existing; separate change).

## Decisions

### D1 — Re-probe ownership moves into `useInitStatus`

Signature: `useInitStatus(cwd, opts?: { sessions?: Array<{ id: string; status: string }>; isProjectRoot?: boolean })`. The `isProjectRoot` expression is hoisted once per row in `SessionList.tsx`, passed to `FolderInitScope` → hook, and reused by both banner call sites.

The hook keeps `useRef<Map<id, status>>` of last-seen statuses plus a `seeded` flag. The first `sessions` snapshot after mount only seeds the map (the mount fetch covers it). Thereafter, on each `sessions` change it fires if any session:

- transitions INTO `idle` or `ended` from a different status (`prev !== undefined && prev !== next && (next === "idle" || next === "ended")`), or
- appears for the first time already `idle` or `ended` (`prev === undefined`) — a turn that completed while unobserved (reconnect snapshot, buffered replay, fast spawn→end, paged-in ended row), or
- was previously seen non-`ended` and is now absent from the snapshot (fast end + removal before `ended` was observed).

Entering `streaming`/`active` never fires: a turn start cannot observe a completed write. Targeting the destination state (not `streaming → *`) tolerates React batching that hides `streaming`. The map is then replaced with the current snapshot. The effect is keyed on a stable signature (sorted `id:status` string), not array identity, so unrelated re-renders are no-ops. Row membership is `group.sessions` — no `cwd` string filter (worktree sessions grouped under the main row also trigger; see Risks). A hook remount re-seeds the map but also re-runs the mount fetch, so nothing is lost across remounts.

Gate: fire `refetch()` only when `isProjectRoot && lastInterpretable === "not-a-project"`, where `lastInterpretable` is the `setupState` of the most recent probe whose result was interpretable (`ok` / `not-a-project`). A failed probe (fail-open `unknown`) still hides the rung per the existing contract but does NOT close the gate, so the next trigger retries — avoiding an absorbing hidden state. One effect run → at most one `refetch`.

Alternatives considered:
- *Keep spawn-id tracking, add idle trigger.* Still lost on remount; blind to menu/terminal setups. Rejected.
- *Interval poll while not-a-project.* Wasteful and latency-bound. Rejected.

`setupState` moves from `FolderActionBanner.tsx:61-71` to `packages/client/src/lib/init-setup-state.ts`, re-exported from the banner so existing imports/tests keep compiling. The hook must not import a component file.

### D2 — Latest-wins probes + throttled visibility re-probe

- Every probe (mount fetch and `refetch`) stamps a monotonically increasing request id in a ref and records `lastProbeAt` **at issue time** (a hung probe still throttles). A response is applied only if its id is the latest AND the hook is still mounted (a mounted ref replaces today's per-effect `alive` flag, `useInitStatus.ts:26-32`).
- `visibilitychange` → `visible`: `refetch()` iff the D1 gate holds AND `Date.now() - lastProbeAt >= 30_000`. Listener attached once per `cwd`; latest status/gate read via refs.
- Fail-open interplay: if the latest probe fails, `fetchWorktreeInitStatus` returns a checklist-less status (`packages/client/src/lib/git/git-api.ts:283-291`; `setupState` → `unknown`), hiding the setup rung until the next successful probe — the existing "Probe failure fails open" contract, unchanged. The gate keeps using `lastInterpretable` (D1), so triggers continue to retry.

### D3 — Banner loses its spawn tracking

Delete `pendingSpawn`, `knownIdsRef`, `spawnedIdRef` and the `ended` effect (`FolderActionBanner.tsx:145-175`); the setup button calls `onInitializeProject(cwd)` directly. Remove the `sessions` prop from `FolderActionBanner` and both call sites. `onStatusChange` stays (hook rungs use it via `WorktreeInitButton`). Update stale header comments in `FolderActionBanner.tsx:13-16` and `useInitStatus.ts:6-8`.

### D4 — Project-init OpenSpec detection

SKILL.md Step 3b computes `OPENSPEC_MODE ∈ {offer, repair, skip}`, first match wins:

1. `skip` + warn if `~/.pi/dashboard/config.json` exists but is unreadable / not JSON, or a present `openspec.enabled` / `openspec.offerInitialization` is non-boolean / `openspec.optOutDirectories` is non-array (fail closed — the server would use last-good/defaults, which the skill cannot see). Absent file or absent key → server defaults (`enabled: true`, `offerInitialization: true`, `optOutDirectories: []`, `packages/shared/src/config.ts:254-289`).
2. `skip` if `openspec.enabled === false`, or the target matches an `openspec.optOutDirectories` entry under `pathKey` semantics (`packages/shared/src/session-group-path.ts:40-44` over `normalizePath`, `packages/shared/src/platform/paths.ts:98`). SKILL.md embeds an exact copy-paste `node -e` comparison (resolve absolute, normalize separators, strip trailing separator, lowercase unless `process.platform === "linux"`) with a worked example — the agent never re-derives it in prose.
3. Git placement (fail closed): if `git rev-parse --is-inside-work-tree` fails → non-git, continue. Otherwise `skip` + note when ANY of: the absolute-form probe `git rev-parse --path-format=absolute --git-dir --git-common-dir` fails (e.g. git < 2.31); the two paths differ after `realpath` (linked worktree); `realpath(git rev-parse --show-toplevel)` ≠ `realpath(target)` (subdirectory of a checkout — readiness resolves skills at the checkout's config root, `directory-service.ts:439-460`, so a subdir repair/verify would diverge). `--separate-git-dir` checkouts and submodules compare equal. Deliberately stricter than the server's "failed probe = not in a repo" (`git-checkout-root-resolution` spec): a skill writing files must not guess.
4. `skip` if `openspec/` absent AND `openspec.offerInitialization === false`.
5. `offer` if `openspec/` absent → existing confirm.
6. `repair` if `.pi/skills/openspec-explore/` absent → no question.
7. otherwise `skip`.

**Why `init`, not `update`, for repair.** The pill maps `STALE · missing-skills` to Update (`openspec-folder-section` spec), which regenerates skills only for tools OpenSpec already records as configured. The targeted case is a project whose OpenSpec was initialized *without* pi, so `update` would not add pi; `init --tools pi` in extend mode (`init.js:214`) adds the pi tool without touching specs/changes.

**Why no extra confirm.** The REST init route refuses an overwrite without confirmation (`openspec-readiness` spec, "REST endpoint initializes OpenSpec") because a button click carries no disclosure. The skill's Step 3c `ask_user` preview names the repair and every detected legacy path before anything runs — that confirmation IS the overwrite confirmation; the convention is preserved, not bypassed.

**Command + disclosure.** Both `offer` and `repair` run `openspec init --tools pi --force` — identical argv to the server (`openspec-routes.ts:259`). `--force` is behaviorally redundant under `--tools` on the installed CLI (Context) but kept as a belt-and-braces non-interactive guard against an ambient CLI version that would otherwise prompt and hijack the session. Step 3b embeds the same three lists and both-marker rule as `openspec-routes.ts:279-330` (`LEGACY_CONFIG_FILES` requiring both `OPENSPEC:START` and `OPENSPEC:END`; `LEGACY_COMMAND_DIRS`; `LEGACY_COMMAND_FILE_DIRS` with `openspec-`/`opsx-` prefix). Step 3c discloses: `openspec-*` skills written/overwritten; each detected legacy path, worded "may be removed"; a generic line that the OpenSpec CLI may remove other legacy OpenSpec files it recognizes (the lists mirror CLI 1.6.0 while the installed CLI is 1.11.0); and that it may migrate OpenSpec's global config profile (`migrateIfNeeded`, `init.js:118-120`; `migration.js:437-462`).

**Run + verify.** Step 6 runs on `OPENSPEC_MODE = repair` or (`offer` ∧ confirmed); verifies exit 0 AND `.pi/skills/openspec-explore/`; on failure warns with an `ls .pi/skills/` listing; never fails the scaffold. The "Idempotent re-run" paragraph is rewritten: a re-run after success lands in `skip` (both present). `openspec` resolves from PATH; on dashboard machines that is the dashboard shim (`~/.pi/dashboard/openspec-shim/openspec`).

## Risks / Trade-offs

- [Unconfigured project root hosting ordinary sessions — including worktree sessions grouped under it, and ended rows paged in — re-probes once per qualifying effect run while the setup banner is visible] → accepted: the banner is the user-facing nag for exactly that state; cost ends once setup lands or the row stops being a project root. No decay counter (complexity not justified).
- [Tab return with N setup-banner rows → N simultaneous probes] → accepted: N is the count of unconfigured project roots (small in practice) and each row is throttled to 30 s; no cross-row scheduler.
- [`init-status` spawns `git` per call] → bounded by the D1 gate, destination-state triggers only, at most one probe per effect run, and the issue-stamped 30 s visibility throttle.
- [`openspec init` rewrites generated skills and, for legacy projects, edits root config files] → disclosed in the Step 3c preview the user must confirm; `doubt-driven-review` checkpoint (tasks).
- [Skill duplicates legacy-detection lists from `openspec-routes.ts`, which mirror an older CLI] → text-guard test pins the lists; the generic "may remove other legacy OpenSpec files" line covers paths the lists miss, so drift reduces specificity, not disclosure.
- [Ambient `openspec` version differs from the server's] → verify-by-artifact plus listing on failure; drift degrades to a warning.
- [Hook signature change] → `opts` optional; existing callers/tests keep working.

## Migration / Rollback

Client + skill prose only. No server, protocol, or persisted-state change. Rollback = revert the commit; `npm run build` + restart for the client, `npm run reload` for the skill.
