---
session: 019f58f0
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-modular-doctor-skill]
proposal_excerpt: "Diagnosing why pi-flows, the Anthropic-messages bridge, or model resolution is broken currently takes a manual, expert-only investigation across many disconnected surfaces. A single real incident required tracing: two…"
---

# How we did it: build & ship the modular doctor skill — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change add-modular-doctor-skill
```

The real objective: take an already-planned OpenSpec change (`add-modular-doctor-skill`
— a spec-driven, 30-task proposal) and drive it end-to-end from an empty worktree to a
merged PR. Concretely: implement a **modular, self-updating doctor diagnostic skill** in
`packages/extension/.pi/skills/doctor/` (a thin router that derives its symptom map from
per-module front-matter, seven capability modules, a shared `_lib` core wrapping existing
`shared/` resolver primitives, and a two-tier semantic-hash self-update), get every task
green, then archive + ship it. The second prompt (`ship change`) confirmed the full
build→verify→archive→PR→merge→cleanup pipeline was in scope, not just the code.

## 2. TL;DR playbook

1. **Kick off with the apply skill against a named change:** `/skill:openspec-apply-change add-modular-doctor-skill`. Let the AI read `tasks.md` + `proposal.md` + `design.md` first — do not let it start writing before it has the full task list.
2. **Force a discovery pass before any code:** have it enumerate existing primitives (`packages/shared/src` resolvers, skill conventions, vitest config, existing test import style) so new code *wraps* rather than reimplements.
3. **Build the testable core first (`_lib/*.ts`), then the declarative assets (module MDs, router SKILL.md), then seed generated artifacts** (`regenerate.ts --write` for the `.knowledge.hash` sidecars).
4. **Write the test suite against real modules + a temp fixture; run it scoped** (`HOME=$(mktemp -d) npx vitest run src/__tests__/doctor`) before the full extension suite.
5. **Run the real quality gate the repo uses, not a proxy:** root `npx tsc --noEmit` + `npx biome check --error-on-warnings` on the changed paths. Fix complexity warnings (they fail the gate).
6. **Flip `tasks.md` checkboxes with `sed`, section by section**, only after each section's work is actually verified — the atomic batch edit silently no-ops, sed is reliable.
7. **Execute the "manual" §8 validation tasks programmatically** (server-down file-derived run, peer-rename drift check with revert) instead of hand-waving them.
8. **Say `ship change`** to trigger the full gate: verify → build → `openspec archive` → commit (`-F` file, never inline backticks) → push → `gh pr create` → watch CI → check CodeRabbit → squash-merge → remove worktree.
9. **When the worktree suite shows failures, isolate them by package** before panicking — re-run the suspect suites on the `develop` main checkout to prove they're environmental (worktree lacks root `node_modules`).

## 3. How the collaboration unfolded

The whole change ran on **two user prompts** and ~46 minutes; the AI was Opus at
`xhigh`/`high` thinking. Phases:

- **Discovery (read-only).** The AI read `tasks.md`/`proposal.md`, then ran a burst of
  `find`/`grep`/`head` commands to map existing resolver primitives, skill layout, vitest
  workspace config, and test import conventions. *Why it worked:* it explicitly stated
  "let me examine the existing primitives before implementing," so the `_lib` wrapped
  `shared/` resolvers instead of duplicating them.
- **Generate core → assets.** It wrote the 9 `_lib/*.ts` files first (router topo-sort,
  checks, provenance, server-tier graceful-degrade, knowledge-hash + derive-tokens +
  regenerate), then the 7 capability module MDs with a uniform 5-part contract, then the
  thin router `SKILL.md`, then seeded the `.knowledge.hash` sidecars by running
  `regenerate.ts --write` against real repo sources.
- **Verify.** Doctor tests scoped first (45 pass), then the full extension suite
  (1175 pass), then root `tsc --noEmit` and Biome. A single Biome complexity warning on
  `parseFrontMatter` was refactored down because `--error-on-warnings` fails the gate.
- **Task-close + docs.** Checkboxes flipped with `sed` (the atomic batch edit didn't
  apply — noted below). Docs handled per the repo's per-directory `AGENTS.md` tree; the
  `docs/doctor-skill.md` prose was **delegated to a `general-purpose` subagent** in
  caveman style per Rule 6. The §8 "manual" tasks were actually executed.
- **Ship.** `ship change` ran the gate. 18 worktree test failures surfaced; the AI
  isolated them to untouched packages (`image-fit` Jimp, `browse-endpoint` node_modules),
  re-ran those suites on the `develop` checkout (72/72 green) to prove they were worktree
  artifacts, then `openspec archive` → commit → push → PR #295 → watched CI green
  (10m28s) → CodeRabbit clean → squash-merge → worktree + branch cleanup.

Decision points the human owned: the initial *scope* (apply the whole change), and the
*ship* unlock. Everything else the AI drove autonomously.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change add-modular-doctor-skill`.** Effective
  because it names the exact change and hands control to a skill that already knows the
  apply discipline (read spec → implement per task → verify). The strength was letting the
  skill, not free-form instruction, structure the work.
- **The high-leverage follow-up — `ship change`.** Two words that unlocked the entire
  post-implementation pipeline (verify → archive → PR → merge → cleanup). Effective
  because the `ship-change` skill encodes the full gate, so the operator didn't have to
  spell out ten steps.

Both prompts were already strong (skill-routed). A future operator with a *planned*
OpenSpec change needs no more than these two — the leverage is in having the change
fully specced beforehand so `apply` has an unambiguous task list to execute.

## 5. Steering & corrections (what to watch for)

This session needed almost no correction — the AI self-steered. The "guardrails" below
are the moves it made on its own that a future operator should *state up front* if
working with a weaker model:

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| (risk) reimplement resolver logic | — (AI pre-empted) | State "wrap existing `shared/` primitives, don't reimplement" before coding |
| trust a full-suite red as "my change broke it" | — (AI isolated it) | Say up front: "worktree lacks root `node_modules`; isolate failures by package and re-check on `develop` before blaming the diff" |
| flip checkboxes via an atomic batch edit that silently no-ops | — (AI fell back to sed) | Instruct: "flip `tasks.md` with `sed`, per section, after each section verifies" |
| treat §8 "manual validation" as unverifiable | — (AI executed them) | Say: "the manual tasks are programmatically checkable — actually run them" |
| commit with inline backticks in the message | — (AI used `-F`) | Always `git commit -F <file>` for multi-line/backtick messages |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was created — this session *consumed* existing ones. The
reusable assets it produced are code, not process:

- **The doctor skill itself** (`packages/extension/.pi/skills/doctor/`) — a thin router
  that derives its symptom→module map and sweep DAG from each module's front-matter, plus
  a two-tier self-update (derive-on-run facts + per-module semantic-token `.knowledge.hash`
  sidecar). *Why effective:* adding a diagnostic capability = drop a new module MD; the
  router picks it up with zero router edits, and drift is caught per-module.
- **The `general-purpose` subagent** was invoked once to author `docs/doctor-skill.md` in
  caveman style. *Why effective:* it keeps the prose-writing (Rule 6 delegation) out of
  the main context and returns only the tree row for the parent to apply.

If you repeat this shape often, the *process* is already captured by the
`openspec-apply-change` + `ship-change` skills — no new skill needed.

## 7. Pitfalls & dead ends

- **Atomic batch checkbox edit silently no-ops.** The multi-checkbox `tasks.md` edit
  "didn't apply." → Fall back to `sed -i '' -E 's/^- \[ \] (N\.N) /- [x] \1 /'` per section.
- **Worktree suite shows phantom failures.** 18 red tests in `pi-image-fit-extension`
  (Jimp import) + `server/browse-endpoint` (`expected [...] to include 'node_modules'`).
  → These are worktree artifacts (no own `node_modules`; Jimp resolves differently). Prove
  it by re-running the suspect suites on the `develop` main checkout (they pass 72/72); CI
  runs a fresh install and is green.
- **Pre-existing `tsc` TS6059 rootDir errors** (kb/image-fit imports) are tolerated — the
  quality gate is *root* `tsc --noEmit`, which showed 0 doctor errors. Don't chase them.
- **`git`/`gh` post-merge checkout error** ("develop already used by worktree") is benign —
  the remote merge + branch delete succeeded; finish cleanup from the parent checkout.
- **Session cwd was the removed worktree**, so Bash couldn't init afterward. → Use a
  sandboxed shell with an explicit `cwd` to finish verification.
- **Commit messages with backticks** break inline `-m`. → Write to a temp file, `git commit -F`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a fully-specced OpenSpec change (`proposal.md` + `design.md` +
30-task `tasks.md`) in a dedicated `.worktrees/os-<name>` checkout; `gh` authenticated;
the repo's vitest workspace + Biome config unchanged.

- [ ] `/skill:openspec-apply-change <change-name>`
- [ ] Let it read the spec + enumerate existing primitives before writing.
- [ ] Build `_lib` core → module MDs → router SKILL.md → seed generated artifacts (`regenerate.ts --write`).
- [ ] Scoped tests: `HOME=$(mktemp -d) npx vitest run src/__tests__/<area>` → then full suite.
- [ ] Real gate: root `npx tsc --noEmit` + `npx biome check --error-on-warnings <changed paths>`; fix complexity warnings.
- [ ] Flip `tasks.md` with `sed`, section by section, after each verifies.
- [ ] Execute the "manual" validation tasks programmatically.
- [ ] `ship change` → isolate any worktree failures on `develop` → `openspec archive` → commit `-F` → PR → watch CI → CodeRabbit → squash-merge → remove worktree.

**Final artifacts produced:** `packages/extension/.pi/skills/doctor/` (SKILL.md, 9 `_lib`,
7 modules, 7 `.knowledge.hash`), 4 doctor test files, `docs/doctor-skill.md`,
`openspec/specs/doctor-skill/spec.md` (11 reqs, via archive), PR #295 merged to `develop`
(merge commit `9754a20`).

---

_Generated from session `019f58f0` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-13. Source extract: deterministic facts sheet from `extract_session.ts`._
