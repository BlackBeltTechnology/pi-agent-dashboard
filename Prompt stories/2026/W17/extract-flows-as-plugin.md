---
session: 019dc9f2
week: 2026/W17
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts)"
upgrade_status: pending
openspec_changes: [extract-flows-as-plugin, migrate-flows-content-slots, dashboard-plugin-architecture, extract-openspec-as-plugin, strip-token-backgrounds-in-code-blocks, migrate-flows-jsx-to-slots]
proposal_excerpt: "The dashboard's flow rendering is currently 12 client files (FlowDashboard, FlowAgentCard, FlowAgentDetail, FlowSummary, FlowGraph, FlowArchitect, FlowArchitectDetail, FlowActivityBadge, FlowLaunchDia…"
---

# How we did it: Extract flow rendering into a workspace plugin package — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the `/opsx:ff` command — *"Fast-forward through artifact creation:
generate everything needed to start implementation"* — for the change `extract-flows-as-plugin`.
The **real objective**, which the steering turns clarified, was to physically move the
dashboard's ~12 flow-rendering client files (`FlowDashboard`, `FlowArchitect`,
`FlowAgentDetail`, `FlowSummary`, `FlowGraph`, …) plus their two reducers out of
`packages/client/` and into a new self-contained workspace package
`packages/flows-plugin/` — **without** changing runtime behavior, **without** inventing
new plugin-runtime infrastructure, and **preserving git history** on every moved file.
Anything that couldn't be done cleanly (wiring components into the frozen v0.x slot
contract) was to be *deferred into a follow-up proposal*, not forced.

## 2. TL;DR playbook

1. `/opsx:ff extract-flows-as-plugin` → let the AI scaffold `design.md`, the spec deltas, and `tasks.md`, then `openspec validate --strict`.
2. `/opsx:apply` → the AI runs Task 1.1 (preconditions) FIRST. **Trust the precondition gate** — it will pause if a dependency is missing.
3. When the AI cites a plugin-runtime API as a dependency, **verify it exists**: `grep -rn "registerReducerSlice" packages/`. Here it returned zero hits — the AI had invented it in `design.md`.
4. Steer to the minimal strategy: *"the plugin is a workspace package core imports at compile time — no new plugin-context API."* Have it rewrite `proposal.md` + `design.md` + spec delta + `tasks.md` to match, then re-validate.
5. Move files with `git mv` (history-preserving renames), fix imports as deep relative paths back into `packages/client/`, add a workspace dep, swap the reducer imports.
6. `npm install` (symlinks the workspace) → build the web workspace → `tsc --noEmit` → `vitest run` the plugin + the full suite. Green = no regressions.
7. **Before committing, ask "any side effects?"** — clean up stray `tsc` build artifacts, then re-stage deletes so git re-detects the renames (`R`, not add+delete).
8. Deferred scope → scaffold a follow-up proposal (`migrate-flows-content-slots`), mark the parent's "open a follow-up" task done, and be explicit that *tracked ≠ implemented*.

## 3. How the collaboration unfolded

**Phase 1 — Scaffold (opsx:ff).** The AI created `design.md`, `specs/event-reducer/spec.md`,
and `tasks.md` (10 sections, ~50 tasks: preconditions → scaffold → `git mv` → fix imports →
wire slots + reducer slice → tests → docs → verify) and passed `openspec validate --strict`.
*Why it worked:* the spec-driven schema forced a precondition section up front, which later
caught the design flaw before any code moved.

**Phase 2 — Apply hits a wall.** `/opsx:apply` ran Task 1.1 and **paused**: the design
depended on `pluginContext.registerReducerSlice(...)`, and a `dashboard-plugin-architecture`
archive that wasn't archived. The AI printed a precondition table showing the API *does not
exist*. **Decision point:** the human pushed back — *"in 2026-04-26-dashboard-plugin-architecture
its not mentioned"* — and the AI confirmed: *"I invented that dependency in the design."*

**Phase 3 — Course-correct to compile-time imports.** The AI replaced the fabricated
runtime-API strategy with a **workspace-package-imported-at-compile-time** approach: the
flow reducer files move into the plugin; `event-reducer.ts` imports them from
`@blackbelt-technology/pi-dashboard-flows-plugin`; the reducer contract is unchanged; no new
plugin-context API. It rewrote all four artifacts and re-validated. It *also* self-scoped
Section 6 down to import-path updates only (leaving JSX wiring for a follow-up) because the
frozen v0.x slot contract threads only `{session}`, not `flowState`/`onAbort`/etc.

**Phase 4 — Move + verify.** 12 components + 2 reducers + 3 tests moved via `git mv`;
cross-package shell-util imports rewritten as deep relative paths (documented as v1 debt);
workspace dep wired; reducer imports swapped. Build green, `tsc` clean, **383 test files /
3940 tests pass**, no regressions.

**Phase 5 — Commit hygiene.** The human asked *"any side effect if I commit?"* The AI found
**63 stray `.js`/`.d.ts` artifacts** it had emitted before adding `noEmit: true` to the plugin
tsconfig, and pre-existing unrelated working-tree changes from sibling changes. It deleted the
artifacts, staged only this change's files, and re-staged the deletes so git re-detected all
15 moves as renames (`R`) — shrinking the diff from +3973 to +517/−171. Committed `234b45c`.

**Phase 6 — Defer honestly.** *"Is anything blocking this proposal?"* → the AI split remaining
tasks into deferred-by-design (needs JSX-to-slot migration) vs blocking-only-the-archive
(manual smoke test). It scaffolded `migrate-flows-content-slots/proposal.md` for the richer-slot
scope, then — when asked *"so the deferred ones done?"* — corrected sharply: **only the tracking
is done, not the work**.

