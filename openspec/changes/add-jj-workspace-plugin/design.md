## Context

Three forces shape this design:

1. **The plugin architecture is already paved.** `flows-plugin` is the worked example: workspace package + manifest + slot claims + predicate-gated contributions. Anything jj-specific that doesn't fit that pattern is a smell.
2. **`jj` is dangerous in colocated repos.** `git commit` / `git rebase` / `git merge` corrupt jj history irrevocably. The plugin's UI surface and the fold-back skill must never invoke mutating git commands. This is non-negotiable.
3. **Activation must be invisible when `jj` isn't installed.** The plugin must produce zero UI artifacts when the user has no jj on PATH, no diagnostic banners, no "install jj" nag. The slot predicate mechanism is the right tool for this.

## Goals

- Activate only when `jj` resolves via the tool registry AND the session cwd contains `.jj/`.
- Always display the workspace name on session cards inside a jj workspace.
- Provide a one-click "spawn agent in a fresh workspace" button reusing the existing pending-attach + spawn-with-cwd machinery.
- Provide a fold-back skill that is jj-native (no `git commit` / `git merge` ever).
- Same-machine, single-user — no distributed locking, no multi-host concerns.

## Non-Goals

- Replacing the existing git-operations server module. Git remains the truth for non-jj repos; jj is additive.
- A full jj log/diff UI. The `/jj` command-route view is intentionally minimal (status + workspace list + op log) — it's not a TUI. Power users use the knoopx IDE TUI in a terminal session.
- Atomic two-phase fold-back (resume on partial failure). v1 stops at the first error and surfaces the jj output to the user.

## Decisions

### Decision 1 — Plugin lives in its own workspace package, mirrors flows-plugin

**What:** New `packages/jj-plugin/` with the same shape as `packages/flows-plugin/`: `package.json` carries the `pi-dashboard-plugin` manifest; client lives at `src/client/index.tsx`; server lives at `src/server/index.ts`.

**Why:** Consistency with the established pattern keeps the plugin loader's discovery, vite-plugin generation, and CI publish flow unchanged. Anything cleverer is risk for no benefit.

**Alternatives considered:**
- *Bake jj support into the dashboard shell directly.* Would re-create exactly the coupling the plugin architecture was built to remove. Rejected.
- *Ship as a `fixture: true` plugin like demo-plugin.* No — this is intended for production use.

### Decision 2 — Activation gate is the predicate mechanism, not a manifest-level conditional

**What:** Manifests are static; the loader can't conditionally register a plugin based on whether `jj` is installed. Instead, every claim that produces UI carries a predicate (`isInJjRepo` or `isInJjWorkspace`) that returns `false` when `Session.jjState?.isJjRepo` is undefined or false.

**Why:** Predicate-based gating is already how flows-plugin works (`predicate: hasActiveFlow`). The runtime reads it as "render nothing for this session", which is exactly the desired behavior when `jj` is absent. Zero artifacts, zero noise.

**How does `Session.jjState` come to be undefined when jj isn't installed?**
- The bridge's existing 30 s cwd poll already runs `git rev-parse` etc. We extend it to also call the tool registry to resolve `jj`. If the registry returns an error, the probe short-circuits and the field stays undefined. No bridge crash, no error broadcast, no UI.
- This means **the tool registry is the single source of truth for "is jj available"** — consistent with how `git`, `openspec`, `tsx` are gated everywhere else.

**Alternatives considered:**
- *Server-side feature flag.* Adds a config knob users have to find. Worse UX than auto-detection.
- *A new `manifest.activationCondition` field on the loader.* Premature generalization; predicates already solve it.

### Decision 3 — Workspaces live in `.shadow/<name>/` by default, configurable

**What:** Plugin's `configSchema` exposes `workspaceRoot` (default `".shadow"`, relative to the parent workspace). The "+ Workspace" action runs `jj workspace add <repoRoot>/<workspaceRoot>/<name>`.

**Why:** Matches knoopx's convention. Subdirectory keeps the parent repo's sibling directory tidy. `.shadow/` is gitignore-friendly (one entry covers all workspaces). User chose this in the discovery questions.

**Implications:**
- The plugin **does not** add `.shadow/` to `.gitignore` automatically. We surface a one-time hint in `JjWorkspaceList` if `.shadow/` exists but isn't gitignored.
- Sibling-directory power users override via the config (`workspaceRoot: "../"` plus a per-workspace name pattern).

