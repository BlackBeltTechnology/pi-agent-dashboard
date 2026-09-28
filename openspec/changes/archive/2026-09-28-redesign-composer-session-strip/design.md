## Context

- The strip is `ComposerSessionActions.tsx`, rendered inside `App.tsx`'s `composer-context-strip` row (next to `StatusBarRefreshButton` and `ChatViewMenu`) above the `CommandInput` card. The placement is kept (`mockups/placement.html` §1).
  - Host groups use private `Divider` / `GroupLabel`, which emit `composer-{openspec,git,status}-group-label`.
  - **Content** nodes carry `composer-git-group` (span around `WorktreeActionsMenu`) and `composer-status-group` (the `<fieldset disabled>`).
  - Items are bordered `IconButton`s (`text-[10px] px-1 py-0.5`, ≈18 px tall).
- Plugin groups use `ComposerContextGroup` (`dashboard-plugin-runtime/src/slot-consumers.tsx`), a `<span>` that copies the host classes and guards `testId` before emitting `${testId}-label`. The host was deliberately not moved onto it, because a `<fieldset>` is illegal inside a `<span>`.
- #745 (merged) provides:
  - `OpenSpecStepper`: hard-coded IDs `openspec-stepper` / `stepper-segment-*`; `.openspec-lifecycle-bar { width:100%; container-type:inline-size }`; letters at `@container (width < 250px)`; its own `role="group"`.
  - The primary/overflow logic private to `SessionOpenSpecActions.tsx`:
    - depends on `isEnded`, `streaming`, `showArchiveAnyway`, `wf()` and handlers;
    - renders the primary with **`aria-disabled` + tooltip** while streaming (asserted by tests), not native `disabled`;
    - the overflow includes `explore-menu-item`;
    - unattached, it offers New / Propose / Bulk-archive (wf-gated) and the attach picker (`GroupedAttachDialog` with `groups` / `assignments`).
  - The composer still renders `ArtifactChip`s. `state-feedback-adoption.test.tsx` asserts the composer file text contains `statusPresentation` and `statusAriaLabel`.
- PR data today:
  - Senders:
    - `gatherGitInfo` → `detectPrNumber` → `git.prNumberOr` → `run()` = **`spawnSync`** (`GIT_TIMEOUT` 15 s), on every 30 s tick per session;
    - `session-sync.ts` sends a register/reconnect `git_info_update` from the same function.
  - `model-tracker.ts` diffs only branch / PR number / worktree / status.
  - `GH_PR_NUMBER` tolerates exit 1, which `gh` uses for "no pull requests found" and for generic errors.
  - `event-wiring.ts` assigns `gitPrNumber` / `gitPrUrl` **unconditionally**; `gitStatus` uses the guarded `!== undefined` pattern.
  - PR fields are **not** persisted to `.meta.json`; they are rebuilt from live updates.
  - An old bridge ignores unknown server messages.
  - `BridgeContext.sessionId` is mutated on new/fork/resume.
- `collapseCheckRollup` exists in `server/src/git-worktree/git-operations.ts`, used by `listPullRequests` → `PrCombobox`. It reads only CheckRun `status` / `conclusion`, so a successful StatusContext is miscounted as pending.
- `WorktreeActionsMenu`:
  - "Merge" is a **local** merge into base in `mainPath`; GitHub state is untouched;
  - it renders in the card's `GitSubcard` (props `{session, showGitInfo, allSessions, onShutdownSession, menu}`; no `disabled`) and in the composer strip (`disabled={streaming}`);
  - `MergeConfirmDialog` props are `{cwd, onClose, onMerged}`;
  - tests assert "View PR #N".
- `CommandInput`:
  - one `flex items-center` toolbar row;
  - the action button is `min-w/h-[44px]` (asserted);
  - stop-after-turn IDs are `stop-after-turn-button` / `stop-after-turn-pill`;
  - working = `status === "streaming" || retrying` (`SessionStatus` has no `retrying`; the retry projection exposes `retrySessionIds`);
  - the textarea has `focus-ring` inside a card with a 60 % accent focus border.

