# agent-teams-openspec-apply Specification

## Purpose
TBD - created by archiving change add-agent-teams-openspec. Update Purpose after archive.

## Requirements

### Requirement: Seed tasks from tasks.md

The `openspec-apply` seed SHALL read the checkboxes of `openspec/changes/<change>/tasks.md` through `GET /api/openspec/tasks` and create one team task per unticked checkbox, titled with its id and text (`1.1 …`; synthesized `L<line>` ids work alike). When that count exceeds `maxTasks` minus 2 it SHALL create one task per `##` section instead. Ticked checkboxes SHALL be skipped. More units than `maxTasks` minus 2 SHALL fail `too_many_tasks`.

#### Scenario: Task per checkbox
- **WHEN** the change has 12 unticked checkboxes and `maxTasks` is 50
- **THEN** 12 implementation tasks are created and `1.1` stays in each title

#### Scenario: Section granularity
- **WHEN** the change has 80 unticked checkboxes in 9 sections
- **THEN** 9 section tasks are created

#### Scenario: Too wide
- **WHEN** even the sections exceed `maxTasks` minus 2
- **THEN** the start fails `too_many_tasks`

### Requirement: Section tasks fit the task caps

A section task description SHALL list each remaining checkbox as its id and the first 80 characters of its text, in order, and SHALL be cut before 2000 characters with a pointer "full list: tasks.md section <n>". The recorded references SHALL keep every id even when the description is cut.

#### Scenario: Long section
- **WHEN** a section has 15 checkboxes of 250 characters each
- **THEN** the description is at most 2000 characters, ends with the pointer and all 15 ids are recorded

### Requirement: Dependencies from section order and hints

By default a task SHALL be blocked by every task of the previous section that still has an unticked checkbox, and tasks of one section SHALL be parallel. A hint SHALL replace that task's blockers (grammar in the next requirement).

#### Scenario: Default barrier
- **WHEN** section 2 follows section 1 and has no hints
- **THEN** each task of section 2 is blocked by the tasks of section 1

#### Scenario: Hint overrides
- **WHEN** task `3.2` has the hint `after: 1.2`
- **THEN** it is blocked only by the task for `1.2`

#### Scenario: Parallel section
- **WHEN** the line below `## 4. Docs` is `<!-- after: -->`
- **THEN** the tasks of section 4 have no blockers

#### Scenario: Ambiguous number
- **WHEN** a hint says `after: 2` and checkbox id `2` and section 2 both exist
- **THEN** the checkbox id is used and `§2` selects the section

### Requirement: Hint grammar

A hint is `<!-- after: <list> -->`, a comma-separated list of checkbox ids or `§<n>` section numbers; a bare number resolves as a checkbox id first, then as a section. On its own line directly below a checkbox, or trailing on it, it SHALL apply to that task; directly below a `##` heading it SHALL apply to every task of the section, and an empty list SHALL mean no blockers. Unknown entries SHALL be ignored and reported; a trailing hint SHALL be stripped from the task title.

#### Scenario: Unknown id ignored
- **WHEN** a hint names `9.9` and no such checkbox or section exists
- **THEN** it is ignored and reported in the start notice

#### Scenario: Trailing hint stripped
- **WHEN** a checkbox line ends with `<!-- after: 1.1 -->`
- **THEN** the task title does not contain the comment

### Requirement: Hints do not disturb existing parsers

Hints SHALL use only HTML comments so the dashboard task parser and the OpenSpec CLI continue to list the same checkboxes with the same ids. The plugin SHALL NOT rewrite hints and SHALL NOT require them.

#### Scenario: Comment line ignored
- **WHEN** a standalone comment line sits between two checkboxes
- **THEN** `GET /api/openspec/tasks` and `openspec instructions apply --json` report the same task count as without it

#### Scenario: No hints at all
- **WHEN** a tasks.md has no hints
- **THEN** seeding works with section-order dependencies only

### Requirement: Review task and reviewer member