### Decision 4 — Spawn-with-cwd reuses `pending-attach-registry`

**What:** When the browser sends `POST /api/jj/workspace/add { fromCwd, name, taskDescription? }`:

1. Server calls `jj workspace add <abs-path>` and waits for completion.
2. Server resolves the new abs path with `safeRealpathSync`.
3. Server calls `pendingAttachRegistry.enqueue(newCwd, name)` — exact same call site shape as the OpenSpec attach-and-spawn flow.
4. Server calls `spawnPiSession({ cwd: newCwd, ...rest })`.
5. The bridge's `session_register` is consumed by `event-wiring.ts`'s `pi-gateway.onSessionRegistered` hook; `pendingAttachRegistry.consume(newCwd)` returns the workspace name; the new `Session.jjState.workspaceName` is populated by the bridge's first poll moments later.

**Why:** Zero new orchestration code. The OpenSpec change `add-folder-task-checker-and-spawn-attach` already proved this lever works. The "task description" if provided becomes the auto-attached `description` on the new session (same field the OpenSpec flow uses).

### Decision 5 — Fold-back is a skill, not a button

**What:** The agent invokes `jj-workspace-fold-back` via slash command or natural-language request. The dashboard's `JjActionBar` includes a "Fold back" button that opens `JjFoldBackDialog` — but that dialog only **prompts the agent** with the right preamble. The actual `jj` invocations happen in the agent's bash tool calls, governed by the skill markdown.

**Why:** Three reasons.
- The operation needs judgement: which bookmark name? Squash or preserve? Push to trunk or open a PR? An agent-driven skill handles ambiguity better than a fixed button.
- Skills are reviewable artifacts — the safety-critical "never call `git commit`" rule lives in plain markdown the user can audit.
- Keeps the server's surface area small. We don't need a `POST /api/jj/fold-back` endpoint; the agent has bash and `jj`.

**Default flavor (locked in discovery):** preserve agent commit history, rebase onto trunk, push to a feature bookmark. The user's `configSchema.allowDirectTrunkPush` (default `false`) decides whether the skill may push directly to `main` or must always use a bookmark.

**Skill refusal cases (skill itself enforces):**
- Repo isn't jj-colocated → tell the user, suggest `jj git init --colocate`.
- Working copy is empty (`jj diff` returns nothing on `@`) → "nothing to fold back".
- Unresolved conflicts (`jj resolve --list` non-empty) → refuse, instruct to resolve first.
- `git status` shows staged/unstaged changes (mutating-git footgun guardrail) → refuse with a loud warning.

### Decision 6 — Plain-git repos get a one-click "init colocated" affordance

**What:** When the session's cwd is inside a git repo but NOT a jj repo, `JjActionBar` (gated on a softer predicate `isInGitRepoButNotJj`) shows a single "Enable jj workspaces" button. Clicking it calls `POST /api/jj/init-colocated`, which runs `jj git init --colocate` in the cwd.

**Why:** Asked in discovery. Lower friction than telling users to RTFM. The button is the only UI the plugin shows in this state — once `.jj/` exists, the badge and full action bar take over.

**Safety:** `jj git init --colocate` is safe on a working tree that has unstaged edits or untracked files — jj snapshots them into the new `@` commit non-destructively. It is **not** safe on a tree with **staged** changes that differ from HEAD: jj writes the git index to match `@-`, which silently discards anything that lived only in the index. The endpoint therefore refuses on dirty index (`git diff --cached --quiet` non-zero) but allows dirty working tree. This is a refinement of an earlier draft that overcautiously refused any dirty state.

### Decision 9 — Session diff becomes vcs-regime-aware

**What:** `packages/server/src/session-diff.ts`'s `enrichWithGitDiff` becomes a thin dispatcher. When `Session.jjState?.isJjRepo` is true, the request routes through a new `enrichWithJjDiff(cwd, files, baseRev)` that runs `jj diff --from <baseRev> --to @ -- <path>` per file. Otherwise the existing `git diff HEAD` path is used unchanged.

**Why three regimes need three diff bases:**

| Regime                                | Diff base for "changed files"            | Why                                                       |
|---------------------------------------|------------------------------------------|-----------------------------------------------------------|
| A. Plain git                          | `HEAD`                                   | Existing behavior; nothing else makes sense.              |
| B. jj-colocated, default workspace    | `@-` (== HEAD in colocated mode)         | Agent's uncommitted edits = working-copy commit on top.   |
| C. jj workspace (`.shadow/agent-X`)   | `fork_point(@, trunk())`                 | Cumulative diff across every jj commit the agent made.    |