## Goals / Non-Goals

**Goals:**
- One group container for host groups and plugins.
- The composer and the session card derive their OpenSpec primary / overflow and Merge emphasis from the same functions and the same working-state definition.
- PR detection never blocks a bridge tick. Steady-state cost is ≤ 30 `gh` invocations/h per session, measured.
- Existing test IDs are preserved; new controls get new, prefixed IDs. Tests asserting the old structure are updated by named tasks.

**Non-Goals:**
- Moving the strip into the card.
- GitHub-side PR merge.
- Per-cwd dedup of PR probes across sessions (D5).
- Roving-tabindex keyboard navigation for the strip (no `role="toolbar"`).
- PR state for non-GitHub forges; they keep today's number-only best effort.
- An upstream-tracking flag. Drift markers reflect only `gitStatus` as it exists.

## Decisions

### D1 — One `ToolbarGroup` primitive; `ComposerContextGroup` wraps it
- A new `ToolbarGroup({ label, variant: "actions" | "info", testId?, labelTestId?, children })` in `dashboard-plugin-runtime` renders `<div data-group role="group" aria-labelledby={useId()}>`:
  - The label is a leading `<span id>`, with `data-testid = labelTestId ?? (testId ? \`${testId}-label\` : undefined)`. The guard means there is never an `"undefined-label"`.
  - Children go in `<div data-group-content>`, unless the caller supplies its own content element (D8).
  - `actions`: 1 px `--border-secondary` outline, `--bg-tertiary` fill, label segment on `--bg-surface`, hairline separators between direct child segments; item hit areas ≥ 24×24 px (WCAG 2.5.8).
  - `info`: dashed outline, no fill, no group-level hover. Interactive children keep their own affordances.
- Wrapping: `flex: 0 1 auto; min-width: 0`; content `flex-wrap: wrap`. A group moves to the next strip line as a unit. A group wider than the strip wraps *internally*, with the label kept beside its first item.
- `ComposerContextGroup({label, children, testId})`: same signature, delegates with `variant:"info"`. Plugins need no code change. The in-repo quota plugin removes its now-redundant inline chip borders in its own task.
- Host groups: `ToolbarGroup` with `labelTestId` reproducing `composer-{openspec,git,status}-group-label`. The content nodes keep `composer-git-group` / `composer-status-group`. The containers get new IDs `composer-{openspec,git,status}-container`.
- The composer's `IconButton` variants lose their `border` classes (colour stays on text/icon; hover fill), with `min-h-6 min-w-6`.
- No `role="toolbar"`, because it would promise arrow-key roving (Non-Goal).
- *Alternative:* a filled pill with borderless items (mockup variant A). Rejected for Git; one segmented style (variant H).

### D2 — Share #745's derivation via a pure function
- `components/openspec/openspec-actions.ts` exports `deriveOpenSpecActions(ctx) → { primary?: ActionSpec; overflow: ActionSpec[]; unattached: ActionSpec[] }`:
  - `ctx = { attached, found, state, wf, isEnded, working, showArchiveAnyway, includeDetach, idPrefix }`;
  - `ActionSpec = { key, labelKey, icon, testId, blocked, blockedReasonKey? }`.
