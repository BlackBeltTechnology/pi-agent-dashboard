## Context

This change builds on `add-session-actions-flyout` (under implementation). Line numbers below refer to its branch `os/add-session-actions-flyout` (worktree `.worktrees/os-add-session-actions-flyout`), which is this change's base. On `develop` the same code sits at different lines.

Current desktop header on that branch (`packages/client/src/components/session/SessionCard.tsx`):
- **Line 1** (`:1364`): status chip, name, time, `⋮` / Archive / Exit.
- **Line 2** (`:1459`): model + thinking level, then `MovedBadge` / `OriginDeviceChip` / `DriverChip` (`:1468`).
- **Line 3** (`:1473`): `ActivityIndicator` (`:1478`) as the shrink victim, then `HostPressureIndicator` (`:1480`), context bar, cost.
- **GIT subcard** (`GitSubcard`, `:2043`): renders only `GitInfo` (`:463`) when `showGitInfo || session.gitWorktree`. `GitInfo` renders branch, `#N`, `WorktreePill` (`:497`), `CwdGonePill` (`:498`), `GitDirtyPill`.

Other relevant code:
- `CwdGonePill` (`packages/client/src/components/folder/CwdGonePill.tsx`): 9 px uppercase, raw `red-*` classes.
- `GitDirtyPill` (`packages/client/src/components/worktree/GitDirtyPill.tsx:43-44`): `var(--status-warning, #d97706)`. `--status-warning` is not defined in `packages/client/src/index.css`.
- `PrSegment` (`packages/client/src/components/worktree/WorktreeActionsMenu.tsx:147`): private. It is the rich PR renderer (glyph, `#N`, state word, checks, `data-testid="worktree-pr-segment"`).
- `parseModelId` (`packages/shared/src/model-id.ts:11`): splits `provider/id` at the first slash.
- `showGitInfo` comes from `SessionList` (`group.sessions.length === 1`).
- The `git` section visibility is read via `useCardSectionVisible(session, "git")`.

Mockup with measured heights: `mockups/session-card-git-identity-row/index.html` (layout C chosen).

## Goals / Non-Goals

**Goals:**
- Identity, live state and model read top-down directly under the title, in one text column.
- Remove the GIT subcard. Measured card height at 340 px: worktree card 250 → 144 px, solo card about −26 px.
- On the desktop card, the missing-folder pill shows for every session whose folder is gone. The mobile card is out of scope and unchanged.
- The dirty pill meets WCAG AA in light theme.

**Non-Goals:**
- Changing the mobile card, the composer strip, the folder header layout or the session actions menu.
- Changing what `ActivityIndicator` / `HostPressureIndicator` / `GitDirtyPill` decide to show. Only their placement changes, plus the dirty pill's colours.
- Middle-ellipsis for long branch names. Noted as a follow-up only.
- Modifying `add-session-actions-flyout`.

## Decisions

**D1: Row order is status → git → meta (layout C).** The user chose C over A (meta then status) and B (status + model on one line). C answers "what is it doing now" first, then "where", then "with what". It keeps the tool text and pills on a full-width line, and keeps the model line stable while the session works. B was 20 px shorter but truncated both the tool text and the model at ≤ 340 px.

**D2: A shared text column at the name's left edge.** Rows 2–4 get a left margin equal to the desktop status chip width plus the title row gap. On the base branch that is 16 px (`w-4`, `packages/client/src/components/session/SessionStatusChip.tsx:89`) + 8 px (`gap-2`) = 24 px. The mockup approximated 30 px; the real value wins. Express it as one shared value next to the chip classes (for example a CSS custom property or an exported class constant) so a future chip resize moves the column with it. The status chip alone owns the left column. The 1 px alignment scenario is verified in the E2E harness, because jsdom has no layout.

**D3: Re-parent, don't rewrite.** `GitInfo` stays the component.
- It moves out of `GitSubcard` into the header and drops the `ml-4` indent.
- It renders `WorktreePill` first and drops `CwdGonePill`.
- It renders `PrSegment` instead of the plain `#N`. `PrSegment` is exported from `WorktreeActionsMenu.tsx` with a defaulted `className` and is otherwise **unchanged**, colours included. Its raw tone ramp (`WorktreeActionsMenu.tsx:129-134`) predates this change and lives outside the files that `message-severity-tokens` › "No raw colour literals on aligned action surfaces" lists. A severity retoken would also need a fill (tint/severity foregrounds may not sit bare on a surface) and would change the composer strip, so it is out of scope. Follow-up candidate.
- `flex-shrink-0` for `GitDirtyPill` is passed through its existing `className` prop from `GitInfo`, so the folder header's `GroupGitInfo` layout is untouched.
- **Overflow:** the row is `flex flex-wrap`. The branch is `grow basis-[6ch] min-w-0 truncate`, so it truncates first; the pills wrap to a second git line only when even 6 characters of branch don't fit.