Without regime C's broader base, the diff view in a workspace shows only the *last* of N commits the agent produced — which is actively misleading when the user is about to fold-back N commits. Regime C is the killer feature; A and B are about not breaking what works.

**Why the base is computed server-side, not pinned at workspace-create time:**

We could have `POST /api/jj/workspace/add` record `baseRev` into session metadata for later diff-time use. We don't, because:

- The fork point can be re-derived correctly at diff time via `fork_point(@, trunk())` — jj's revset language is the source of truth.
- Pinning a literal commit id at create time gets stale if the user rebases or absorbs the workspace's history.
- Stateless server-side derivation is one fewer thing to persist and migrate.

**Response shape change is additive:**

```ts
SessionDiffResponse {
  files: FileDiffEntry[];
  isGitRepo: boolean;          // existing
  vcsKind?: "git" | "jj";      // new, optional
  diffBase?: string;           // new — the actual revset used
  baseLabel?: string;          // new — human label, e.g. "develop"
}
```

Older clients ignore the new fields; new clients render a one-line header ("Diffing against develop") in the panel above the file tree.

**Untracked files in the jj path are simpler.** `jj diff` reports new files in unified diff format natively; the synthetic-diff fallback (`/dev/null` headers + `+`-prefixed line dump) the git path needs is unnecessary. ~30 LOC dropped from the jj branch.

**Deferred:** an end-user-facing diff-base selector (dropdown choosing between `develop`, `trunk()`, `@-`, custom revset). Useful but not blocking. Tracked as a follow-up if anyone asks.

### Decision 8 — Workspace creation never coordinates with sibling sessions

**What:** `POST /api/jj/workspace/add` does not pause, signal, or coordinate with any other pi session that may be working in the same repo. The new workspace's working copy commits onto a chosen `baseRev` (default: the source cwd's current bookmark, falling back to `trunk()`).

**Why:** jj's data model means concurrent workspaces are first-class. Each workspace has its own `@` commit; sibling workspaces' working copies are independent commits in the shared `.jj/` store. jj's op log uses optimistic concurrency control internally, so two sessions running `jj` commands at the same instant don't corrupt each other.

**Implications for the user's mental model:**

- **The new workspace does NOT inherit the source session's uncommitted edits by default.** If session A is editing `auth.ts` on `develop`, session B's new workspace starts on `develop` (clean), not on `@_session-A`. This is almost always what the user wants when they say "spawn a parallel agent".
- **If the user explicitly wants the new workspace to start from another session's working-copy state**, they pass `baseRev: "@_<workspaceName>"` or a change-id. We don't expose this in the default UI — it's an advanced affordance reachable through the plugin's REST API or a future "advanced" toggle in `JjActionBar`.
- **The source session's working copy is byte-identical before and after.** We have an explicit spec scenario asserting this so a future refactor can't quietly regress.

**Plain-git case:** if the source repo isn't yet jj-colocated, the workspace-add endpoint runs `jj git init --colocate` first (per Decision 6's safety rules), then the workspace add. The source session's session card transitions from "git only" to "jj-aware" within one bridge probe tick (≤30 s) without reload.

### Decision 7 — All `jj` invocations route through `platform/exec.ts` Recipe pattern

**What:** A new `packages/shared/src/platform/jj.ts` module mirrors `git.ts` and `openspec.ts`: typed functions like `jj.workspaceAdd(path, name)`, `jj.workspaceList(repoRoot)`, `jj.bookmarkCreate(name, rev)`. Each is a Recipe consumed by the existing `runner.ts`.

**Why:** Consolidates the shell-out surface, gets us the timeout / error normalization / `Result<T>` contract for free, and means cross-platform tests don't need to mock `child_process` directly.

**Tool resolution:** `jj` is resolved via `ToolResolver.get("jj")` once per request, not per call. Cached for the request's lifetime.

## Risks / Trade-offs

### Risk: Bridge poll cost grows with jj added to git-info

**Mitigation:** `jj st` on a typical repo is ~10–30 ms. Combined with the existing git probe, the per-session 30 s poll cost rises by ~20 ms. We add a fast-path: if `.jj/` doesn't exist in cwd, skip the `jj` invocation entirely. So the cost is paid only by sessions that are actually inside a jj repo.

**If it still bites:** raise the jj-probe interval to 60 s independently of the git probe.

