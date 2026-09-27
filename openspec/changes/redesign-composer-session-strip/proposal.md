## Why

The composer's session strip (OpenSpec · Git · Quota · Status) is hard to scan. Its grouping cues are upside down:
- **Every chip has its own border**, so each chip looks like its own group.
- **The groups themselves** are separated only by a 1 px divider and a 9 px muted label.
- **Spacing is the same everywhere:** the gap between groups equals the gap inside a group (`gap-1`).

The Git group also leaves out what a worktree session most needs to see:
- which branch or worktree it is,
- whether it's dirty, ahead or behind,
- whether it has a PR, and that PR's state and CI result.

Today a PR shows up only as a "View PR #N" button label.

Inside the composer card, the 44 px send/stop button shares a row with 30 px toolbar items. That button and the terminal control look detached from the text field they act on. The textarea also draws a second focus ring inside the card's focus border.

PR #745 (`compact-openspec-lifecycle-bar`) has merged. It introduced the 5-segment lifecycle bar and the "one primary action + `⋯`" model for the session card. The composer is now the only surface still using the older P/D/S/T chips.

Mockups (reviewed during explore): `mockups/index.html` (variant H), `mockups/placement.html` (placement 1), `mockups/composer.html` (variant A).

## What Changes

- **Group containers.** Each strip group (OpenSpec, Git, plugin groups such as Quota, Status) renders as one labelled `role="group"` container, and the host's own items drop their own borders. Groups are spaced wider apart than the items inside them. A group wider than the strip wraps inside itself instead of overflowing. Read-only groups (e.g. Quota) get a dashed, unfilled treatment so they look different from action groups. One shared primitive serves both host groups and `composer-context-group` plugins.
- **OpenSpec group adopts #745's model:**
  - It uses the 5-segment lifecycle bar in letters mode, plus one primary action per `ChangeState` and a `⋯` overflow for the remaining workflow actions.
  - This replaces the P/D/S/T chips and the separate action buttons.
- **Attach/detach on a change chip:**
  - Unattached: a dashed `📎 Attach change…` chip opens the change picker, next to Explore.
  - Attached: the chip is the change name and opens *Open proposal / Detach*.
  - The session card keeps Detach in its `⋯`.
- **Git group shows worktree identity:**
  - branch name,
  - `← <base>` when known,
  - dirty count and ahead/behind from the existing `gitStatus`,
  - a tooltip with the worktree name and main checkout path.
- **PR status segment:**
  - It shows number, state (draft/open/merged/closed) and CI checks (passing/failing/pending), and links to the PR.
  - Actions after it depend on PR state.
  - Merge renders as the filled primary action **only** when the PR is open, not a draft, checks are passing (or there is no CI), and either no change is attached or the attached change is COMPLETE. Otherwise it is outlined. When Merge is filled, the OpenSpec primary is outlined, on both the composer and the session card.
  - Failing checks produce a warning in the merge confirm dialog.
  - Close stays apart, after an inner divider.
- **PR status data:**
  - The bridge extension extends PR detection from number-only to `{ number, state, isDraft, checks }`.
  - It runs asynchronously (today's number-only lookup blocks the bridge for up to 15 s), on a slower cadence than the 30 s git poll (every 120 s, with back-off on failure).
  - It also refreshes right after Push and Open PR. Merge is local, so it doesn't change GitHub state and doesn't trigger a refresh.
  - The new fields in the session protocol are **optional**. Older bridges keep today's number-only behaviour.
- **Composer internals:**
  - Terminal and send/stop move into the text-field row, aligned to its bottom edge.
  - The toolbar row keeps only the message settings (＋, model, thinking, Steer/Queue).
  - Stop-after-turn becomes one split control with Stop, `[◎ after turn | ■]`. The action button stays 44 px.
  - The textarea's inner focus ring is removed; the card border shows focus.
- **Empty STATUS group.** It no longer renders when the badge component renders nothing.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `chat-view`:
  - The unified-composer requirement changes: strip grouping, OpenSpec lifecycle bar + primary + `⋯`, change chip with attach/detach, and composer internal layout.
  - The morphing action button changes: split stop-after-turn, input-row placement.
  - The mobile composer adaptation changes: which row stays persistent.
- `dashboard-shell-slots`: the `ComposerContextGroup` primitive renders the shared group container used by host groups, plus a read-only variant.
- `worktree-lifecycle`: `WorktreeActionsMenu` shows the PR status segment instead of the "View PR #N" label, gains the conditional Merge primary rule, and the merge confirm dialog warns on failing checks.
- `git-context`:
  - PR detection returns state, draft flag and a checks summary.
  - PR status refreshes separately from the 30 s git poll, and immediately after worktree actions.
  - Worktree identity is shown in the composer Git group.

## Impact

- **Client:**
  - `packages/client/src/components/session/ComposerSessionActions.tsx` (group rendering, OpenSpec model, change chip).
  - `packages/client/src/components/chat/CommandInput.tsx` (input row, split stop, focus ring).
  - `packages/client/src/components/worktree/WorktreeActionsMenu.tsx` and `MergeConfirmDialog`.
  - It reuses #745's `OpenSpecStepper` / `.openspec-seg*` CSS, `OverflowMenu`, and `GroupedAttachDialog` / attach picker.
  - i18n keys are added and removed.
- **Plugin runtime:** `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` (`ComposerContextGroup`). This is a visual contract change for plugins; the API shape is unchanged. The quota plugin inherits the new look.
- **Shared / protocol:** `packages/shared/src/protocol.ts` and `types.ts` get optional `gitPrState`, `gitPrDraft` and `gitPrChecks` fields. `shared/src/platform/git.ts` gets the `GH_PR_STATUS` recipe.
- **Extension:** `vcs-info.ts`, `model-tracker.ts`, `git-poll.ts` (PR cadence, dedup). **Server:** `event-wiring.ts` (field pass-through).
- **Compatibility:** all protocol additions are optional. An old bridge with a new client falls back to number-only. A new bridge with an old client ignores the fields. There is no persisted-data migration.
- **Rollback:** revert the change. Nothing persisted depends on the new fields.
- **Tests:**
  - Unit tests for `ComposerSessionActions`, `CommandInput`, `WorktreeActionsMenu`, `vcs-info` and the `git-poll` cadence.
  - Playwright composer specs that assert on the button test IDs; the IDs are preserved but the layout assertions change.
- **Dependency:** built on #745, which is merged into `develop`.

## Discipline Skills

- `performance-optimization`: the PR-status refresh adds `gh` calls per session. The cadence and dedup must keep the GitHub API rate limit and bridge CPU within budget.
- `observability-instrumentation`: the new external call (`gh pr view --json …`) needs failure and back-off logging so a stuck or failing PR probe can be diagnosed.
- `doubt-driven-review`: before the protocol fields and the plugin-visible `ComposerContextGroup` contract change are finalized, since both are hard to reverse once shipped.
