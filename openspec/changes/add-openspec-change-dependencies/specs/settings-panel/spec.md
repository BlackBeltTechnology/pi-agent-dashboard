## MODIFIED Requirements

### Requirement: OpenSpec Workflow Schema section

The OpenSpec settings page (`/settings/openspec`, the page `CONFIG_FIELD_PAGE` maps the `openspec` key to) SHALL include an "OpenSpec Workflow Schema" section, separate from the "OpenSpec Workflow Profile" section. The folder-section notice chip deep-links to `/settings/openspec?cwd=<cwd>#workflow-schema`. Its visual design follows the approved mockup `openspec/changes/add-pi-spec-driven-schema/mockups/` (`ui-plan.md` D1–D10, `audit.md` approval) and the tokens and recipes of `ui-contract.md`; it uses no raw palette colour classes. It SHALL contain:
- an intro stating that pi-spec-driven is the dashboard's OpenSpec workflow with an explicit "Not needed" design skip, and that per-project actions write files immediately after confirmation while the default switch waits for Save;
- a **Default for new projects** switch bound to `openspec.workflowSchema.defaultForNewProjects`. It buffers into the Settings draft and is persisted only through the unified Save (`PUT /api/config`);
- one **project card** per known cwd with a `workflowSchema` status, carrying: the folder name and full path; a **status pill** (severity family, icon plus text, never colour alone); a one-sentence plain-language explanation; at most one **recommended action** as a button; and every other allowed action in a **More actions** menu button (APG menu-button pattern; Remove last, after a separator). An empty list SHALL say that a project appears once the dashboard has polled a folder containing `openspec/`.

Card presentation per state (the allowed actions themselves are those of `openspec-workflow-schema` "Actions are allowed only in defined states"). Rows are evaluated in order and the first matching row wins:

| # | configured / generated | Pill (severity) | Recommended action |
|---|---|---|---|
| 1 | other / any, `missing` | Default schema missing (error); sentence names the configured schema that no schema directory provides | none |
| 2 | `pi-spec-driven` / `none` or `missing` | Schema files missing (error) | Regenerate… (the Update action) |
| 3 | any / `unmanaged` | Not managed (warning) | Adopt… |
| 4 | any / `incompatible` | CLI too old (error) | none |
| 5 | any / `conflict` | Version conflict (error) | none |
| 6 | any / `newer` | Newer version (info) | none |
| 7 | other / `current` or `outdated` | Disabled, files kept (neutral); `outdated` adds "an update is available" to the sentence | Enable… |
| 8 | `pi-spec-driven` / `outdated` | Update available (warning) | Update schema… |
| 9 | `pi-spec-driven` / `current`, N > 0 unpinned changes | N changes not pinned (warning), names listed (up to 5, then "and K more") | Pin N changes… |
| 10 | `pi-spec-driven` / `current` | Enabled (success) | none |
| 11 | other / `none` | Not enabled (neutral) | Enable… |

Every other allowed action of that card is an item of its More actions menu.

**Remove** SHALL NOT be offered while the configured schema is `pi-spec-driven` (the server refuses it in that state). Update, Adopt and a stamp-less Disable show a previous-default field (labelled, with help text; preselected `spec-driven`, or "Keep recorded value" for Update with a stamp; listing `spec-driven` plus `workflowSchema.projectSchemas`, so never a user-level-only schema).

The per-cwd actions write repository files immediately via `POST /api/openspec/workflow-schema`. They are NOT Save Bar sources. Each opens a confirmation dialog whose title names the action and the project (e.g. "Enable pi-spec-driven in deck3d?"), followed by the path, a one-sentence consequence, and a **Files written** list (Remove: **Files removed**) that holds only paths or path patterns, no prose (Enable lists the pattern `openspec/changes/*/.openspec.yaml` and explains the `*` in help text). For a worktree cwd an info callout names the branch and states that the dashboard never commits. Update additionally lists the active changes that resolve to `pi-spec-driven` (`workflowSchema.affectedChanges`, up to 5 names, then "and K more"). When the Update raises the patch to 2, it also states how many of them lack `dependencies.yaml` (`workflowSchema.undeclaredChanges`) and that those changes (including ones currently implementing or complete) return to planning until they declare dependencies. Adopt and Remove carry a warning callout (Adopt: hand customizations are discarded; Remove: unmerged branches may still pin the schema). Pin lets the user choose between `pi-spec-driven` and the stamp's `previousDefault` only. The confirm button names the outcome: Enable, Disable, Update schema, Adopt and regenerate (danger), Pin N changes, Remove schema files (danger).

While an action runs, only that card is busy (its recommended button shows a progress indicator and an "-ing" label, the card carries `aria-busy`); other cards stay interactive. The result is a severity callout under the card:
- success: the past-tense action, the number of paths written and, for a worktree, the branch; the reminder that the dashboard does not commit; a **Show files** disclosure listing the written paths; and, for Pin, the changes the server skipped (`data.skipped`) by name;
- no-op: a neutral "Nothing to change." with the server's reason;
- partial (`data.partial`): a warning that names the next step ("Run Enable again to finish"), plus the written paths;
- refusal: an error with the server message and the card's current state;
- `409`: an info callout "Another action is running for this project."

A deep link (`?cwd=<cwd>#workflow-schema`) SHALL outline the target card with the focus-ring token, caption it "Opened from folder", scroll it into view and move focus to its heading.

#### Scenario: Default switch defers to Save

- **WHEN** the user toggles "Default for new projects"
- **THEN** the change SHALL be held in the draft and persisted only on Save

#### Scenario: Enable confirms before writing

- **WHEN** the user clicks Enable for `/repo/a`
- **THEN** a dialog SHALL list `openspec/schemas/pi-spec-driven/`, `openspec/config.yaml` and the `.openspec.yaml` files to be created
- **AND** nothing SHALL be written until the user confirms
- **AND** the Save Bar SHALL NOT appear because of this action

#### Scenario: One recommended action per card

- **GIVEN** a project whose configured schema is `team-flow` and whose generated status is `outdated`
- **WHEN** the section renders
- **THEN** the card SHALL show the pill "Disabled, files kept" and exactly one action button, "Enable…"
- **AND** Update and Remove SHALL be items of the card's More actions menu

#### Scenario: Remove is hidden while enabled

- **GIVEN** a project whose configured schema is `pi-spec-driven` and whose generated status is `current`
- **WHEN** the More actions menu is opened
- **THEN** it SHALL offer Update and Disable and SHALL NOT offer Remove

#### Scenario: Only the acting card is busy

- **WHEN** Enable runs for one project
- **THEN** that card SHALL carry `aria-busy="true"` and show "Enabling…"
- **AND** the action buttons of every other card SHALL stay enabled

#### Scenario: Pin result names skipped changes

- **WHEN** a Pin of three changes returns two written paths and `skipped: ["absorb-service-secrets-into-vault"]`
- **THEN** the success callout SHALL name `absorb-service-secrets-into-vault` as skipped

#### Scenario: Deep link focuses the card

- **WHEN** the page opens at `/settings/openspec?cwd=/repo/a#workflow-schema`
- **THEN** focus SHALL be on the heading of the `/repo/a` card and the card SHALL show the "Opened from folder" caption

#### Scenario: Update to patch 2 warns about affected changes

- **GIVEN** a patch-1 project with `affectedChanges` of 4 changes and `undeclaredChanges` of 3, one of them implementing
- **WHEN** the user opens the Update confirmation
- **THEN** it SHALL state 4 affected changes, 3 of which will need a dependencies declaration and return to planning until then
