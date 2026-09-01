---
session: 019f2866
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts); large facts sheet (~13480 tok)"
upgrade_status: pending
openspec_changes: [project-init-skill-and-profiles]
proposal_excerpt: "The `generalize-worktree-init-hook` change makes the Initialize button run a project's declared init hook. But a brand-new, unconfigured directory has **no** hook, no `AGENTS.md`, no toolset settings — nothing to run.…"
---

# How we did it: project-init-skill-and-profiles — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single command: `/skill:openspec-apply-change project-init-skill-and-profiles`.
There was no free-text objective — the *spec was the ask*. The real objective, drawn
out by the six steering turns that followed, was: **implement the `project-init` skill
end-to-end** so that the dashboard's polymorphic "Initialize" button can bootstrap a
*bare, unconfigured* directory into a working pi project. That meant shipping selectable
**project profiles** (`coding`, `docs`), a DOX doctrine seed, an interactive scaffold
flow, the server plumbing to inject an initial `/skill:project-init` prompt on spawn,
the client routing for the no-hook button state, tests at every layer, and finally
**shipping the change** (archive → PR → CI → CodeRabbit → merge). The proposal framed
the gap precisely: *the Initialize button can run a declared init hook, but a brand-new
directory has no hook, no `AGENTS.md`, no settings — nothing to run.*

## 2. TL;DR playbook

1. **Kick off from the spec, not prose:** `/skill:openspec-apply-change <change-name>`.
   Let the apply skill enumerate the tasks; don't hand-write a plan.
2. **Map the mechanism before writing code.** Investigate the three load-bearing seams
   first: how skills ship (`packages/extension/package.json` `pi.skills[]`), where
   *testable* code can live (extension vitest only sees `src/**/__tests__/`), and how
   spawn injection could work (mirror the existing `pendingAttachRegistry`).
3. **Split data from logic.** Markdown profiles/doctrine under `.pi/skills/project-init/`;
   unit-tested TS (resolver, seed, scaffold, stack-detect) under `src/project-init/`.
4. **Build server injection by copying the nearest working pattern** —
   `pending-attach-registry` → `pending-initial-prompt-registry`, threaded identically
   through handler-context → browser-gateway → event-wiring → server.ts.
5. **Write tests alongside each module** and run the package suite
   (`HOME=$(mktemp -d) npx vitest run project-init`) before moving to the next layer.
6. **Answer steering with the smallest coherent change.** "Make coding tech-dependent"
   → a tested `detect-stack.ts` + `{{PLACEHOLDER}}` templates, not a rewrite.
7. **Add exactly the E2E the user scopes** ("Level 1") — pin the button→spawn seam
   against the Docker harness; leave the scaffold *conversation* to unit tests.
8. **Ship via the skill:** `ship-change` → verify gate → archive+sync → PR →
   watch CI → triage CodeRabbit → auto-apply safe fixes + tests → re-push → squash-merge
   → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / mechanism-mapping.** The AI opened the change's context files
and specs, confirmed the prerequisite change (`generalize-worktree-init-hook`) was
archived, then spent real effort probing three seams: skill delivery, where testable
code lives, and how spawn works today (a bare `spawn_session { cwd }` with no
prompt-injection path). *Why it worked:* it refused to write a large multi-component
change until the load-bearing mechanisms were pinned — and it surfaced them to the human
as an explicit plan before coding.

**Phase 2 — Build the tested core.** It authored the profile resolver, doctrine seed,
DOX kb-config helper, and scaffold under `src/project-init/`, each with a vitest file,
running `npx vitest run project-init` to keep all 22 green before proceeding.

**Phase 3 — Server + client plumbing.** It added `initialPrompt` to the `spawn_session`
protocol message and built `pending-initial-prompt-registry` as a near-exact mirror of
`pending-attach-registry`, threading it through the same four files. Client side: the
polymorphic no-hook Initialize branch in `WorktreeInitButton`, wired up through
`FolderActionBar` → `SessionList` → `useSessionActions`.

**Phase 4 — Steering-driven refinements.** Four short human prompts each triggered a
scoped addition (see §5): stack-awareness, a clarifying answer, a design confirmation,
and a Level-1 E2E.

