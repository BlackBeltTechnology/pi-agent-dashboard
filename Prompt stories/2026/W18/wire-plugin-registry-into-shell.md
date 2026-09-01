---
session: 019df046
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [migrate-flows-jsx-to-slots, wire-plugin-registry-into-shell]
---

# How we did it: Wire the plugin registry into the dashboard shell — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a throwaway `"Is there anything to clarify?"` — the operator
was staring at pi's slash-command help, not yet committed to a task. The real
objective crystallised one prompt later: **`switch spec wire-plugin-registry-into-shell`**,
i.e. *implement the OpenSpec change that makes the dashboard client build a static
plugin registry at Vite build time and have the React shell (`App.tsx`) consume it via
the slot system*, replacing the legacy hard-coded JSX for flows/jj badges in
`SessionCard.tsx`. The finished result: 30 tasks driven to done (7 explicitly
deferred), a follow-up change scaffolded for the deferred work, specs synced, and the
change archived + committed.

## 2. TL;DR playbook

1. Attach the change to the session, then ask the AI *"Is there anything to clarify?"*
   **before** implementing — it surfaces design landmines while they're still cheap.
2. Run `/opsx:apply wire-plugin-registry-into-shell`; let it read the tasks/design
   context first and report progress as `N/30`.
3. When the AI pauses on a real contract mismatch (here: slot renders
   `<Component session={session}/>` but `FlowActivityBadge`/`SessionFlowActions` don't
   accept `session`, and the vite-plugin never emits `predicate`), **pick an option
   number to unblock** — don't relitigate.
4. Let it split the blocked work: wire the safe path (vite.config → generated stub →
   `App.tsx` `addClaim`), and **defer** the component-signature rework by temporarily
   emptying the two `session-card-*` claims in `flows-plugin/package.json`.
5. Verify with a real build (`npm run build`) + the new
   `plugin-registry-populated.test.ts` (skips on stub, asserts ≥1 claim post-build);
   run the full suite with `HOME=$(mktemp -d) npx vitest run …` to dodge home-dir state.
6. Say **`Create a new proposal for deferred`** — the AI scaffolds
   `migrate-flows-jsx-to-slots` (proposal/design/tasks/spec) straight from its own
   deferral analysis.
7. Later: `mark the deferred tasks as done`, `/opsx:archive`, then `git commit`
   (exclude unrelated build artifacts like `.last-arch`).

## 3. How the collaboration unfolded

**Discovery / attach.** The AI resisted inventing a task from the CLI help dump, then
attached `wire-plugin-registry-into-shell` to the session via the dashboard API. A
first stumble: several `curl`/`api.sh` probes against `/api/sessions` failed before it
found the working health/attach endpoints. *Effective bit:* it kept the goal paused
until the proposal was actually attached rather than guessing scope.

**Pre-flight clarify.** Asked again to clarify, the AI didn't just say "ready" — it
listed three decision points (co-tenant removal scope, stub-vs-pure-ignore for the
generated dir, start-now-or-wait). This is the move worth copying: force the
ambiguities to the surface *before* the apply loop.

**Apply with a mid-flight stop.** During `/opsx:apply` the AI hit two structural
problems that would have caused a runtime regression if Section 5 were followed
verbatim (prop-contract mismatch + missing `predicate` emission). It **stopped and
asked** instead of plowing through. The human answered `1`, and the AI produced a
concrete split plan: do tasks 1–4 + jj removal now; defer flows component rework to a
new change; temporarily empty the flows claims so the registry stays correct.

**Generate + verify.** It edited `vite.config.ts` to invoke
`viteDashboardPluginsPlugin(repoRoot)` (switching a failing dynamic `.ts` import to a
static, esbuild-bundled one), committed a `.gitignore`'d stub registry, wired
`App.tsx` to `addClaim` each `PLUGIN_REGISTRY` entry, added a regression test, and
confirmed via a real build that the registry populated (jj: 6 claims + bridge plugin).

**Scaffold the deferral.** On `Create a new proposal for deferred`, the AI turned its
own pause analysis into a full `migrate-flows-jsx-to-slots` change and validated it
`--strict`.

**Close out (days later).** `mark the deferred tasks as done` → `/opsx:archive`
(specs synced to main) → `git commit e18c0b8d`, deliberately leaving `.last-arch`
unstaged as an unrelated arm64→x64 build flip.

## 4. Prompts that worked

- **Goal prompt — `switch spec wire-plugin-registry-into-shell`.** Terse but
  unambiguous: it names the exact change, letting the AI attach + load real context
  instead of inferring. *Stronger version:* `attach and switch to
  wire-plugin-registry-into-shell, then tell me what's unclear before implementing`.
- **`Is there anything to clarify?`** (used twice) — a high-leverage *pre-implementation*
  probe. It's what surfaced the two design landmines before code was written.
