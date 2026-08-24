---
session: 019ebdbc
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (14 user prompts); large facts sheet (~15800 tok)"
upgrade_status: pending
openspec_changes: [add-goal-continuation-plugin]
proposal_excerpt: "Hermes Agent ships `/goal` — a standing objective that survives across turns. After every turn a lightweight judge model decides \"done or continue\"; if not done, the agent feeds itself a continuation prompt and keeps…"
---

# How we did it: ship the goal-continuation dashboard plugin end-to-end — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The opening prompt was narrow: *"Proposal is add-goal-continuation-plugin. Is it possible
to create mockups inside the proposal's dir and plan the UI of related changes?"* — just
mockups + a UI plan for an OpenSpec change. But the steering turns kept widening the scope
until the real objective emerged: **take the `add-goal-continuation-plugin` OpenSpec change
from proposal to a merged, npm-published, first-class dashboard plugin** — including a design
pivot (require an external pi extension instead of vendoring its judge), a piece of *new core
infrastructure* (a generic plugin bridge↔server channel), full tests, delegated docs, a PR,
a rebase, and a manual first npm publish. One session carried it from "can we sketch the UI?"
to `@blackbelt-technology/pi-dashboard-goal-plugin@0.5.4` live on npm and PR #103 merged.

## 2. TL;DR playbook

1. **Ground the mockup in real UI first.** Before designing, drive the browser at the running
   dashboard and read `SessionCard.tsx` to capture the *actual* card tokens/anatomy — then build
   the mockup to fit, not from imagination.