The template SHALL declare implementer members and a member `reviewer` with `tools [read, grep, find, ls, bash]` (no `write` or `edit` tool) and `skills ["review-code"]`. The seed SHALL create a final task `Review` blocked by all implementation tasks and owned by `reviewer`. The reviewer SHALL be dispatch-eligible only for tasks it owns (`owner === "reviewer"`), never for an unowned task, so it never receives an implementation task. `bash` is an advisory hole, stated in its briefing.

#### Scenario: Review waits
- **WHEN** one implementation task is not completed
- **THEN** the `Review` task is blocked and not claimable

#### Scenario: Reviewer never claims implementation work
- **WHEN** the reviewer is idle at start and implementation tasks are unowned and unblocked
- **THEN** the dispatcher assigns it none of them

#### Scenario: Late task not claimed
- **WHEN** the lead creates an unowned implementation task after `Review` became unblocked
- **THEN** the reviewer is not assigned it

#### Scenario: Reviewer skill limit
- **WHEN** the reviewer lists its skills
- **THEN** only `review-code` is granted under the core skill allowlist

#### Scenario: Review skill missing
- **WHEN** `openspecReviewSkill` cannot be resolved for the repository
- **THEN** the start fails `review_skill_missing` before anything is created

### Requirement: The runtime is the sole writer of checkboxes

When a seeded task is completed (core `task_completed` store event, after the commit) the plugin server SHALL tick the matching checkbox lines through `POST /api/openspec/tasks/toggle` using current line numbers from `GET /api/openspec/tasks`. A section task SHALL tick all its recorded ids. Calls SHALL be in-process injections as loopback without a forwarded credential, and succeed or fail exactly as the route specifies.

#### Scenario: Tick on completion
- **WHEN** task `1.2` is completed
- **THEN** line `- [ ] 1.2 …` of tasks.md becomes `- [x] 1.2 …` and other lines are byte-identical

#### Scenario: Hook blocks completion
- **WHEN** a TaskCompleted hook or gate blocks the completion
- **THEN** the task stays `in_progress` and no checkbox is written

### Requirement: Checkboxes are matched by id and text

Each reference SHALL record the checkbox id and a hash of its normalised text. The sync SHALL locate a checkbox by id and text hash, else by a unique text-hash match, and SHALL tick only a unique match. No match SHALL log `ref_missing` and mark the task synced; several matches SHALL leave it unsynced and notify the lead without retrying.

#### Scenario: Id-less checkbox after an insert
- **WHEN** a human inserted a line above an `L12` checkbox
- **THEN** the sync finds the checkbox by its text and ticks that line, not the one now at line 12

#### Scenario: Duplicate text
- **WHEN** two checkboxes have the same text and ids do not disambiguate
- **THEN** nothing is ticked and the lead is notified

### Requirement: Checkbox sync is serial and recoverable

Toggles for one change SHALL run one at a time. A `409` line mismatch SHALL trigger a refetch and retry; after three failed attempts the lead SHALL receive a waking notice naming the ids and the task SHALL stay unsynced. A `401` or `403` SHALL NOT be retried and SHALL notify the lead as `sync_forbidden`. At server start the plugin SHALL retry unsynced completed tasks.

#### Scenario: Line drift
- **WHEN** a human inserted a line so the stored line number is stale
- **THEN** the sync refetches, ticks the right line and succeeds

#### Scenario: Restart recovery
- **WHEN** the server restarts after a completion whose toggle failed
- **THEN** the toggle is retried at startup

#### Scenario: Forbidden
- **WHEN** the route answers 403 to the injected call
- **THEN** no retry happens and the lead is told `sync_forbidden`

### Requirement: Teammates do not edit tasks.md or spec deltas

For members of an `openspec-apply` team the bridge guard SHALL block `write` and `edit` calls whose realpath (symlinks and `..` resolved) lies at `<lead cwd>/openspec/changes/*/tasks.md` or under `<lead cwd>/openspec/changes/*/specs/`. The lead is not guarded. The briefing SHALL state that `bash` is not covered.

