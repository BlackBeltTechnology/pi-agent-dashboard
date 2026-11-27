# @blackbelt-technology/pi-dashboard-agent-teams-plugin

Agent teams core for pi-dashboard (plugin id `agent-teams`). A lead session
spawns visible teammate sessions and coordinates them through a shared task list
and a mailbox; every host call goes through `ServerPluginContext`. On top of the
core: **team templates** (start a whole team from a markdown file), **hooks**
(quality gates on idle / task events) and **plan approval** (a member plans
read-only until the lead or the user approves).

Not to be confused with `packages/team-plugin` (the personas/conversations
plugin) — unrelated.

| Entry | Path |
|-------|------|
| Server | `src/server/index.ts` — store, lane handlers, REST routes, dispatcher, member driver, templates / hooks / plan approval |
| Bridge | `src/bridge/index.ts` — team tools, teammate-scope guard, plan-mode narrowing, `/agent-team` command (pi extension) |
| Client | `src/client/index.tsx` — i18n catalog; claims the entry renderers (mail, approval, playbook, team tools) and the `sidebar-folder-section` Start team action |
| Config | `src/configSchema.json` — limits, rates, timeouts, TTLs, `autoDispatch`, `extraCwdRoots`, template / hook / plan settings |

Manifest `emits`: `agent-teams:mail`, `agent-teams:team_closed` (the manifest
contract test fails when the server emits a type not listed there).

Specs: `openspec/changes/add-agent-teams-core/`, `openspec/changes/add-agent-teams-templates-hooks/`.

## Tests

- `npx vitest run packages/agent-teams-plugin/src` (via `HOME=$(mktemp -d) …`, see `npm run test:parallel`) — unit + faux-pi-rpc harness.
- `src/__tests__/harness/` — injected clock, fake host `ctx`, faux `pi --mode rpc` driver.
- Browser E2E: `tests/e2e/agent-teams-*.spec.ts` (command, Start team dialog, approval card); VM smoke: `qa/tests/70-agent-teams-templates.sh`.

## Team templates

A template is a markdown file: YAML frontmatter describes the team, the body is
the **lead playbook** (delivered to the lead as one mail). Start one with
`/agent-team start <template> <goal>` or the dashboard's **Start team** dialog.

### Sources

| Source | Path | Trust |
|--------|------|-------|
| `project` | `<cwd>/.pi/teams/<name>.md` | read only when `host.isProjectTrusted(cwd)` is true; otherwise listed by file name with `trusted:false`, never parsed, not startable (`project_untrusted`) |
| `user` | `<piAgentDir>/teams/<name>.md` | always trusted |
| `bundled` | registered in code by later changes (`registerBundledTemplate`) | trusted; no hook prompt |

A trusted `project` template shadows a `user` / `bundled` one of the same name;
an untrusted project file never shadows anything. The file name stem must equal
the frontmatter `name` (`^[a-z][a-z0-9-]{0,39}$`). Files must be regular files
whose realpath stays inside the source directory (`outside_source_dir`) and at
most `maxTemplateBytes` (default 65536, `template_too_large`). A listing holds
at most 200 templates. Invalid templates are listed with stable error codes and
cannot be started; unknown keys are ignored with a warning.

The frontmatter is parsed strictly: one YAML mapping, unique keys, **no anchors,
aliases, merge keys or custom tags** (`frontmatter_invalid`).