2. **Run `/skill:openspec-apply-change <name>`** to drive the implementation from `tasks.md`.
3. **On any large/multi-package change, stop and check in.** State the load-bearing facts and a
   phased plan before writing code (the repo's "check in before a major change" rule).
4. **When a directive pivots the design** (here: *require the extension, don't vendor it*),
   verify the new assumption in source, then **update the OpenSpec artifacts** (proposal/design/
   tasks/spec) before continuing to build.
5. **Build low-risk, self-contained pieces TDD-first** (the `enqueueSystemFollowup` safety-net),
   using the repo's "pure mirror" test convention (re-implement logic in a harness, no import).
6. **When infra is missing, build the infra first.** A no-op `registerPiHandler` stub forced a
   real generic `plugin_pi_message`/`plugin_event`/`onEvent`/`sendToSession` channel on
   `ServerPluginContext`.
7. **Wire the plugin the way siblings are wired**: 3-entry manifest (bridge/server/client),
   `requires.piExtensions`, `npm run generate:plugin-registry`, declare as a `packages/client` dep.
8. **Delegate every `docs/` write to a subagent** with the caveman-style rule passed verbatim
   (AGENTS.md gate); write the plugin README yourself (not under `docs/`).
9. **Commit → PR → rebase develop → publish → merge**, verifying each gate (typecheck, tests,
   CI, CodeRabbit) and honestly separating your failures from pre-existing/flaky ones.

## 3. How the collaboration unfolded

**Phase 1 — Design grounded in reality (browser + source).** The AI first read the proposal and
the jj/flows plugin client conventions, produced a self-contained themeable `goal-ui.html` mockup
+ `ui-plan.md`. The human then steered: *capture the current card style with the browser and make
the mockup fit the real card*. The AI drove the browser at the live dashboard, but `eval` returned
blank, so it fell back to reading `SessionCard.tsx` + `index.css` for the authoritative card tokens,
then rebuilt the mockup to render a real session card with the GoalChip on Line 2 and the Set-Goal
control as an expandable row. *Effective bit:* **source is authoritative; the browser is for
verifying the render, not for scraping structure.**

**Phase 2 — Apply the change, then pivot the design.** `/skill:openspec-apply-change` kicked off a
29-task, multi-package change. The AI correctly **stopped and checked in** with a risk table before
coding. The human then issued the load-bearing directive: *install the external core
(`@ricoyudog/pi-goal-hermes`) as a required pi extension and gate the plugin on it (like honcho/jj)*
— rather than vendoring the judge. The AI traced the extension in source, found it was a complete
self-contained extension that runs its own judge loop and continuation injection and emits
`pi-goal-hermes:event` custom messages, confirmed this collided with the written design, re-confirmed
direction, then **rewrote the OpenSpec artifacts** (Decisions 1–3, tasks, spec) to match the pivot.

**Phase 3 — Build the missing infra.** Implementing Section 1 (`enqueueSystemFollowup` safety-net,
TDD, 7 mirror tests) was easy. But the plugin data path was blocked: `registerPiHandler` was a
**no-op stub** and plugin servers had no event-stream subscription. Instead of hacking around it, the
AI built real generic infra: a `PluginPiMessage` protocol envelope, a bridge `dashboard:plugin-message`
forward, a real `registerPiHandler` registry + an `onEvent` raw-event subscription on
`ServerPluginContext`, dispatched in `event-wiring.ts`, plus a `sendToSession` capability for the
control path. *Effective bit:* **the human explicitly chose "build the infra first" when told the
supported path didn't exist — that decision unblocked everything downstream.**

**Phase 4 — Scaffold, wire, test the plugin.** New `packages/goal-plugin/` with a 3-entry manifest
(templated from jj/flows), bridge entry (`message_end` → snapshot → `dashboard:plugin-message`),
server entry (cache + `broadcastToSubscribers` + `plugin_action` → `sendToSession("/goal …")`),
client (`deriveSnapshot` reducer, `GoalChip`, `GoalControl`, predicates). Regenerated the plugin
registry, typechecked repo-wide, added ~23 plugin tests.

**Phase 5 — Docs, ship, publish, merge.** README written by the AI directly; all `docs/` rows
delegated to a subagent with the caveman rule verbatim. Then commit → PR #103 → declare the plugin
as a `packages/client` dep at lockstep `0.5.4` → rebase onto develop (resolving a `file-index-shared.md`
conflict by keeping both adjacent rows) → **manual first npm publish** (CI can't seed a brand-new
package) → merge + delete branch + remove worktree.

## 4. Prompts that worked

- **Goal prompt** — *"Is it possible to create mockups inside the proposal's dir and plan the UI?"*
  Good kickoff because it named the OpenSpec change and scoped a concrete first artifact. Stronger
  version: *"For OpenSpec change X, add `mockups/` (a real-card-accurate HTML mockup + `ui-plan.md`)
  grounded in the live SessionCard design, then apply the change."* — states the grounding rule up front.
- **High-leverage pivot** — *"Install the external core to pi and add to plugin as required extension.
  So the plugin activates when this extension is installed (like honcho, workflow)."* One sentence that
  redirected the entire architecture; the "like honcho/jj" anchor gave the AI a concrete pattern to copy.
- **High-leverage grounding** — *"Use browser to capture current card style and make examples/mockups
  how to fit in current card design."* Forced design-from-reality instead of design-from-imagination.
- **Short unlocks** — *"go on"*, *"a"* let the AI continue multi-section work without re-planning;
  *"Add plugin as npm package with 0.5.4 version - as other plugins"* set the exact convention target.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Design the mockup from plugin conventions in the abstract | "capture current card style with the browser and fit it" | State up front: mockups must match live `SessionCard.tsx` tokens/anatomy |
| Follow the written design (vendor the judge) | "install the external core as a *required extension*, gate like honcho/jj" | Decide vendor-vs-require in the proposal before apply; name the sibling pattern |
| Treat a stubbed API as usable | (the AI caught it) "build the infra first" | Grep the target API for `no-op`/stub before designing a data path through it |
| Mark deferred/manual tasks (§4.4, §7.x) as done in `tasks.md` | (the AI refused) stashed + dropped the false-completion edit | Never check off tasks not actually run; keep `tasks.md` honest |

Also imposed as quality bars: separate *your* test failures from pre-existing/flaky ones (verify against
baseline `develop`), and keep the working tree clean (exclude the local `.pi/settings.json` artifact).

## 6. Skills, tools & memory created — and why they're effective

- **Memory (tool-quirk):** *"running vitest directly aborts with a test-isolation guard unless HOME is
  an ephemeral dir. Use `npm test` (sets HOME to tmp) or prefix `HOME=$(mktemp -d) npx vitest run <file>`."*
  Removes a recurring dead-end — anyone running a single test file directly hits the guard. Invoke it the
  moment `npx vitest run <file>` aborts on isolation.
- **Subagent (`general-purpose` / DocScribe pattern):** delegated all `docs/` writes with the caveman
  rule verbatim and every fact pre-supplied. Keeps the AGENTS.md docs-gate satisfied and keeps the
  facts/reasoning out of the main context. Invoke whenever a landed change needs `docs/` rows.
- **Recommended skill to create:** a *"publish a brand-new dashboard plugin"* project skill capturing
  the lockstep-version + `packages/client` dep + `generate:plugin-registry` (prod form, no demo fixture)
  + manual-first-`npm publish` (OIDC grey-lock) sequence — this session rediscovered all of it by hand.

## 7. Pitfalls & dead ends

- **Worktree had no `node_modules`** → cross-package imports resolved up to the *main repo's* `packages/`,
  so `tsc` showed stale types for your edited sources. Fix: run `npm install` inside the worktree.
- **`registerPiHandler` was a no-op stub** and `ServerPluginContext.eventStore` is poll-only → a bridge
  entry cannot push to its plugin server. Don't design through it; the fix here was building real infra.
- **Browser `eval` returned blank / didn't return** → don't scrape DOM structure via eval; read the source
  component for authoritative markup and use the browser only to verify the render.
- **`git rebase --continue` hung opening an editor** → run non-interactively: `GIT_EDITOR=true git rebase --continue`.
- **`gh pr merge --delete-branch` failed** because develop was checked out in the main worktree (couldn't
  switch local branches) → the GitHub merge still succeeded; delete the remote branch manually, then
  `git worktree remove` + delete the local branch.
- **PR body with an apostrophe broke nested shell quoting** → write the body to a file and use `--body-file`.
- **First commit captured the dev-mode plugin-registry** (included the `demo` fixture) → the npm `prepare`
  hook regenerates the prod form (goal in, demo out); commit that.
- **npm first publish of a brand-new package must be a manual local `npm publish`** — CI's Trusted
  Publisher/OIDC stays grey-locked until ≥1 version exists. Configure Trusted Publisher in the npmjs UI afterward.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; the external extension to require
(`@ricoyudog/pi-goal-hermes`); a running dashboard for browser verification; npm login with publish rights.

- [ ] Ground the mockup: browser at live dashboard + read `SessionCard.tsx`/`index.css` → build
      `openspec/changes/<name>/mockups/{goal-ui.html,ui-plan.md}` to match real card tokens.
- [ ] `/skill:openspec-apply-change <name>`; **check in with a risk table before coding** on a large change.
- [ ] Confirm the vendor-vs-require design decision; if pivoting, verify in source and update proposal/design/tasks/spec.
- [ ] Build self-contained core TDD-first (`enqueueSystemFollowup`), repo "pure mirror" test convention.
- [ ] If the plugin data path is stubbed, build the generic infra first (`plugin_pi_message` / real
      `registerPiHandler` / `onEvent` / `sendToSession`).
- [ ] Scaffold `packages/goal-plugin/` (3-entry manifest, `requires.piExtensions`), `npm run generate:plugin-registry`,
      declare as a `packages/client` dep at lockstep version.
- [ ] Test with ephemeral HOME (`npm test` or `HOME=$(mktemp -d) npx vitest run …`); verify failures vs baseline develop.
- [ ] Delegate `docs/` rows to a subagent (caveman rule verbatim); write the plugin README yourself.
- [ ] Commit → PR (`--body-file`) → rebase develop (`GIT_EDITOR=true`) → **manual first `npm publish`** →
      squash-merge → delete remote branch + `git worktree remove`.

**Final artifacts:** `packages/goal-plugin/` (bridge/server/client + tests + README); generic plugin
channel across `packages/{shared,server,dashboard-plugin-runtime,client}`; `enqueueSystemFollowup` in
`packages/extension/src/bridge.ts`; updated OpenSpec artifacts + mockups; PR #103 (merged);
`@blackbelt-technology/pi-dashboard-goal-plugin@0.5.4` live on npm.

---

_Generated from session `019ebdbc-0e2b-7d0c-abba-abddd15cdfc3` · `pi-agent-dashboard` · 2026-06-13. Source extract: deterministic facts sheet._
