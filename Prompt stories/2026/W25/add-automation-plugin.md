---
session: 019ee67f
week: 2026/W25
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~14262 tok)"
upgrade_status: pending
openspec_changes: [add-automation-plugin]
proposal_excerpt: "The dashboard has no way to run agent tasks on a trigger — every pi session today starts from a human clicking \"New Session\". OpenAI Codex ships \"Automations\": background runs fired on a schedule (and, via plugins…"
---

# How we did it: Ship an entire new dashboard plugin from an OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator wanted a large, pre-planned OpenSpec change implemented end-to-end. The
kickoff was a single slash command:

> `/skill:openspec-apply-change add-automation-plugin`

The *real* objective — clear from the proposal and the 30-task plan — was to build a
brand-new `packages/automation-plugin/`: a Codex-style "Automations" feature that fires
background agent runs on a schedule, surfaces them in a triage inbox, and hides
book-keeping runs from the main board — **entirely on the dashboard's plugin slots**,
touching core code only where unavoidable. Then, in a second phase, to take it all the
way to merged: archive → PR → CI → CodeRabbit → merge → clean up the worktree.

This was an 11-hour, 30-task, ~66-file build run under `@fast`, ending in a merged PR (#142).

## 2. TL;DR playbook

1. **Kick off with the apply skill against the named change:** `/skill:openspec-apply-change <change>`. It pulls the tasks + delta specs so the AI works to a plan, not vibes.
2. **If you're in a worktree, tell the AI where the shared skills live** up front: *"use ospx skills from worktree's parent directory."* Saves a fruitless `find` across `~`.
3. **Front-load architecture study before any code.** Have the AI batch-read the closest existing plugin (here `flows-plugin` / `jj-plugin`) as a template, plus the riskiest core-touch surfaces (spawn machinery, slot registry, event-wiring).
4. **Approve the plan + the risky decisions in one shot** at the checkpoint (full build in order, new `ServerPluginContext.spawnSession` hook, strict TDD).
5. **Build group-by-group, test-first**, marking `tasks.md` as each group goes green. Keep pure logic (schema, cron, scanner, store) injectable so it's testable without a live server.
6. **When cross-package imports don't resolve in a worktree, run `npm install` inside the worktree** — it shares the parent's `node_modules` and the workspace symlinks point at the *parent's* packages.
7. **Defer heavy plugin boot work** (`queueMicrotask` → unref'd timer) so it doesn't tip borderline server-boot integration tests over their timeout.
8. **Ship with an explicit ordered checklist:** *"1. archive, sync 2. create PR 3. monitor CI 4. fix coderabbit 5. merge 6. delete branch 7. delete worktree."* The AI executes each and reports.
9. **Treat CodeRabbit findings as real bugs** — fix, add a regression test that locks in the fix, re-push, re-poll until "No actionable comments."

## 3. How the collaboration unfolded

**Phase A — Orient (skill + plan).** The AI loaded `openspec-apply-change`, hit a
wrong turn looking for skills under `~`, and was steered to the worktree's parent. It
then pulled `openspec status` / `instructions apply` to get the 30-task plan and read
every context + delta-spec file. *Why it worked:* the change was fully spec'd, so the AI
had a concrete contract instead of guessing scope.

**Phase B — Ground in the architecture.** Before writing a line, the AI batch-read
`flows-plugin` and `jj-plugin` as templates (manifest, tsconfig, slot claims, route
registration), plus the riskiest surfaces: the spawn path (`process-manager`,
`spawn-mechanism`), pending-registry pattern, `event-wiring` stamping, and the client
board filter. **Decision point:** at an explicit checkpoint the AI presented the plan and
asked to confirm the big calls — the human approved *full build in order, the new
`spawnSession` hook, and strict TDD.* Confirming risky architecture before hours of code
is the single highest-leverage move here.

**Phase C — Build group-by-group (TDD).** §1 scaffold → §2 core touches → §3 folder
format → §4 scheduler → §5 run lifecycle → §6 UI → §7 docs → §8 verify. Each group:
write the test, implement minimally, run, mark `tasks.md`. Pure logic (YAML schema, a
self-contained cron evaluator to avoid a new dependency, scanner, run store) was written
injectable so it tested without a live server. Docs (§7) were delegated to a subagent
with the repo's caveman-style rule, per AGENTS.md (main agent never edits `docs/`).

**Phase D — Fight the environment.** Two real snags: (1) cross-package edits weren't
seen because the worktree shared the parent's `node_modules` → fixed with a worktree-local
`npm install`; (2) the plugin's static-import boot cost tipped a borderline 4.9s/5s
server-boot integration test → fixed by deferring engine init behind an unref'd timer.
The AI *proved* the flakiness was pre-existing on the parent repo before exonerating its
own change — evidence over assumption.

**Phase E — Ship on rails.** The human handed a 7-step ordered checklist. The AI archived
(4 new capability specs), committed 81 files, opened PR #142 against `develop`, polled CI
+ CodeRabbit, fixed two CodeRabbit findings with regression tests, re-polled to green,
squash-merged, and removed the branch + worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-automation-plugin`. Effective because it binds the work to a named, already-planned change: the AI inherits a 30-task contract and delta specs instead of inventing scope. *Use a skill-anchored kickoff whenever a plan already exists.*
- **High-leverage steer #1** — *"use ospx skills from worktree's parent directory."* One line that ended a dead-end filesystem search. In a worktree, always state where shared skills/config resolve.
- **High-leverage steer #2 (the ship command)** — *"I will test later. Mark as done. After run step by step: 1. archive, sync 2. create PR 3. monitor CI 4. fix coderabbit issues 5. merge PR 6. delete branch 7. delete worktree."* A numbered, imperative checklist turns the AI into a reliable executor and gives it a clear definition of done. *Prefer an explicit ordered list over "ship it."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Hunt for skills under `~` / the wrong root when inside a worktree | "use ospx skills from worktree's parent directory" | State the skill/config resolution root up front when working in `.worktrees/*` |
| Want to keep verifying the manual live-ChatView step | "I will test later. Mark as done." | Tell the AI which tasks are human-verified-later so it doesn't block on them |
| Leave "ship" ambiguous | Gave a 7-step ordered checklist (archive→…→delete worktree) | Hand over an explicit ordered ship checklist, not "merge it" |

Also implicit quality bars the AI honored without a fight: strict TDD (test-first every
group), no new runtime dependency (self-contained cron evaluator instead of a cron lib),
and the "no core branch when the plugin is disabled" SHALL (reconciled by routing the
Create affordance through a slot, not a core button).

## 6. Skills, tools & memory created — and why they're effective

**Memory saved (project · tool-quirk):** *Worktrees under `.worktrees/` share the parent
repo's `node_modules` by default; the npm-workspace symlinks there point at the PARENT
repo's packages, so cross-package edits in a worktree are NOT seen via package-name
imports — run `npm install` inside the worktree to relink.*

- **What it captures:** the single most time-wasting environment gotcha of this session — hours can vanish to "my edit isn't taking effect" before realizing the symlink points at the parent.
- **Why it's effective:** turns a confusing 20-minute debugging detour into a one-line fix the next time cross-package imports look stale in a worktree.
- **When to invoke:** any worktree build that edits one workspace package and imports it by name from another.

**Subagent used:** `general-purpose` to write the `docs/` rows in caveman style —
correct per AGENTS.md (the main agent must never edit `docs/` directly).

No reusable *skill* was created, but the group-by-group TDD-plus-checkpoint rhythm here
is exactly what the project's `openspec-apply-change` + `ship-change` skills already
encode; lean on them rather than re-deriving the flow.

## 7. Pitfalls & dead ends

- **Cross-package edits invisible in a worktree** → the worktree shared the parent's `node_modules`; symlinks resolved to the parent's packages. **Fix:** `npm install` inside the worktree to create local workspace links, then re-typecheck.
- **New package not picked up by tests / release** → register it as a vitest project *and* add it to `.github/workflows/publish.yml` (a release-manifest test catches the omission).
- **Plugin boot cost tipping server-boot integration tests** → static `yaml`+engine imports loaded on the synchronous plugin-load path, pushing a 4.9s test past a 5s timeout. **Fix:** defer engine init behind an unref'd timer so short integration tests tear down first.
- **Load-flaky server-boot tests look like your regression** → before blaming your change, re-run the same tests on the parent repo under the same batch load. Here doctor-route / event-wiring / session-kill flaked *identically on `main`* — pre-existing machine-load contention, not the new plugin.
- **Nested heredoc + apostrophe broke `gh pr create`** → write the PR body to a file and use `--body-file`.
- **`makeRunId` collision** (`<date>-<name>` → a 1-min cron overwrites itself 60×/hour) → surfaced by a CodeRabbit-inspired regression test; made run ids unique per occurrence.

## 8. Reproduce it faster — checklist

- [ ] Kick off: `/skill:openspec-apply-change <change>` (the plan/specs must already exist).
- [ ] In a worktree? State *"use skills from the worktree's parent directory."*
- [ ] Batch-read the nearest existing plugin as a template + the riskiest core-touch surfaces.
- [ ] Approve plan + risky decisions (new hooks, TDD) at the checkpoint before coding.
- [ ] Build group-by-group, test-first, marking `tasks.md`; keep pure logic injectable.
- [ ] `npm install` inside the worktree if cross-package imports don't resolve.
- [ ] Register the new package as a vitest project **and** in `publish.yml`.
- [ ] Defer heavy plugin boot work (unref'd timer) to protect borderline boot-timing tests.
- [ ] Ship with an explicit ordered checklist: archive/sync → PR → CI → CodeRabbit → merge → delete branch → delete worktree.
- [ ] Treat each CodeRabbit finding as a real bug: fix + regression test + re-poll to "No actionable comments."

**Inputs to have ready:** the named OpenSpec change (tasks + delta specs), a template
plugin to mirror, `gh` auth for the PR, and the worktree checkout.

**Artifacts produced:** `packages/automation-plugin/` (manifest, client/server/bridge,
~58+ tests), core touches (`DashboardSession.kind/automationRun`,
`pending-automation-run-registry`, client board filter, `ServerPluginContext.spawnSession`),
4 new capability specs, merged **PR #142** into `develop`.

---

_Generated from session `019ee67f-db97-7ecd-9b69-d2359b0c4580` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-21. Source extract: `/tmp/session_facts_57496_1784848042.md`._