- Both surfaces render a `blocked` item with **`aria-disabled="true"` + tooltip** (#745's pattern: keeps focus and the reason reachable), and their click handlers no-op. Handlers are wired per component through a `key → handler` map, so the function holds no closures.
- Covered:
  - attached (primary + overflow incl. Explore…, Archive anyway…, Detach when `includeDetach`);
  - attached-but-not-found or ended (Detach only);
  - unattached (New… / Propose… / Explore, wf-gated; bulk-archive stays card-only as a folder-level action).
- `OverflowMenu` is exported. `SessionOpenSpecActions` uses `idPrefix: ""` (IDs unchanged; #745 tests unchanged). The composer uses `idPrefix: "composer-"`.
- `OpenSpecStepper` gains `testIdPrefix?: string` (default `""`). The composer passes `"composer-"` → `composer-openspec-stepper` / `composer-stepper-segment-*`, so there are no duplicates when card and chat are both mounted.
- The composer places the stepper in a `flex-shrink:0` box of width `--composer-lifecycle-w` (9.5rem). This gives the inline-size container a definite width under 250 px, making letters mode deterministic.
- `ArtifactChip` and `composer-artifact-*` / `composer-tasks-underline` are removed. `state-feedback-adoption.test.tsx` drops its composer entry, since the lifecycle bar now carries the status presentation.

### D3 — Change chip = attach/detach surface
- **Unattached:** a dashed `📎 Attach change…` chip opens the same picker as the card: `GroupedAttachDialog` when `groups` exist, else the flat list. `ComposerSessionActions` gains `groups` / `assignments` / `onAttach` / `onDetach` props, wired in `App.tsx` from the card's sources.
  - With no changes it renders disabled as "No changes".
  - Explore sits beside it; New… / Propose… live in a `⋯`.
- **Attached:** the chip shows the name (truncated, full in `title`) + `▾` and opens a `client-utils` `Popover` portalled to the body with `Open proposal` and `Detach`. Focus goes to the first item on open and back to the chip on close. No "Switch change"; users detach then attach, as on the card.
- Attach/Detach are not gated on working (they change session metadata, as on the card).

### D4 — Git identity segment from existing fields
- `⎇ <gitBranch>` renders only when present; `← <gitWorktree.base>` only when present.
- With `gitStatus` present:
  - `● <dirtyCount>` when > 0;
  - `↑<ahead>` / `↓<behind>` when > 0;
  - otherwise `✓` with the text "no local changes". It deliberately does **not** claim "in sync", because `ahead`/`behind` are 0 without an upstream.
- With `gitStatus` absent: no drift or no-changes marker.
- Every marker has a text alternative. The segment `title` gives the worktree name + `mainPath`.

### D5 — PR status: async, own cadence, one change-detector
- **Shared helpers** in `shared/src/platform/`:
  - a `GH_PR_STATUS` recipe running `gh pr view --json number,url,state,isDraft,statusCheckRollup` via **`runAsync`** with a 20 s timeout (a timeout is a `failure`);
  - `collapseCheckRollup` moved from the server into shared and extended. The server (`listPullRequests`) and the bridge both import it:
    - discriminate by `__typename`: `CheckRun` (`status` / `conclusion`) vs `StatusContext` (`state`);
    - failing: CheckRun `conclusion` ∈ {FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE, STALE}; StatusContext `state` ∈ {FAILURE, ERROR};
    - pending: CheckRun `status` ≠ COMPLETED; StatusContext `state` ∈ {PENDING, EXPECTED}; any unrecognized value;
    - passing: anything else present, including all-NEUTRAL/SKIPPED (keeps `PrCombobox`'s current behavior; GitHub doesn't block on those);
    - `none`: an empty rollup.
- **Classification:**
  - exit 0 → parse (state lowercased);
  - exit 1 with stderr matching `no pull requests found` → `absent`;
  - everything else → `failure`.
- **Sync call removed:** `gatherGitInfo` no longer calls `detectPrNumber`; `vcs-info.test.ts` is updated.
- **Scheduler** (`extension/src/pr-status.ts`, one per `BridgeContext`):
  - Holds the cached tuple `pr = { gitPrNumber, gitPrUrl, gitPrState, gitPrDraft, gitPrChecks, gitPrCheckedAt }` and a generation token = `sessionId + cwd + branch`.
  - Each field is `undefined` (unknown: initial state and after a generation change, omitted on the wire), `null` (known-absent) or a value. `gitPrCheckedAt` is the epoch ms of the last successful detection.
  - Any generation change (new / fork / resume, cwd change, branch change) resets the tuple to unknown. A bridge *restart* therefore shows no PR until the first probe lands (accepted).
  - Probes on first registration (immediately), when ≥ 120 s have passed since the last probe, on branch change, and on `git_info_refresh`.
  - At most one probe is in flight. A forced request arriving mid-flight sets `forcePending`, which runs one more probe as soon as the current one settles, so it is never dropped. At most one forced probe starts per 30 s; extra forced requests coalesce into it.
  - A counter of `gh` invocations per session is exposed through the bridge's existing debug/health surface for task 7.4.
  - A result whose generation token no longer matches is discarded.
  - On branch change the tuple is sent as all-`null` immediately (the server clears it), so no update after the change carries the old PR; the probe fills it in.
  - On failure: keep the tuple (same generation), back off 120 → 240 → 480 → 600 s cap, log once on entry and once on recovery.
- **One change-detector:** `sendGitInfoIfChanged` diffs `branch + worktree + status + the full pr tuple` and always includes the tuple.
  - The scheduler calls the same function when a probe resolves.
  - `session-sync.ts` (register/reconnect) includes the cached tuple, and on first registration kicks the scheduler.
  - `lastGitPrNumber` bookkeeping is replaced by the tuple.
- **Wire:**
  - `GitInfoUpdateMessage` and `DashboardSession`: `gitPrNumber?: number | null`, `gitPrUrl?: string | null`, plus the new `gitPrState?`, `gitPrDraft?`, `gitPrChecks?` (each `| null`).
  - The server assigns the new fields with the `!== undefined` guard: `null` clears, absent (old bridge) leaves them unset. Number/url stay unconditional, as today; the new bridge always sends them.
  - Old clients already test `gitPrNumber != null`.
- **Refresh:**
  - After a successful Push or Open PR, the server normalizes the worktree root with `safeRealpathSync` and sends `git_info_refresh { reason: "push" | "pr" }` to every bridge whose session cwd, normalized with `safeRealpathSync` (`server/src/resolve-path.ts`), is the worktree root or inside it. Merge is local, so it sends none.
  - On receipt the bridge forces a probe.
  - For `reason: "pr"` only, if the result is `absent` (GitHub lag), it retries at +5 s and +15 s.
- **Cost:**
  - Steady state is 30 invocations/h per session (20 sessions ≈ 600/h), plus bounded refresh bursts.
  - Each invocation is one GraphQL query. Its point cost is **measured** in task 7.4 via `gh api rate_limit` deltas, not asserted.
  - *Alternative:* a server-side per-cwd poller (dedups sessions sharing a cwd). Deferred.

### D6 — PR segment, actions, one Merge-emphasis decision per surface
- `WorktreeActionsMenu` replaces "View PR #N" with the segment:
  - `◌ #N draft`;
  - `● #N open` + `✓ passing` / `✕ failing` / `… pending` (glyph + word or `aria-label`);
  - `⑂ #N merged`;
  - `⊘ #N closed`.
  - It is a link when `gitPrUrl` is present, plain text otherwise; number-only when the state fields are absent.
  - It also appears in the mobile action sheet.
- Closed and merged segments show no checks marker (the checks belong to a PR that no longer gates anything).
- **Actions:**
  - no PR / closed → Push, Open PR (gh-gated), Merge;
  - open / draft → Push, Merge;
  - merged → Push only when `gitStatus.ahead > 0`, no Merge.
  - Close is always last, after a separator.
  - Merge's filled/outlined rule applies only when Merge renders.
- Pure `isMergePrimary({ hasWorktree, prState, prDraft, prChecks, attached, attachedChangeState })` in `client/src/lib/git/merge-primary.ts`. It returns true iff:
  - `hasWorktree`,
  - `prState === "open"`,
  - `!prDraft`,
  - `prChecks ∈ {"passing","none"}`,
  - `gitPrCheckedAt` within the last 15 min,
  - `!working` (a disabled Merge is never the filled primary),
  - and (`!attached` ∨ `attachedChangeState === COMPLETE`).
  - Attached with unknown state ⇒ false.
- **Evaluated once per surface:** `SessionCard` and `ComposerSessionActions` each compute it once and pass the resulting `mergeIsPrimary` boolean down to both their `WorktreeActionsMenu` (fills Merge) and their OpenSpec actions (outlines their primary). `SessionCard` threads it and the working flag through `GitSubcard`.
- `MergeConfirmDialog` gains `prNumber?` / `prChecks?`. It shows a non-blocking warning for `failing` / `pending` ("PR #742 checks are failing" / "…still running") on an open PR, and "PR status may be stale" when `gitPrCheckedAt` is older than 15 min.

### D7 — Composer input row
- Card: attachments → **input row** `[textarea | terminal · action]` (`items-end`) → hairline → **settings row** `[＋ · model · thinking · Steer|Queue]`, plus `⋯` only when folded.
- The `@[44rem]` fold is unchanged: thinking, delivery and terminal move into `⋯`, as today.
- The action button keeps `min-w/h-[44px]`.
- While working, `stop-after-turn-button` + the stop button form one split control `[◎ after turn | ■]`. The label collapses to `◎` below `@[30rem]` with its `aria-label` kept; `stop-after-turn-pill` is unchanged.
- Action IDs are unchanged.
- The textarea loses `focus-ring`. The focused card border uses **full-strength** `--accent` (≥ 3:1 per the index.css accent contract).
- Resting height: two rows as today (textarea + one control row). Only row membership changes.

### D8 — Empty Status group
- The Status group passes its `<fieldset disabled={working} data-testid="composer-status-group" data-group-content>` as the content element.
- CSS: `[data-group]:has(> [data-group-content]:empty) { display:none }`. Slot error-boundary and provider layers render no DOM, so a `null` badge leaves the fieldset `:empty`.
- Verified by a Playwright test folded from the test plan (jsdom can't).
- Fallback if a slot layer is found to emit DOM: a render probe. That is an implementation detail, not a spec change.

### D9 — One working-state definition on both surfaces
- `working = status === "streaming" || retrySessionIds.has(id)`. It gates the composer strip, `SessionOpenSpecActions`, and **both** `WorktreeActionsMenu` instances; the card now passes `disabled={working}`, closing its pre-existing race.
- The OpenSpec group's visibility gate is unchanged from shipped code: `openspecReadiness` READY/PENDING (fallback `hasOpenspecDir !== false || pending`) ∧ not ended.

## Risks / Trade-offs

- [Plugin visual and accessibility contract changes for every `composer-context-group` claimant: plugin groups become named `role="group"` regions] → The API is unchanged; E15 is updated; CHANGELOG note covers both. The in-repo quota plugin is adjusted.
- [After a local Merge the GitHub PR stays open and green, so Merge stays the filled primary] → Accepted. The next step is Close worktree; a local-merge marker is out of scope.
- [`collapseCheckRollup` now reads StatusContext] → `PrCombobox` pills become more accurate for status-API CI (success no longer shows as pending). This is a behavior improvement, covered by its tests.
- [`gh` stderr wording changes] → An unrecognized exit 1 counts as a failure: back off and keep the last value. Stale-but-safe, never a false "no PR".
- [Two sessions on one cwd both probe] → Accepted (Non-Goal); bounded by cadence.
- [`:has()` / `:empty` unsupported in an old browser] → The empty STATUS label shows, as today.
- [Test churn] → Named tasks for:
  - `ComposerSessionActions.test.tsx`, `WorktreeActionsMenu.test.tsx`, `vcs-info.test.ts`, `slot-consumers.test.tsx` E15, `state-feedback-adoption.test.tsx`;
  - the Playwright helpers + unscoped `stepper-segment-*` queries.

## Migration Plan

- No data migration: PR fields aren't persisted, and the new fields are optional (`absent` = unknown, `null` = known-absent).
- Mixed versions:
  - old bridge → number-only UI, Merge outlined;
  - old client → ignores the new fields (it already null-checks the number);
  - old bridge → ignores `git_info_refresh`.
- Deploy in any order: extension → `npm run reload`; server/shared → `/api/restart`; client → build + restart.
- Rollback: revert the commit.