`GitSubcard` is deleted. Its gate becomes the git-row gate, now also requiring the `git` section visibility (`showGit` already wraps `GitSubcard` today).

Edits to `WorktreeActionsMenu.tsx` happen only after `add-session-actions-flyout` has merged, because that change is still editing the file (task 1.1).

**D3b: Header extras keep their order after the four rows.** The OpenSpec activity badge line (`SessionCard.tsx:1496` on develop), the tag strip and the pi-below-floor warning currently render between line 3 and the subcards. They stay there, now after the meta row. The worktree card-slot wrapper stays directly after OPENSPEC (`SessionCard.tsx:1602-1617` on the base branch), so with GIT gone it precedes STATUS and keeps its `mt-2.5` stacking.

**D4: Session chips stay on the meta row.** Explore mode floated moving Moved / Origin / Driver to the title row. Keeping them next to the model is the smaller diff, and the title row already holds the name, the missing-folder pill, the time and three controls.

**D5: Model id only.** When `session.model` is set, display `parseModelId(session.model).modelId` (falling back to the full value when that is empty, e.g. `"anthropic/"`) plus the thinking level, and put the full value in `title`. The meta row is `flex flex-wrap`, with the model as `grow basis-[6ch] min-w-0 truncate`, the same overflow technique as the git row (D3). `parseModelId` takes a required string (`packages/shared/src/model-id.ts:11`, while `DashboardSession.model` is optional), so keep today's `session.model &&` guard. `parseModelId` already handles values without `/`.

**D6: Missing-folder pill in the title row, gate `cwdMissing` only.** `CwdGonePill` gains title-row styling (11 px, normal case, `--tint-red-*`, `flex-shrink-0`) and keeps its testid.
- The label key is `common.cwdGone`; the English source is `packages/client/src/lib/i18n-en-source.json`, plus `i18n-hu.ts` and `i18n-zh-CN.ts`. The new value is `folder missing`.
- The tooltip key `folders.sessionSDirectoryNoLongerExists` already exists (`i18n-en-source.json:614`, `i18n-hu.ts:1076`, `i18n-zh-CN.ts:575`; sole consumer `CwdGonePill.tsx:17`). Its values are **updated in place**, with no new key:
  - en: "This session's folder no longer exists"
  - hu: "A munkamenet mappája már nem létezik"
  - zh-CN: "此会话的文件夹已不存在"
- `common.cwdGone` values: en `folder missing`, hu `a mappa hiányzik`, zh-CN `文件夹缺失`.
- `session.cwdMissing` (the disabled-button tooltip) is left alone.
- The legacy alias `auto.cwd_gone` → `common.cwdGone` is unchanged.

"Missing" holds whatever the cause; the server check only tests existence.

**D7: Dirty pill tokens.** Replace the inline `var(--status-warning, #d97706)` (`GitDirtyPill.tsx:43-44`) with the filled `--severity-warning-bg` / `-fg` / `-border` triple. That triple resolves through `--tint-orange-*` (`index.css:200-202`, aliases `:213-219`). `message-severity-tokens` › "Identity tint triples with severity aliases" requires a foreground to sit on its matching fill and severity meaning to use `--severity-*`, and an uncommitted count is a warning. The pill then has the same capsule look as the worktree pill.
- **Contrast of fg on its own fill:** 7.82:1 dark, 6.13:1 light, measured with the computed-contrast probe in the mockup on the worktree pill, which uses the identical formula.
- **Reference only:** the bare-surface numbers below show the old raw fallback's failure.

`--tint-orange-fg` on bare surfaces, computed from its `color-mix` definition:

| Theme | `--bg-primary` | `--bg-secondary` | `--bg-tertiary` |
|---|---|---|---|
| Dark (≈ `#eeb186`) | 10.60 | 9.86 | 8.92 |
| Light (≈ `#814318`) | 7.66 | 7.34 | 6.72 |
| Old `#d97706`, light | 3.19 | 3.05 | 2.80 |

`--bg-surface` measures about 5.8:1 (light `#e0e0e0`) and 7.6:1 (dark `#2a2a2a`). The folder header renders on these same base surfaces. The ahead / behind chips keep `--text-secondary` (`#b0b0b0` dark / `#444444` light). They are at least 6.6:1 on every base surface above (lowest: dark `--bg-surface`). No new token is introduced. For non-base palettes the tint tokens recompute from each palette's `--text-primary` / `--bg-tertiary`; the 4.4 visual check records them but does not gate.

