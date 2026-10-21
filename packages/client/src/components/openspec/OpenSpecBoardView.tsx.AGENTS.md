

`TasksPopover` via `LazyTasksPopover` (Suspense) — off the entry chunk. See change: redesign-composer-session-strip.

`onSpawnSession` opts gain `focus?: boolean`; card `+ Session` and New-proposal plain create pass `{ focus: false }` so board spawns keep the user on the board. See change: openspec-board-spawn-no-focus.

Selected-card selector escaping via `cssEscape`. See change: fix-codeql-small-findings.

Card header renders `OpenSpecErrorBadge` when `change.error`; stepper all `todo` (empty artifacts); New session/worktree stay enabled. See change: use-openspec-status-all.

`BoardStatePill` (exported) = kit `SettingsStatusPill`: tone from `CHANGE_STATE_KIND` (todo→neutral, current→info, done→success), words via `openspec.state.*`; the rest of the file is untouched and the `openspec-board-status-visuals` mapping is intact. See change: align-ui-contract-recipes.

Dependencies: card renders `DependencyChips` when `showDependencyUi(data)`, a `Declare dependencies` hint (`showDeclareHint`) and a `Dependencies…` action (whenever the change has a `dependencies` field) that opens `DependenciesDialog`. Filter bar `Execution order` toggle (only when a graph exists) sorts columns by wave and never touches `changeOrder`; in that view a same-column drop is a no-op and a cross-column drop reassigns + appends (`executionOrderDrop`). See change: add-openspec-change-dependencies.