#### Scenario: Edit refused
- **WHEN** a teammate calls `edit` on `openspec/changes/x/tasks.md`
- **THEN** the call is blocked with a reason naming the sole-writer rule

#### Scenario: Traversal and symlink
- **WHEN** a teammate edits `packages/../openspec/changes/x/tasks.md` or a symlink to it
- **THEN** the call is blocked

#### Scenario: Source files are free
- **WHEN** a teammate edits `packages/foo/src/a.ts`
- **THEN** the guard does not interfere

### Requirement: Lead is the sole committer in apply teams

In `openspec-apply` the team committer SHALL stay `lead`: teammates SHALL NOT commit (core guard) and the lead playbook SHALL instruct the lead to commit once `Review` is completed and the checkboxes are synced.

#### Scenario: Lead playbook
- **WHEN** the playbook is rendered
- **THEN** it forbids teammate commits and names the lead as the committer after review

### Requirement: Apply preflight outcomes

A change with no unticked checkbox SHALL fail `nothing_to_do`; a failing `GET /api/openspec/tasks` during preflight SHALL fail `tasks_unreadable`. Nothing is created in either case.

#### Scenario: Everything ticked
- **WHEN** every checkbox of the change is ticked
- **THEN** the start fails `nothing_to_do` and no team exists

#### Scenario: Tasks route fails
- **WHEN** the tasks route answers 5xx during preflight
- **THEN** the start fails `tasks_unreadable`

### Requirement: Hint leniency and limits

The `after` keyword SHALL be case-insensitive and whitespace-tolerant and a hint SHALL hold at most 64 entries. Forward, self, cyclic and duplicate entries SHALL be dropped and reported; the first hint on a box wins and a second is reported; hints in fenced code or on sub-bullets are ignored.

#### Scenario: Lenient keyword
- **WHEN** a hint reads `<!--  After : 1.1 -->`
- **THEN** it applies like `after: 1.1`

#### Scenario: Forward and cyclic entries
- **WHEN** a hint names a later task or closes a cycle
- **THEN** that entry is dropped, reported in the start notice and the seed completes

#### Scenario: Fenced hint
- **WHEN** a hint sits inside a fenced code block
- **THEN** it is ignored

### Requirement: Sync timing and a deleted tasks.md

A toggle sync SHALL make three attempts with 250 ms and 1 s backoff and a 10 s timeout per call. When `tasks.md` is gone (404) every ref SHALL become `ref_missing`, be marked synced and the lead SHALL be notified.

#### Scenario: Backoff
- **WHEN** the first toggle fails with a network reset
- **THEN** the retries follow after 250 ms and 1 s

#### Scenario: File deleted mid-run
- **WHEN** `tasks.md` is deleted and a task completes
- **THEN** its refs are `ref_missing`, synced, and the lead is notified

### Requirement: Team close drains pending sync

Closing an apply team SHALL wait at most 5 s for the per-change sync queue to drain; otherwise the pending refs SHALL be persisted `synced:false` and the lead notified.

#### Scenario: Close right after the last completion
- **WHEN** the lead calls `TeamDelete` while a toggle is in flight
- **THEN** the box is ticked within 5 s or `synced:false` is persisted with a notice

### Requirement: Guard resists case and hardlink aliases

The `tasks.md`/`specs` guard SHALL compare with `realpath.native` and, for existing targets, `dev` and `ino`, and SHALL case-fold on case-insensitive volumes, so a hardlink or a differently cased path to a protected file is blocked.

#### Scenario: Hardlink
- **WHEN** a teammate edits a hardlink to `openspec/changes/x/tasks.md`
- **THEN** the call is blocked

#### Scenario: Different case on APFS
- **WHEN** a teammate edits `openspec/changes/x/TASKS.MD` on a case-insensitive volume
- **THEN** the call is blocked