**Phase 5 — Ship.** On "Use ship-change skill" the AI ran the full ship pipeline:
verify gate (correctly quarantining two pre-existing/flaky test failures), archive +
spec sync, surgical commit (reverting two unrelated sweep-in diffs), PR #221, CI watch,
CodeRabbit triage (4 comments → 2 Major bugs auto-fixed with new tests), re-push,
squash-merge, worktree removal.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change project-init-skill-and-profiles`.
  Effective because the change was already fully specified: the skill supplies the task
  list and the AI executes it. *Stronger next time:* nothing to change — a spec-driven
  kickoff is the ideal shape when the proposal already exists.
- **"The coding be technology dependent"** (steering #1) — a 5-word prompt that
  unlocked the biggest design improvement: it forced the hard-coded npm profile into a
  detect-and-substitute model covering pnpm/yarn/bun/cargo/go/pip/poetry/maven/gradle.
- **"Level 1"** (steering #6) — a two-word scope decision that told the AI *exactly*
  how much E2E to write, preventing over-testing the scaffold conversation.
- **"Use ship-change skill"** — delegated the entire land-it pipeline to a known skill
  in one line.

*Rewrite of the weakest prompt:* "How can the user set docs project type. The init will
ask?" was a question, not a directive — a crisper version is *"Confirm the profile is
chosen interactively at init time via ask_user, not a pre-set config value."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Hard-code the `coding` profile to npm/Node (`npm ci`, `npm test`) | "The coding be technology dependent" | Making stack-aware profiles use `{{PLACEHOLDER}}` templates + a tested `detect-stack.ts` from the start |
| Leave the profile-selection mechanism implicit | "How can the user set docs project type. The init will ask?" | Stating up front that the profile *is* the project type, chosen via `ask_user` at init |
| Risk over-engineering the selection UX | "Interactive pin" (interactive pick) | Confirming: init session always asks; the button just spawns `/skill:project-init` |
| Consider skipping automated coverage of the new seam | "Is it possible to do in docker test and playwright?" then "Level 1" | Defaulting to one Level-1 harness E2E for a new button→spawn seam |
| Nearly commit two unrelated sweep-in diffs (`manage-flows` flag, generated `plugin-registry.tsx`) | (self-caught during ship) | Running `git status` triage before every commit; revert artifacts not tied to the change |

## 6. Skills, tools & memory created — and why they're effective

No new *skill* was authored — this session **consumed** existing skills
(`openspec-apply-change`, `ship-change`) and produced the `project-init` skill *as its
deliverable*. The reusable assets it created:

- **`project-init` skill + profiles (`coding`, `docs`)** — captures the whole
  bare-directory bootstrap flow (list profiles → `ask_user` → detect stack → preview →
  confirm → scaffold). Effective because it turns "set up a new pi project" into a
  one-button, repeatable action. Invoke it whenever an unconfigured directory needs
  `AGENTS.md` + settings + prompts.
- **`pending-initial-prompt-registry`** — a general server seam for injecting an initial
  prompt into a freshly spawned session. Reusable for any future "spawn a session that
  starts by running skill X" feature.
- **`detect-stack.ts`** — a standalone, tested stack detector (lockfile beats bare
  manifest; `pyproject.toml [tool.poetry]` → poetry else pip). Reusable anywhere the
  agent must adapt commands to a repo's toolchain.

*Recommended follow-up skill:* the "mirror an existing registry to add a new spawn
injection" pattern (copy `pending-attach-registry`, thread through the same 4 files) is
repeatable enough to deserve its own project skill.

## 7. Pitfalls & dead ends

- **Extension vitest only includes `src/**/__tests__/`.** Unit-tested logic *must* live
  under `packages/extension/src/project-init/`, not beside the markdown profiles. Put
  logic in TS, data in `.pi/skills/`.
- **Running TS from the skill's bash context is fragile** across install modes (npm
  global / docker / dev). The skill drives the flow with native agent tools; the TS
  modules stay the canonical *unit-tested reference* of the rules, not the runtime.
- **`Partial<KbConfig>` is strict** — the nested `DirectoryLevelAgentsConfig` shape must
  be fully supplied or cast in tests, even though the runtime merge fills it.
- **First-time Docker harness build exceeds the 180s health window.** Pre-build the
  image once (`docker build` warms BuildKit's content-addressed layer cache), then the
  managed E2E run boots fast within the window.
- **Don't attach to a running harness from another worktree** — it's built from stale
  code and won't have your new testids. Force a fresh managed build from *this* worktree.
- **Two full-suite test failures were red herrings** — `node-electron-resolution.test.ts`
  reads the real `~/.pi-dashboard/node`, and `doctor-route.test.ts` is a timing flake
  (`4110ms > 3000ms` under load; passes in isolation). Confirm a failure is pre-existing
  before treating it as yours.
- **`git branch -d` after a squash-merge reports "unmerged"** — use `-D` once the remote
  merge is confirmed; and the Bash tool stays pinned to a removed worktree's cwd, so
  re-anchor to the parent before cleanup.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- An OpenSpec change already proposed (`openspec/changes/<name>/` with tasks.md + specs).
- A worktree checked out for the change; Docker available for the E2E harness.
- `gh` authenticated (PR + CI watch + CodeRabbit triage).

**Steps:**
1. `/skill:openspec-apply-change <change-name>` — let it enumerate tasks.
2. Map the 3 seams (skill delivery / testable-code location / spawn injection) *before* coding.
3. Data → `.pi/skills/<skill>/`; logic → `src/<skill>/` with vitest files.
4. Copy the nearest working registry for any new spawn-injection seam.
5. `HOME=$(mktemp -d) npx vitest run <pattern>` per layer; keep green before advancing.
6. Answer each steering prompt with the *smallest coherent* change.
7. Add one Level-1 harness E2E for a new button→spawn seam; pre-build the Docker image.
8. `ship-change`: verify (quarantine known flakes) → archive+sync → surgical commit →
   PR → CI → auto-fix CodeRabbit + tests → squash-merge → remove worktree.

**Final artifacts produced:**
- `packages/extension/.pi/skills/project-init/` (SKILL.md, profiles, dox-doctrine.md)
- `packages/extension/src/project-init/` (profiles.ts, seed-doctrine.ts, dox-kb-config.ts, scaffold.ts, detect-stack.ts + tests)
- `packages/server/src/pending-initial-prompt-registry.ts` (+ tests, protocol + wiring edits)
- `packages/client/src/components/WorktreeInitButton.tsx` (polymorphic no-hook branch)
- `tests/e2e/project-init-button.spec.ts`
- PR [#221](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/221) → squash-merged (SHA `04ae45aad`).

---

_Generated from session `019f2866-0c2f-781f-b20e-ee895045b6a0` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-03. Source extract: `/tmp/facts-1784849185N.md`._