### Frontmatter fields

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string, required | equals the file stem |
| `description` | string | one line shown in listings and the dialog |
| `mode` | string | member runtime mode; omit to use the runtime default. A mode that is not registered → `mode_unavailable` |
| `lead.model` | string | model for a **dashboard-started** lead; ignored (with a notice) by the `/agent-team` command, the session keeps its model |
| `maxTeammates` | integer ≥ 1 | cap on roster **plus** lead-spawned members; the configured maximum stays the upper bound (`roster_exceeds_max`) |
| `autoDispatch` | boolean | per-team override of the dispatcher; `false` = members claim tasks with `TaskUpdate` only |
| `notify.coalesceMs` | integer 0–10000 | per-team lead-notice flush window (`notify_out_of_range`). Errors, shutdown rejections, plan requests, member deaths, spawn failures and direct messages always wake the lead |
| `spawn` | `eager` (default) \| `lead` | `eager`: server spawns every member after the lead binds; `lead`: none, the playbook lists the roster for the lead to spawn with `TeammateSpawn` |
| `requirePlanApproval` | `false` \| `true` \| `"user"` | team-wide **floor** for plan approval (see [Plan approval](#plan-approval)) |
| `defaultModel` | string | model for members that name none |
| `defaultTools` / `defaultSkills` | string[] | team default tool / skill lists; also a **ceiling** for lead-supplied lists |
| `members[]` | list | the roster (below) |
| `hooks` | mapping | event → up to 3 `{command, timeoutMs?}` (see [Hooks](#hooks)) |

Member fields: `name` (required; core member-name rules, `lead` is reserved),
`agent` (a teammate type, see below), `role`, `model`, `count` (integer ≥ 1;
expands to `<name>` for 1, `<name>-1…-n` for n > 1; every expanded name must be
valid and unique), `tools`, `skills`, `cwd` (still confined to the lead cwd and
`extraCwdRoots`), `requirePlanApproval`, `prompt` (extra system-prompt text).

### Variables and the playbook

The body and each member `prompt` get exactly `{{goal}}` and `{{cwd}}`, once, by
plain replacement (no recursion; an unknown `{{x}}` stays literal and warns). The
goal is required, at most 4000 characters, control characters and newlines
collapse to one space. The rendered playbook (body + goal + roster summary) must
fit one core mail (`maxMessageChars` − 500, 120 lines) — otherwise
`playbook_too_long`; it is never truncated.

A template describes how to **start** a team only. At start the server snapshots
it on the team (name, source, hash, hooks, defaults, roster, goal, playbook); later
edits or deletion of the file never change a running team. A server restart
between start and lead bind keeps the roster, and eager spawning reconciles
idempotently (only missing members, playbook never re-sent).

### Teammate types (`.pi/agents`)

A member (or a `TeammateSpawn {agent}` call) may name an agent definition
(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`), resolved against the team lead cwd:
`<leadCwd>/.pi/agents/<agent>.md` (only when the project is trusted), then
`<piAgentDir>/agents/<agent>.md`; regular files up to 64 KiB. Errors:
`agent_not_found`, `agent_untrusted`, `agent_invalid`.

Mapping: `description` → default role (else the agent name); `model` → spawn
model; `thinking` → thinking level (unknown level ignored with a warning);
`tools` → tool allowlist (**must be a YAML array**, a comma string fails
`agent_invalid`); `prompt` or the markdown body → a prompt file appended after
the protocol prompt (agent file first, then the member `prompt`). `inherit_context`
is ignored: a teammate never receives the lead's history. The team tools
(`TaskList`, `SendMessage`, `PlanSubmit`, …) are always appended to the list.

Precedence per field — first defined wins: spawn argument → template member →
agent definition → team default (`model`, `tools`, `skills`). A template-declared
`tools` / `skills` list is a **ceiling**: a lead-supplied list is intersected with
it and anything outside fails `tools_outside_template` / `skills_outside_template`.
`requirePlanApproval` is a **floor**: a spawn argument may only strengthen it
(`false` < `true` < `"user"`). The model is neither floor nor ceiling.

### `/agent-team` command

Registered by the bridge in every pi session:

- `/agent-team start <template> <goal…>` — the calling session becomes the lead
  (its own cwd; a payload cwd is ignored), the lead tools are registered as after
  `TeamCreate`, the playbook arrives as an `agent-teams-playbook` message and the
  lead's turn starts. Errors (`already_in_team`, `lead_confined`,
  `project_untrusted`, `template_invalid`, `playbook_too_long`, …) are shown in
  the session UI. Project hooks that are not yet confirmed open one confirm dialog
  listing the exact commands.
- `/agent-team templates` — lists this folder's templates with source, validity,
  trust state and whether they run hooks.

Argument completion offers the subcommands and cached template names. Starting a
team is not an agent tool: a teammate calling `team.start` gets
`nested_team_forbidden`, and no tool accepts `trustHooks`.

### Start team dialog (dashboard)

The plugin claims the `sidebar-folder-section` slot: each workspace folder gets a
**Start team** action. The dialog lists the folder's templates (source, validity,
trust; untrusted project templates are disabled with a prompt to trust the
project), takes a goal and calls `POST …/teams/start` with the folder cwd. The
server creates the team (`starting`, `owner` = the request principal), spawns a
new lead session with the template `lead.model`, and on bind delivers the
playbook and starts the eager roster. If the lead never binds within
`spawnTimeoutMs` the team closes with `lead_spawn_failed` (also across a server
restart). When the answer is `hooks_untrusted {hash, commands}` the dialog shows
the commands and retries with `trustHooks` = that hash only after confirmation.

## Hooks

A template may declare shell hooks, run by the **server** (never the agent) as
`bash -c <command>` in the team lead cwd, sequentially, up to 3 per event
(`too_many_hooks`), `command` ≤ 2000 characters (`hook_command_too_long`),
`timeoutMs` an integer ≥ 1.

| Event | Fires | On exit 2 |
|-------|-------|-----------|
| `TaskCreated` | before `TaskCreate` commits | the call fails `hook_blocked` with the feedback; no task |
| `TaskCompleted` | before `TaskUpdate → completed` commits | task stays `in_progress`; the call fails `hook_blocked` |
| `TeammateIdle` | when a member reports idle | member is not marked idle, the lead is not notified, a waking `hook_feedback` mail carries the stderr to the member |

Unknown event keys are ignored with a warning. Claims and trusted server callers
(`skipGates`) run no hooks. `TeammateIdle` skips `shutdown_pending` members,
idles that carry an error or abort, and members with a pending plan.

**Contract**

- **Exit code**: `0` allow · `2` block, stderr (control characters stripped, ≤ 2000
  chars; empty → `hook blocked (no output)`) is the feedback · anything else, a
  timeout, an output overflow or a spawn error → **allow** (fail-open), logged and
  counted. The first command that exits 2 ends the sequence. Spawn error and
  first timeout per team notify the lead once; three consecutive non-blocking
  errors for one event give a non-waking notice.
- **stdin**: one JSON object built only from server-held state, e.g.
  `{hook_event_name, team:{id,name}, cwd, member, memberCwd, task:{id,title,description,status,owner,blockedBy,result}, idle:{settleId,finalText,error}}`
  (`task` for task events, `idle` for `TeammateIdle`; `finalText` is cut to 4000 chars).
- **Environment** (allowlist, never the server env): `PATH`, `HOME`, `USER`,
  `LANG`, `LC_*`, `TMPDIR`, `SHELL`, `AGENT_TEAMS_EVENT`, `AGENT_TEAMS_TEAM_ID`,
  `AGENT_TEAMS_MEMBER`, `AGENT_TEAMS_TASK_ID`. Task text is on stdin only.
- **Budget**: all commands of one event share **one deadline = the core
  `opGateBudgetMs` (12 s total, queue wait included)**; each command's `timeoutMs`
  (default `hookTimeoutMs` = 10 s) is capped by the remaining budget. At most 2
  hooks per team and 4 server-wide run at once; stdout and stderr are capped at
  64 KiB each. A timed-out hook's whole process tree is killed (also on shutdown).
  A task hook that cannot start before the deadline fails with `hook_blocked` /
  `hook_busy` (retry works); a second completion of a task whose hook is running
  fails `hook_pending`; an idle hook that cannot start lets the idle through.
- **Long gates**: the gate answers inside the 15 s lane timeout, so a gate that
  needs more than ~10 s (a full test suite) must not be a blocking hook. Make it
  a **quick check** (lint one file, grep the diff, `git diff --quiet`), or use an
  **async pattern**: the hook only records a request, and a later task (a CI
  step, a reviewer member) does the slow work.
- **Retries**: after `hookMaxRetries` (default 3) consecutive `TeammateIdle`
  blocks for one member the idle is accepted and the lead is told; any accepted
  idle resets the counter. `0` means idle hooks never block.

**Trust (TOFU).** User-source (and bundled) hooks are trusted. Project-source
hooks run only when the project is trusted **and** a confirmation exists for
`realpath(cwd)` + the SHA-256 of the canonical hook set (event names, command
text and order, effective `timeoutMs`; comments, whitespace and key order are
ignored). Otherwise `team.start` answers `hooks_untrusted` with the hash and the
exact commands and starts nothing; retry with `trustHooks` = the shown hash
(`hash_mismatch` if the file changed meanwhile). Confirmations live in
`<dataDir>/hook-trust.json`. The hooks are **frozen** onto the team at start:
nothing (tool, route, revoked trust) changes a running team's hooks; revocation
only gates later starts. A trusted project hook runs with your privileges, like
any project extension — review it before confirming.

## Plan approval

`requirePlanApproval` (template, member, or spawn argument): `false` (default),
`true` (the lead or the user decides), `"user"` (only the user decides).

```mermaid
stateDiagram-v2
  [*] --> planning: spawn (true or "user")
  planning --> pending: PlanSubmit
  pending --> pending: PlanSubmit (old plan superseded)
  pending --> approved: PlanDecision / user approves
  pending --> planning: rejected (feedback delivered)
  approved --> [*]
```

1. A plan-mode member is spawned with an explicit tool list (including the plan
   tools), `PI_EXT_AGENT_TEAMS_PLAN_MODE=1` and a **dispatch hold**; the server
   records `planApproval:"planning"`. Its bridge narrows the active tools to
   `planModeTools` + the team tools + `PlanSubmit` and blocks every other tool
   call (`bash`, `edit`, `write`, …) until approval. A `planning` member may still
   claim a task explicitly; it is excluded from auto-claim.
2. The member calls `PlanSubmit {plan}` (≤ `planMaxChars`, ≤ 120 lines, else
   `message_too_long`; empty → `invalid_args`; outside plan mode →
   `plan_not_required`). The server stores plan `p<N>` (per team, 20 max, oldest
   decided one dropped, pending never), sets `pending`, and wakes the lead with a
   `plan_request` mail (customType `agent-teams-approval`). A new submission marks
   the old pending plan `superseded`. A pending member triggers no idle hook and
   no idle notice.
3. The **lead** calls `PlanDecision {member, planId, approve, feedback?}`, or the
   **user** presses Approve / Reject on the card in the lead's chat (or posts to
   `plan-decision`). `decidedBy` is recorded by the server from the verified
   caller, never from message text. Stale decisions fail `already_decided`,
   unknown ones `unknown_plan`; `feedback` has the plan bound.
4. Approval sets `approved`, clears the hold and wakes the member with a
   `plan_decision` mail; the bridge re-syncs through `hello` and restores the
   **server-provided** tool list plus the team tools. Rejection keeps the member
   read-only (`planning`) and delivers the feedback. If the bridge cannot narrow
   tools or `PlanSubmit` is missing, the `tool_call` block still refuses non-plan
   tools and the member is marked `degraded:"plan_tools_unavailable"` (lead notified).

Limits of `"user"`: with `requirePlanApproval:"user"` the lead's `PlanDecision`
fails `user_decision_required`, but the mode is **advisory, not a security
boundary** — when identity is not enforced, any local-token REST caller can post
the user decision. Plan-mode narrowing is in-session extension logic (it stops
the model, not a malicious extension). Because the member gets an explicit tool
list, non-default extension/MCP tools are only available after approval if named
in `tools`.

Plans, holds and member states persist across a server restart. A pending plan
becomes `cancelled` when its member's session ends or does not re-register within
`spawnTimeoutMs` of the restart.

**Rollback.** Reverting this change leaves stored fields inert and teams run as
plain core teams (no hooks, no plan gate). A member still awaiting approval keeps
the read-only scope until its session ends — it was spawned with the narrowed
tool list, and nothing after the revert can approve it. Delete
`<dataDir>/hook-trust.json` and `<dataDir>/prompts/` if desired.

## Configuration keys

Added by this change (`src/configSchema.json`; invalid values fall back to the
default with a startup warning):

| Key | Default | Meaning |
|-----|---------|---------|
| `maxTemplateBytes` | 65536 | max template file size (`template_too_large`) |
| `hookTimeoutMs` | 10000 | default per-command hook timeout, capped by the remaining `opGateBudgetMs` |
| `hookMaxRetries` | 3 | consecutive idle-hook blocks before the idle is accepted (`0` = never block) |
| `planMaxChars` | 6000 | max plan / decision feedback characters; effective `min(planMaxChars, maxMessageChars − 500)` and 120 lines |
| `planModeTools` | `[read, grep, find, ls]` | tools kept while a plan awaits approval; `bash`, `edit`, `write` and unknown names are dropped with a warning |

The hook budget itself is the core `opGateBudgetMs` (default 12000, max 14000).

## In-process teammates (mode `in-process`)

`teammateMode` (`session` default, or `in-process`; `TeamCreate {mode}` and a template `mode` win over it)
runs teammates as background children of the lead through the external
`@blackbelt-technology/pi-dashboard-subagents` extension instead of one dashboard session each.

**Requirement: this mode needs an upstream release of `pi-dashboard-subagents` newer than 0.8.1
(targeted: 0.9.0, API `apiVersion` 1) that answers `subagents:capabilities`, and it is not published
yet.** Until it is installed, `TeamCreate {mode:"in-process"}` fails with `mode_unavailable`
(`subagents_extension_missing` / `subagents_extension_outdated`) and session mode is unaffected. The plugin
does not list the package in its manifest `requires`; the gate is the runtime capability handshake
(`src/shared/subagents-contract.ts`). Update the package from the Packages tab.

| Key | Default | Meaning |
|-----|---------|---------|
| `teammateMode` | unset (`session`) | default mode when `TeamCreate` and the template give none (`session` \| `in-process`) |
| `inProcessIdleTtlSec` | absent | free an idle child after N seconds (integer ≥ 1); absent keeps idle children until stopped |
| `inProcessLeanChildren` | `false` | children load no discovered extensions (cheaper, isolated from foreign extensions) |
| `inProcessCmdTimeoutMs` | 10000 | command ack deadline to the lead bridge (integer 1000–120000; out of range is rejected at settings write, never clamped) |
| `inProcessQueueTimeoutMs` | absent | opt-in: fail a teammate queued longer than this for a subagents slot (`spawn_timeout`) |

Parity gaps versus session mode: no direct user chat with a teammate (read-only subagent view), no resume,
members do not survive a lead `/reload`, no MCP in children, and parallelism is bounded by the subagents
`maxConcurrent` setting (shared with the lead's own `Agent` calls).
Skills: the child guard layers (prompt filter, `/skill:` refusal, `SKILL.md` read guard) apply to every grant, so an empty
grant hides all skills; a non-empty `skills` grant needs the subagents feature `loader_skills` (otherwise the spawn fails
with `skills_unavailable_in_process`), and without any grant a child sees no project or user skills. A member `cwd` outside
the lead's git repository needs the feature `cwd_scope` (otherwise `cwd_outside_scope`).

## REST routes

All under `/api/plugins/agent-teams/`; tiers live in `packages/shared/src/route-tiers.ts`.
`cwd` is required (`cwd_required`) and admitted by the host route-cwd admission.
Failures are `{ok:false, error, message?, details?}`.

| Route | Tier | Body / query |
|-------|------|--------------|
| `GET templates?cwd=` | observe | the folder's template listing (`{templates, warnings?}`) |
| `POST teams/start` | operate | `{template, goal, cwd, trustHooks?}` → starts a team with a new lead session; `hooks_untrusted` carries `details {hash, commands}` |
| `POST hook-trust` | operate | `{cwd, hash}` — record a confirmation; only for the hash the server currently computes for a trusted project template of that cwd (`hash_mismatch`) |
| `DELETE hook-trust?cwd=&hash=` | operate | revoke one confirmation; no `hash` removes every confirmation for the cwd |
| `GET teams/:id/plans` | observe | the team's plan requests (core visibility rule; foreign team → the unknown-team 404) |
| `POST teams/:id/members/:name/plan-decision` | operate | `{planId, approve, feedback?}` — the user's decision (team-control rule) |

## Example templates

### `.pi/teams/review-pr.md` — eager roster with hooks

A project template (hooks ⇒ the first start asks for a hash-bound confirmation).
Hooks are quick checks that read the event JSON from stdin.

```markdown
---
name: review-pr
description: Review a pull request with two reviewers, gated by quick checks
maxTeammates: 4
spawn: eager
notify:
  coalesceMs: 2000
defaultModel: "@fast"
defaultTools: [read, grep, find, ls, bash]
members:
  - name: reviewer
    count: 2
    role: Reads the diff and reports defects with file and line
    prompt: |
      Review only what the goal names in {{cwd}}. Report findings as
      TaskUpdate results: one defect per line, "path:line - problem".
  - name: summarizer
    role: Merges the reviewers' findings into SUMMARY.md
    tools: [read, grep, find, ls, write]
hooks:
  TaskCreated:
    - command: |-
        jq -e '.task.title | test("^[A-Za-z]+-?[0-9]*: ")' >/dev/null ||
          { echo "Start the task title with a topic and a colon, e.g. 'auth: check token expiry'" >&2; exit 2; }
      timeoutMs: 3000
  TaskCompleted:
    - command: |-
        jq -e '(.task.result // "") | length > 0' >/dev/null ||
          { echo "Complete the task with a result: what you checked and what you found" >&2; exit 2; }
      timeoutMs: 3000
  TeammateIdle:
    - command: |-
        p=$(cat)
        [ "$(echo "$p" | jq -r .member)" != "summarizer" ] ||
          [ -f "$(echo "$p" | jq -r .memberCwd)/SUMMARY.md" ] ||
          { echo "Write SUMMARY.md before going idle" >&2; exit 2; }
      timeoutMs: 3000
---
You lead a pull-request review for: {{goal}}

Working directory: {{cwd}}

1. Create one task per area of the change (prefix every title with a topic and a colon).
2. The two reviewers claim tasks and report defects in the task result.
3. When all review tasks are completed, ask the summarizer to produce SUMMARY.md
   and give the user a short verdict.
```

Stdin can be read once, so a hook that needs several fields reads it into a
variable first (`p=$(cat)`, as the idle hook does). Keep every hook a quick check
(see **Long gates**).

### `.pi/teams/refactor-module.md` — plan approval with agent members

Members are teammate types from `.pi/agents` (`Explore`, `Audit`); the implementer
plans first and needs the **user's** approval.

```markdown
---
name: refactor-module
description: Refactor a module — an implementer plans first, an auditor reviews the result
maxTeammates: 3
spawn: eager
requirePlanApproval: false
defaultTools: [read, grep, find, ls, edit, write, bash]
members:
  - name: scout
    agent: Explore
    role: Maps the module and its callers before any change
    tools: [read, grep, find, ls]
  - name: implementer
    role: Implements the refactor after its plan is approved
    requirePlanApproval: user
    prompt: |
      Goal: {{goal}}
      Explore first, then submit your plan with PlanSubmit (steps, files touched,
      tests to run). Do not change files until the plan is approved.
  - name: auditor
    agent: Audit
    role: Reviews the finished change for defects and regressions
    tools: [read, grep, find, ls]
---
You lead a refactor of: {{goal}}

Working directory: {{cwd}}

1. Ask `scout` for a map of the module and its callers; create tasks from it.
2. `implementer` plans first; its plan reaches you as a plan request. Only the
   user can approve it (`requirePlanApproval: user`), so tell the user to review
   the card instead of calling `PlanDecision` yourself.
3. After approval the implementer works the tasks; then ask `auditor` to review.
4. Report the outcome to the user.
```

`Explore` and `Audit` resolve from `<cwd>/.pi/agents/` (trusted project) or
`<piAgentDir>/agents/`; a missing one fails that member's spawn with
`agent_not_found` and only that member is marked `failed`.

## Teammate limits (advisory with `bash`)

A teammate runs behind a guard (tool allowlist, skill allowlist, sleep-poll and git-write guards, spawn-time `PI_EXT_AGENT_TEAMS_*` policy). The tool and skill allowlists are **advisory while the teammate has the `bash` tool**: a shell can still read files or run commands outside them (`bash -c "git commit"`, `$(…)` indirection and scripts are not chased). For a stricter limit give the teammate a `tools` list without `bash`. `blockSleepPolling` and `blockGitWrite` (both default true) are plugin settings.