- **`1`** — a one-character unlock. When the AI presents numbered options at a genuine
  fork, answering the number keeps momentum without re-explaining.
- **`Create a new proposal for deferred`** — converts a deferral note into a tracked,
  validated OpenSpec change in one move. *Stronger version:* name it, e.g.
  `create a new proposal migrate-flows-jsx-to-slots for the deferred flows work`.
- **`mark the deferred tasks as done`** — explicit permission to close the tracking
  loop once the handoff change exists.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Idle on the CLI-help dump waiting for direction | Naming the exact change (`switch spec …`) | Open with the change name + goal, not a bare "clarify?" |
| Want to follow Section 5 verbatim (would cause a runtime regression) | Pausing it, then answering `1` at the fork | State up front: "stop and ask if a task conflicts with the actual component/slot contract" |
| Treat the whole change as one atomic unit | Approving the split (do-now vs defer) | Pre-declare that blocked sub-tasks get deferred to a follow-up change, not forced |
| Leave deferred tasks tracked open indefinitely | `mark the deferred tasks as done` after scaffolding the handoff | Require a linked handoff change before closing deferred items |
| Stage every dirty file at commit | Excluding `.last-arch` (unrelated arch flip) | Review `git status` and exclude build artifacts before `git commit` |

## 6. Skills, tools & memory created — and why they're effective

No reusable skill or memory was saved this session. One **subagent** was spawned:

- **`general-purpose` — "Update file-index docs."** Per the repo's AGENTS.md rule that
  `docs/` writes are delegated, the AI offloaded the doc-tree update to a subagent so
  the file-index churn stayed out of the main implementation context. *Invoke it* any
  time a landed change adds/moves files that need per-file `AGENTS.md` rows.

*Skill that should exist:* an **"apply-with-deferral"** playbook — when an OpenSpec
apply hits a task that conflicts with real code contracts, the pattern (pause → split →
temporarily neuter the blocked manifest claims → scaffold a follow-up change →
re-tighten the regression test on merge) is repeatable and was reconstructed by hand
here.

## 7. Pitfalls & dead ends

- **`/api/sessions` probing failed 4×.** The early `curl`/`api.sh` calls against the
  dashboard returned nothing usable. *If you hit this:* go straight to
  `/api/health` to confirm the port/mode, then use the attach-proposal endpoint.
- **Dynamic `import()` of a `.ts` vite-plugin export failed** — Node can't load raw
  `.ts` without a loader. *Fix:* use a **static** import in `vite.config.ts`; esbuild
  bundles it. (1 of 6 failed commands traced to this.)
- **`npx vitest run` picked up home-dir state.** *Fix:* prefix with
  `HOME=$(mktemp -d)` to isolate the run.
- **The regression test failed on the committed stub** by design — it *skips* on the
  stub and only asserts `≥1 claim` after a real build. Don't "fix" the skip.
- **`.last-arch` appears dirty after `npm run build`** (arm64→x64 flip). It's a build
  artifact — leave it unstaged, don't commit it.
- **Task text can be approximate.** tasks.md said `register(manifest, claim)`; the real
  API is `addClaim(ClaimEntry)`. Verify the actual export before coding the wiring.

## 8. Reproduce it faster — checklist

Inputs to have ready: the dashboard running (know its port via `/api/health`), the
`wire-plugin-registry-into-shell` change present in `openspec/changes/`.

- [ ] Attach + `switch spec wire-plugin-registry-into-shell`.
- [ ] Ask *"anything to clarify?"* — capture the design landmines first.
- [ ] `/opsx:apply`; let it read context, report `N/30`.
- [ ] At the contract-mismatch fork, answer the option number to unblock.
- [ ] Wire `vite.config.ts` (static `viteDashboardPluginsPlugin` import) → stub +
      `.gitignore` → `App.tsx` `addClaim`; defer flows by emptying its claims.
- [ ] Verify: `npm run build`; `HOME=$(mktemp -d) npx vitest run …plugin-registry-populated…`.
- [ ] `Create a new proposal for deferred` → validate `--strict`.
- [ ] `mark the deferred tasks as done` → `/opsx:archive` → `git commit` (skip `.last-arch`).

Final artifacts: `packages/client/vite.config.ts`, `packages/client/src/App.tsx`,
`packages/client/src/generated/{plugin-registry.tsx,.gitignore}`,
`packages/client/src/__tests__/plugin-registry-populated.test.ts`,
`openspec/changes/migrate-flows-jsx-to-slots/*`, archived
`wire-plugin-registry-into-shell`, commit `e18c0b8d`.

---

_Generated from session `019df046-d42e-77e6-92b6-71c9fcaac580` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-10. Source extract: session facts sheet (mktemp)._
