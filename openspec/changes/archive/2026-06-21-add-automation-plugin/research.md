# Research — Codex Automations & trigger-event analysis

Attached background for `add-automation-plugin`. Captures the external research and the trigger-event analysis that shaped the proposal. Not normative — `proposal.md` / `design.md` / `specs/` are authoritative.

## 1. How Codex Automations work

Source: https://developers.openai.com/codex/app/automations (fetched 2026-06-19).

### Automation shapes

| Shape | Behavior | Use when |
|---|---|---|
| Thread automation | Heartbeat wake-ups attached to a thread; preserves context | Keep returning to same conversation (poll a long command, PR review loop) |
| Standalone automation | Fresh run each time → reports to Triage | Each run independent; can run across multiple projects |
| Project automation | Scoped to one project dir; local or worktree | Project-bound recurring work |

### Triggers
- Schedule: cron / minute-interval / daily / weekly.
- Event-ish: PR opened/updated/merged, directory created — bolted on via GitHub plugin/Action, not a first-class generic event bus.
- Codex's trigger model is **schedule-centric**; events are thin.

### Execution
- Git repos: run in local checkout OR dedicated worktree (worktrees isolate from unfinished work; frequent schedules create worktree sprawl — docs warn to archive runs).
- Non-VC projects: run directly in project dir.
- Sandbox modes: read-only / workspace-write / full-access. Unattended runs use `approval_policy = "never"` when org policy allows.
- Project-scoped automations require: machine powered on, Codex running, project still on disk.

### Action + reporting
- Action = a durable prompt, or `$skill-name` to invoke a skill. Skills can also create/update automations.
- Results → Triage inbox (findings only; empty runs auto-archive). Filter all vs unread.
- Guidance: "make the prompt durable"; "test the prompt manually first"; review first few outputs.

### Example automations (from docs)
- Auto-create/improve skills by scanning `~/.codex/sessions`.
- 24h exec briefing of commits touching a directory.
- `$recent-code-bugfix` skill + automation that fixes bugs from the author's recent commits.

## 2. Structural template — OpenSpec in this repo

OpenSpec is the folder-backed feature whose plumbing Automation mirrors. Six concerns:

```
  openspec/ folder ─fs.watch─► poll (mtime-gated, worker pool)
     ─► buildOpenSpecData ─► broadcast (browser-gateway, openspec_update)
     ─► content view (FolderOpenSpecSection, routes, artifact reader)
     ─► actions/API (openspec-routes, *-api)        [plugin slot: none — core today]
```

Key files: `openspec-change-watcher.ts`, `directory-service.ts`, `openspec-poll-worker-pool.ts`, `shared/openspec-poller.ts`, `browser-gateway.ts` (`broadcastOpenSpecUpdate`), `FolderOpenSpecSection.tsx`, `ArchiveBrowserView.tsx`, `routes/openspec-routes.ts`.

Caveat that drove the plugin decision: OpenSpec is baked into core, and `extract-openspec-as-plugin` is actively moving it OUT into `packages/openspec-plugin/` via shell slots. Same for `extract-flows-as-plugin`. Automation = a new sibling concept → built as a plugin from the start.

## 3. Trigger-event analysis — general vs pi-dashboard-native

The proposal ships only `schedule` (phase 1) but builds an extensible registry. This is the catalogue of what can slot in later.

### Tier A — general triggers (portable, mirror Codex)

| Trigger | Mechanism in this repo | Phase |
|---|---|---|
| Schedule (cron/interval) | NEW central ticker | 1 (ships) |
| File/folder change | reuse `openspec-change-watcher` fs.watch | 2 |
| Manual / on-demand | REST route (like `POST /api/openspec/update`) | 1–2 |
| Git event (branch/commit) | partial — git branch mgmt exists; PR needs `gh`/webhook | 2 |
| Inbound webhook | NEW HTTP endpoint | 3 |

### Tier B — pi-dashboard-native events (the moat)

These already flow through the server's event-wiring layer; the dashboard aggregates ALL sessions across ALL bridges — something Codex's single-machine model cannot do. A trigger can `arm()` onto the same internal stream the broadcast uses.

```
  SESSION LIFECYCLE        AGENT BEHAVIOR          DOMAIN EVENTS
  session_added            tool invoked (pattern)  openspec_update → COMPLETE ★
  status → running          prompt submitted        flow completed
  status → ended           agent idle N min         goal reached
  status → error           output pattern match     server_restarting
  bridge connect/disconnect                         (plugin-emitted events)
```

Standout cross-session triggers — impossible in Codex:
- ★ Any session's OpenSpec change reaches `COMPLETE` → fire archive/release automation.
- Session ends with uncommitted changes → auto-commit automation.
- Flow/goal completes → verification automation.
- Agent idles >N min mid-task → nudge automation.

### Tier C — plugin-registered triggers (phase 3)
Other plugins call the registry's registration path to add kinds (e.g. `slack.message`). Same `TriggerType` interface; no folder-format change.

### Why the registry seam ships in phase 1
All three tiers use one interface — `TriggerType = { kind, parse(rawYaml), arm(cfg, fire): Disposable }`. Building it now means phases 2–3 add kinds without churning `automation.yaml`.

## 4. Decision log (with rationale)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | core vs plugin | plugin | coherence check found `extract-openspec-as-plugin` / `extract-flows-as-plugin`; core would add the accretion the team is removing; slots already shipped |
| 2 | scheduler ownership | central, server-owned | required for future cross-session event triggers |
| 3 | trigger scope phase 1 | schedule only, registry seam built | match Codex; defer event bus without format churn |
| 4 | action + model | prompt+skill; model id AND `@role` | both Codex action types; `@role` resolved live via roles plugin |
| 5 | run visibility | configurable `hidden`\|`shown`, default hidden; settings default + per-automation override | not all runs should be background; always monitored in Automation view |
| 6 | restart catch-up | skip | match Codex (machine-on requirement); avoid surprise backfills |
| 7 | overlap | per-automation `concurrency` (skip default) | Codex worktree-sprawl warning |
| 8 | retention | prune, keep last 100 | bounded run store |
| 9 | location | per-folder AND global, selectable; "Create Automation" button beside "New Session" | mirror Codex personal-vs-repo; first-class create action |

## 5. The one core touch
Plugin can't be fully self-contained for spawning: needs (a) a `ServerPluginContext` spawn hook, (b) `kind="automation"` + `automationRun{name,runId}` on `DashboardSession`, stamped from `PI_DASHBOARD_AUTOMATION_RUN`, honored by board/order filtering. Everything else lives in `packages/automation-plugin/`.

## 6. References
- Codex Automations: https://developers.openai.com/codex/app/automations
- Codex GitHub Action: https://developers.openai.com/codex/github-action
- Plugin pattern: `packages/flows-plugin/`
- Slot contracts: `openspec/specs/dashboard-shell-slots/spec.md`, `packages/shared/src/dashboard-plugin/slot-props.ts`, `slot-types.ts`
- Conflicting/aligned proposals: `openspec/changes/extract-openspec-as-plugin/`, `extract-flows-as-plugin/`