### Risk: The `jj` binary version skew

**Mitigation:** jj's CLI has been stable since 0.18+ for the commands we use (`workspace`, `bookmark`, `rebase`, `git push/init`, `st`, `diff`, `log`, `resolve`). We pin a minimum version (`>= 0.18.0`) in the tool registry definition and the bootstrap-state `compatibility` mechanism (mirroring how pi-version skew is reported) emits an advisory if the installed jj is older. We do NOT block — older versions still resolve, just with reduced functionality.

### Risk: Users expect "merge worktree + git commit" literally

**Mitigation:** The fold-back skill's first paragraph explicitly clarifies: "**This skill never invokes `git commit` or `git merge`.** A new commit appears on `main` because `jj git push` translates jj history into git refs. The result is identical to a normal git commit — but the operation that produced it is jj-native and safe in colocated repos." The dashboard's `JjFoldBackDialog` shows the same disclaimer above the prompt button.

### Why the dirty-git-index refusal is non-negotiable

The fold-back skill refuses to run if `git status --porcelain` reports staged or unstaged changes. New maintainers may read this as overcautious — it's not. The mechanics:

**The git index is invisible to jj.** jj's data model has no concept of staging. Every file change is automatically part of the working-copy commit (`@`); `git add` writes to a structure jj never reads.

**`jj` operations rewrite the working tree but never touch the index.** When fold-back runs `jj bookmark` + `jj rebase` + `jj git push`, jj updates files on disk to materialize the rebased `@`. The git index is left pointing at whatever blobs the user staged earlier. After fold-back finishes, `git status` shows a confusingly-staged file whose blob no longer matches any commit jj knows about. If the user then instinctively runs `git commit`, they create a git-only commit on top of HEAD that jj has never seen — `jj`'s next auto-snapshot creates a *second* commit with the same content, and history bifurcates. This is the corruption mode the knoopx skill warns about.