**Phase 7 — A small polish.** *"the sub cards darker, but be less darker then parent card"* →
a single-line `AgentCardShell.tsx` change using `color-mix(in_srgb, var(--bg-secondary),
var(--bg-tertiary))` to compute the midpoint at runtime, theme-safe across all 9 themes.

## 4. Prompts that worked

- **The goal prompt** (`/opsx:ff extract-flows-as-plugin`) — effective because it hands the AI
  a structured, validated artifact pipeline. Kickoff improvement: state the *scope ceiling*
  up front ("move code into a package; do NOT introduce new plugin-runtime APIs; defer slot
  wiring").
- **"in 2026-04-26-dashboard-plugin-architecture its not mentioned"** — highest-leverage turn.
  A single factual correction collapsed a fabricated dependency and rerouted the whole design.
  Rewrite for reuse: *"Before building on `registerReducerSlice`, grep for it — I don't think
  that API exists yet."*
- **"Is there any side effect if I commit in this stage?"** — surfaced the 63 stray build
  artifacts and the rename-detection issue *before* they polluted history. Bake this in as a
  standing pre-commit question.
- **"So the deferred ones done?"** — forced the tracked-vs-implemented distinction. A good
  audit prompt: cheap, catches false "done" claims.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Invent a plugin-runtime API (`registerReducerSlice`) in `design.md` and block on it | "in <archived-change> its not mentioned" | State up front: verify every cited runtime API with `grep` before designing on it |
| Over-scope: wire components into slots that don't thread the needed props | (implicit — AI self-caught) reduce Section 6 to import-path updates | Declare the scope ceiling in the goal prompt: "move code only, defer slot wiring" |
| Emit stray `tsc` build artifacts into `packages/client/src/` (missing `noEmit`) | "any side effect if I commit?" | Add `noEmit: true` to a plugin's `tsconfig.json` before ever running `tsc -p` on it |
| Let `git mv` renames regress to add+delete when staging | AI re-staged the deletes | Re-stage deletions so git re-detects renames; verify `R` status before commit |
| Conflate "follow-up proposal created" with "deferred work done" | "So the deferred ones done?" | Always separate *tracked* from *implemented* in the status summary |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session. The repeatable pattern that *should* be
captured is a **"extract-code-into-workspace-plugin"** procedure:

- **What it captures:** move a cohesive set of client components + reducers into a new
  `packages/<name>-plugin/` workspace package using `git mv` (history-preserving), rewire
  imports (deep relative back to client for un-moved utils, workspace dep for the reducer),
  add `noEmit: true` to the plugin tsconfig, add a vitest project, verify build+tsc+full suite.
- **Why it's effective:** it removes the two recurring traps this session hit — fabricated
  runtime dependencies and rename-losing commits — and encodes the compile-time-import
  strategy that needs no new plugin-context API.
- **When to invoke:** any "extract X into its own package/plugin" change where behavior must
  stay identical and history must be preserved.

## 7. Pitfalls & dead ends

- **Fabricated dependency.** The design blocked on `pluginContext.registerReducerSlice`, which
  never existed. *If a precondition cites an API, `grep -rn "<api>" packages/` before trusting it.*
- **Stray build artifacts.** Running `tsc -p packages/flows-plugin/tsconfig.json` without
  `noEmit: true` emitted 63 `.js`/`.d.ts`/`.map` siblings into `packages/client/src/`. *Set
  `noEmit: true` first; if you already emitted, delete before staging.*
- **Renames regressing to add+delete.** Staging after `git mv` lost the rename pairing
  (diff ballooned to +3973). *Re-stage the deletes so git re-detects renames; confirm `R`
  status and a small diff before commit.*
- **False "done".** A scaffolded follow-up proposal is *tracking*, not *implementation*. *Always
  answer "is it done?" by separating tracked vs implemented.*
- **Pre-existing tree state.** ~301 lines of unrelated sibling-change edits were already in the
  tree. *Stage only your change's files by path; never `git add -A` in a busy tree.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change name, the list of files to move, the target package name
(`@blackbelt-technology/pi-dashboard-flows-plugin`), the reducer import site (`event-reducer.ts`).

1. `/opsx:ff <change>` → scaffold + `openspec validate --strict`. State the scope ceiling.
2. `/opsx:apply` → let Task 1.1 preconditions run; `grep` every cited runtime API.
3. Correct any fabricated dependency → compile-time-import strategy; rewrite all 4 artifacts; re-validate.
4. `git mv` all components + reducers + tests; add `noEmit: true` to the plugin tsconfig.
5. Fix imports (deep-relative for un-moved utils, workspace dep for the reducer); `npm install`.
6. Build web workspace → `tsc --noEmit` → `vitest run <plugin>` → full suite. Expect green, no regressions.
7. "Any side effects?" → delete stray artifacts, stage by path, re-stage deletes for rename detection, commit.
8. Scaffold a follow-up proposal for deferred scope; mark the parent's "open follow-up" task done; state tracked ≠ implemented.

**Final artifacts:** `packages/flows-plugin/` (new package: `package.json`, `tsconfig.json`,
`vitest.config.ts`, `README.md`, `src/reducer.ts`, `src/client/index.tsx`, moved components +
tests); corrected `extract-flows-as-plugin/{proposal,design,tasks}.md` + spec deltas;
`migrate-flows-content-slots/proposal.md`; commit `234b45c` (34 files, +517/−171, 15 renames).

---

_Generated from session `019dc9f2` · `pi-agent-dashboard` · 2026-04-26. Source extract: session facts sheet._