**D8: Empty rows don't render.**
- **Status row:** omitted when both indicators would return null. The parent cannot observe a child returning null, and the indicators depend on a hook (`useHasWidgetBarPrompt`) and a clock (`deriveHostPressure(session, Date.now())`, 5 s ticker).
  - The card reads the hook once and owns **one clock**: a card-level 5 s interval that replaces `HostPressureIndicator`'s own and, like today's (`SessionCard.tsx:293-304`), runs only while `session.hostPressure != null`. The `now` prop is not a clock: `SessionList.tsx:401` computes `const now = Date.now()` per render, so quiet sessions would never advance.
  - Both the hook read and the clock state are declared **above** the `if (isMobile)` early return (`SessionCard.tsx:1160`), per the Rules of Hooks. Both branches receive them.
  - `ask-user-card-indicator`'s suppression scenario stays satisfied: the value still comes from `useHasWidgetBarPrompt(session.id)`, just read once by the card.
  - The **complete** `ActivityIndicator` branch list is extracted into a pure `activityContent(session, retryAttempt, hasWidgetBarPrompt)`: resuming, ended reason including its null cases, `awaitingFileAccess` bypassing widget-bar suppression, Needs you, retry, tool, thinking, idle. Host pressure gets `hostPressureLevel(session, now)`.
  - Both indicators become presentational over these injected values, and the row gate uses the same values. One branching site, one clock, so there is no disagreement at a threshold boundary.
  - The **mobile branch** (`SessionCard.tsx:1204-1205`) passes the same injected values. Its rendered output is unchanged (scenario-covered); only the call site changes.
- **Git row:** follows its gate.
- **Meta row:** omitted when there is no model, no session chip, the context-bar preference is off, and there is no cost. A pure `metaChipsVisible(session)` exposes the existing predicates of `MovedBadge` (`hasMovedAway`), `OriginDeviceChip` (`isRemoteOrigin`) and `DriverChip`, and each chip uses it, so the gate and the chips cannot disagree. Like the git row, it wraps its trailing items rather than overflowing (model keeps 6 characters' width). `ContextUsageBar` never returns null; it shows "No context data", so the preference is the visibility signal.

This avoids blank 18 px bands for sessions with no activity or no git.

**D9: Duplicated scenario coverage is accepted.** `session-card-subcards` keeps the worktree-pill and missing-folder requirements, because their main-spec scenarios cannot be dropped by a MODIFIED delta. Placement rules live in `session-card-header`, and the subcards text points there. Some scenarios assert the same fact twice. That is cheaper than RENAME-and-REMOVE churn on requirements other specs reference.

## Risks / Trade-offs

- **Spec ordering:** this change MODIFIES two requirements that `add-session-actions-flyout` also MODIFIES: `session-card-section-visibility` › "Toggleable section set" and "Inline legend menu". It also REMOVES the flyout's version of the six-subcard requirement. Mitigations:
  - `## Dependencies` in the proposal, and archive order flyout → this.
  - Before archiving, re-diff this change's copies of "Toggleable section set" and "Inline legend menu" against the flyout's archived text. They must be identical apart from the git-row wording and the added "Hiding git removes the header git row" scenario. Also confirm the six-subcard requirement this change removes still carries that name. The flyout is still being implemented, so its text may still move.
- **`extract-git-as-plugin` (proposal-only draft, no tasks or specs, stale paths):** it plans to move `GitInfo` into the `session-card-badge` slot (STATUS subcard). After this change, `GitInfo` is a header row, so that extraction would need a header slot instead. Recorded as a coordination note in the proposal; that change is not modified here.
- **Tests asserting the GIT subcard:** existing unit and e2e tests query `GIT` / worktree pill inside the subcard. They will fail by design and must be updated, not deleted.
- **Title-row crowding at 260 px** with a long name + missing-folder pill + 3 controls. The name is the shrink victim (scenario-covered).
- **Folder header colour shift:** the dirty pill on the folder header changes from a bare `#d97706` outline to the filled severity-warning capsule (it's the same component). Visible but intended; layout unchanged.
- **Stale example text:** `directory-card-layout` (`spec.md:119`, `:145`) names "OPENSPEC / GIT / PROCESS subcards" as an example of the capsule-legend style. It is still a valid style reference, so it is not modified here.

## Migration Plan

Client-only. No protocol, server or persisted-state change. Ship after `add-session-actions-flyout` merges. Rollback = revert the commit; no data to migrate.

## Open Questions

None. All five explore-mode questions were resolved: label `folder missing`, `git` toggle governs the row, model id only, rich PR status, dirty-pill contrast fixed here.