**Why we can't auto-remediate.** `git reset` (no flags) is the one git mutation that's safe in a colocated repo (it only touches the index, which jj doesn't read). The skill *could* run it silently. We deliberately don't, for two reasons:

1. We don't know whether the staged content matches the working copy. If the user staged blob A then edited to blob B, `git reset` discards information that exists nowhere else.
2. We don't want the skill to model the habit of "silently mutate git state in a jj repo". The whole safety story rests on an explicit boundary; teach, don't auto-fix.

**`git stash` is forbidden, not just discouraged.** It resets the working tree, which jj sees on the next operation as the user reverting their work. jj auto-snapshots an "empty" `@`, and the user's actual changes survive only in jj's op log (and in `refs/stash`, which jj has no way to translate back). `git stash pop` later triggers a *second* unwanted snapshot. Two ghost commits, no clear way to recover. The jj-native equivalent of stash is `jj new` (or `jj describe -m WIP && jj new`) — it's already in the user's vocabulary if they're using jj, and the fold-back skill's refusal message points to it explicitly.

The skill's refusal message therefore offers three alternatives:

```
❌ Do not:  git stash         (forbidden — corrupts jj history)
✓  Safe:    git reset         (clears stale index, no jj effect)
✓  jj way:  jj new -m "WIP"   (move current work into a real change
                              and start fresh on top)
```

### Risk: Auto-detection runs `jj` against untrusted cwds

**Mitigation:** The probe runs `jj --version` then `jj st --no-pager` only if `.jj/` exists. Both are read-only. We never run `jj` in a cwd that doesn't contain `.jj/`. No write operations happen until the user explicitly clicks an action.

### Trade-off: Per-repo config vs global config

We chose **per-plugin config (one schema, applied globally)** over per-repo config. Per-repo would require a new persistence layer (each pinned folder gets a config blob). The plugin config schema's `workspaceRoot` and `allowDirectTrunkPush` are global defaults; if real users need per-repo overrides we add `.pi/jj-plugin.json` later.

## Migration Plan

This is a new plugin. No existing data to migrate.

The bridge's git-info poll is **extended in place**. The first dashboard restart after this change ships will see jj-aware sessions begin populating `Session.jjState` automatically; pre-existing sessions without `.jj/` see no change.

### Decision 10 — Forget refuses on unfolded work, force-flag escape hatch

**What:** `POST /api/jj/workspace/forget` rejects with HTTP 409 (`UNFOLDED_WORK`) when the workspace has commits between its branch point and `@` that aren't present on trunk. The client surfaces the list of unfolded commits in a confirm dialog and re-issues the request with `force: true` only after explicit user confirmation. On force, the server runs both `jj workspace forget` AND `rm -rf` on the directory.

**Why:** The default safety story — "forget means the work is gone" — is too dangerous given how easy it is to click the wrong button. The two-step (refuse, then force after confirmation) puts a hard pause on data loss. The unfolded commits are still in jj's op log after forget so `jj op restore` can recover them, but only for the op-log retention window.

**Why include `rm -rf` of the directory:** A bare `jj workspace forget` leaves the directory on disk in a stale state — the working copy still has files but jj no longer knows about it, which is just confusing. Cleaning the directory on forget matches user intent. The two-step dialog is what makes this safe.

### Decision 11 — Init-colocated affordance is opt-in, not always-shown

**What:** The "Enable jj workspaces" button on plain-git sessions is gated behind `showInitColocatedSuggestion: false` (default). Users who want the affordance enable it once in plugin settings.

**Why:** Always-showing the button is jj proselytization — some users actively don't want jj suggested. Hiding by default with an explicit opt-in respects the silent-when-not-installed principle (Decision 2) and keeps the plugin invisible until the user has decided they want it.

**Trade-off:** This makes discovery harder for users who'd benefit from jj but don't know it exists. We accept the trade because (a) the dashboard's docs / changelogs can mention the setting, (b) once enabled it stays enabled, (c) users who already have `jj` installed get the full UI on `.jj/` repos with no opt-in needed — the setting only gates the conversion path.

### Decision 12 — Fold-back conflicts auto-abandon to pre-rebase state

**What:** If `jj rebase` during fold-back produces conflicts, the skill captures the op-id before the rebase, runs the rebase, detects conflicts via `jj resolve --list`, then invokes `jj op restore <pre-rebase-op>` to undo the rebase entirely. The skill reports failure with conflict details and stops.

**Why:** The alternative — leaving the user in a half-finished rebase — produces a confusing state. Most users (and most agents) won't know how to drive `jj resolve` on partial rebases. Returning to known-good state is the path of least surprise. The user can then either:

- Resolve conflicts manually in the workspace and re-invoke fold-back.
- Rebase the workspace onto trunk first (`jj rebase -d trunk()`), resolve there, then fold back without conflicts.
- Abandon the workspace via the forget flow.

**Why not interactive resolution?** A future enhancement could prompt via `ask_user` mid-skill: "resolve conflicts in workspace, abandon, or rebase first?". For v1 we keep the skill atomic — either it succeeds cleanly or it doesn't run. Opening a mid-skill interaction surface adds testing complexity for a relatively rare path.

### Decision 13 — Bookmark name = workspace name verbatim by default

**What:** Fold-back's auto-derived bookmark name equals the workspace name (e.g. workspace `agent-1` produces bookmark `agent-1`). User can override with an explicit argument. Refuses if the bookmark already exists pointing at a different commit.

**Why:** Simplest possible mapping. `feat/<name>` was considered but assumes "feat" semantics that don't always apply (could be a bugfix, refactor, experiment). Verbatim names are predictable, debuggable, and match the workspace directory the user already sees. Users with conventions like `feat/` can supply the override.

### Decision 14 — Plugin config is global, no per-repo override

**What:** `workspaceRoot`, `defaultPushTarget`, `allowDirectTrunkPush`, `showInitColocatedSuggestion` are plugin-global. We do not read `.pi/jj-plugin.json` or any per-repo override file.

**Why:** Per-repo config doubles the surface area (two sources of truth, merge rules, persistence) for a use case we have no concrete user for yet. Users with genuinely-divergent needs across repos can either (a) call the REST endpoints directly with explicit args, or (b) we add per-repo override later as a separate change once the need is real. Premature flexibility is a real cost.

## Open Questions

- **Should `jj-workspace-fold-back` be exposed as a slash command (e.g. `/jj-fold`) or only as a skill?** Slash commands are easier to discover; skills can be more reactive. Probably both — the slash command invokes the skill.
- **Workspace names: enforce a regex or accept any string?** Locked: `/^[a-z0-9-]+$/`.
- **Should the `+ Workspace` action be available on the folder action bar (`folder-action-bar` slot) or only on individual session cards?** Folder-level might be more discoverable. Defer to a follow-up if needed.
- **`jj` minimum version** — the proposal pins `>= 0.18.0` provisionally; apply phase should verify against the actual command surface used (`workspace add -r`, `op restore`, `fork_point`).
