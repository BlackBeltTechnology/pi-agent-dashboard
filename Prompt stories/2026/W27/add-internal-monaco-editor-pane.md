---
session: 019f1593
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts); large facts sheet (~16016 tok)"
upgrade_status: pending
openspec_changes: [add-internal-monaco-editor-pane]
proposal_excerpt: "Today the dashboard surfaces every Edit/Write/Read tool call with an `OpenFileButton` that hands off to an external native editor (Zed, code-server via iframe). That works when the user wants the full IDE, but it forc…"
---

# How we did it: add-internal-monaco-editor-pane — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened not with "build it" but with four scoping questions about a pending
OpenSpec change:

> "Is this replacing all other type of editors? Can it cover all file types which is
> currently displayed? Is worth to display with monaco? Is able to inherit theme and
> color schema settings from pi-dashboard?"

The *real* objective, once the follow-ups landed, was: **ship a lightweight in-dashboard
Monaco read-only viewer pane** (a "what did the agent just write?" glance viewer) as an
*additive* third editing option — without removing code-server or the native-editor
handoff — and make it **inherit the dashboard's full theme system** (9 named themes ×
light/dark), then drive it all the way through `openspec-apply-change` → E2E test →
mockup → `ship-change` to a merged PR. What began as a Q&A turned into a full 42-task
feature build in a single 4h15m session.

## 2. TL;DR playbook

1. **Answer the scoping questions from the spec, not from memory.** Read
   `openspec/changes/<name>/{proposal,design,tasks}.md` first and reply with a
   decision-referenced table (additive vs replacement, viewer registry per file-kind).
2. **On "add" / "extend it with themeing", fold the new scope into the artifacts before
   coding** — promote theming from a deferred open-question to a first-class Decision in
   `design.md`, add concrete tasks in `tasks.md`, then `openspec validate --strict`.
3. **Ground the theming in the real code**: grep `useTheme()` / `themes.ts` /
   `getSyntaxTheme` to learn the token map, then derive a `buildMonacoTheme()` from the
   existing accent→syntax-role mapping so the pane matches chat code blocks.
4. **Run `/skill:openspec-apply-change <name>`** and implement phase-by-phase (shared →
   server → pane-state → viewers+theme → routing → split-button → verify), marking tasks
   done as each phase's tests pass.
5. **Fix worktree test resolution early**: an empty worktree `node_modules` resolves
   shared-package imports to the *main* repo. Run `npm install` in the worktree (creates
   `.bin/vitest`, jsdom, proper workspace symlinks) rather than hand-bridging `NODE_PATH`.
6. **For "test with browser and docker?" → Playwright is that path.** Author
   `tests/e2e/editor-pane.spec.ts` against the faux harness on `:18000`, add a
   `tool-read-fixture` faux scenario + seeded PNG/PDF fixtures so all four viewer kinds
   assert deterministically.
7. **For "make mockups" → build a self-contained `mockups/editor-pane/index.html`** that
   copies theme tokens verbatim from `themes.ts`; serve it and capture with
   `agent-browser` (not the Chromium-download-dependent screenshot tool).
8. **Trim the bundle**: drop Monaco's `ts.worker` (1.36 MB gz, LSP not needed for a
   read-only highlighter) and add a `monaco` manualChunk + a size-guard test.
9. **Run `/skill:ship-change`** — archive+sync specs, commit, PR against `develop`, watch
   CI, triage CodeRabbit, auto-apply safe fixes, resolve threads, squash-merge.

## 3. How the collaboration unfolded

**Phase A — Discovery / scoping (prompts 1–3).** The AI read the OpenSpec docs and
answered the four questions with a decision-referenced table: the pane is *additive*
(code-server + native handoff untouched), covers text/image/pdf/markdown via a viewer
registry with a fallback, and — the key steer — theme inheritance was **absent** from
both `design.md` and `tasks.md`. On "add" and "extend it with themeing", the AI folded
theming into the artifacts *before writing code*: it grepped the real theme system
(9 themes × light/dark, `useTheme()`, `getSyntaxTheme`, `RichDiff` precedent) and
promoted theming to **Decision 7** with a concrete `buildMonacoTheme()` accent→token
mapping, then `openspec validate --strict`. *Why it worked:* scope grew through the
artifacts, so implementation started from a validated plan, not a moving target.

**Phase B — Implement via openspec-apply (prompt 4).** `/skill:openspec-apply-change`
drove a phase-by-phase build (shared file-kind classifier → server `/api/file` shape →
pane-state reducer+localStorage → viewers + `monaco-theme.ts` → routing/App.tsx →
OpenFileButton split-button → verify). The AI discovered `/api/file/raw` already existed
(from `render-file-previews`), pre-satisfying a task, and kept the classifier
browser-safe (no `node:path`). *Decision point:* the biggest friction was worktree test
resolution — solved durably with `npm install` in the worktree.

**Phase C — E2E testing (prompts 5–7).** "Test with browser and docker? or playwright
test?" The AI clarified these are the *same path* (`npm run test:e2e` = Playwright vs the
docker harness on `:18000`) and authored a faux round-trip spec, adding a
`tool-read-fixture` scenario + valid seeded PNG/PDF fixtures so all four viewers assert
deterministically. It could not *execute* the spec (Chromium download network-blocked)
but proved it collects via `--list`.

**Phase D — Mockup (prompt 8).** "Make mockups how it was resolved?" produced a
self-contained interactive HTML mockup with theme tokens copied verbatim from
`themes.ts`, served locally and captured via `agent-browser` (bypassing the blocked
screenshot tool) — demonstrating live theme inheritance across Dracula/GitHub-light and
all viewer kinds.

**Phase E — Clarify + ship (prompts 9–10).** "Does editor split ChatView?" → the AI
clarified v1 is a *route-based takeover* (mirrors `FileDiffView`), with side-by-side
deferred to v2. Then `/skill:ship-change` ran the full pipeline to a merged PR #202.

## 4. Prompts that worked

- **The goal prompt (Q&A form).** Four sharp scoping questions ("replacing all editors?
  cover all file types? worth Monaco? inherit theme?") were *more* effective than "build
  the pane" — they forced the AI to ground answers in the spec and surfaced the missing
  theming scope before any code was written. **Reuse pattern:** open a feature by
  interrogating its own proposal.
- **"add" / "extend it with themeing"** — two-word high-leverage steers that turned a
  read-only Q&A into a scope expansion folded into the artifacts. Effective because the
  prior turn had already laid out the options, so a terse pick was unambiguous.
- **"Is it possible to test with browser and docker? / or playwright test?"** — surfaced
  the right tool by asking rather than assuming; the AI mapped the manual QA tasks onto an
  automatable Playwright spec.
- **"use ship-change skill" / `/skill:openspec-apply-change <name>`** — naming the skill
  explicitly routed the work to the correct procedure instead of ad-hoc steps.
- **Weak → stronger:** "add" is terse; a future operator should say *"Add theme
  inheritance to design.md + tasks.md as a first-class v1 decision, then re-validate"* to
  remove any ambiguity about where the scope lands.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat theming as a deferred open-question | "extend it with themeing" | State theme-inheritance as a v1 requirement in the proposal up front |
| Answer scoping from the design summary alone | asking "cover all file types?" / "worth Monaco?" | Always read proposal+design+tasks before answering scope questions |
| Reach for a generic screenshot/test path | "test with browser and docker? or playwright test?" | Name the repo's real harness (`npm run test:e2e`, docker `:18000`) in the ask |
| Leave the resolved UX implicit | "IS editor splits chatView?" | Document the v1 layout decision (route takeover, not split) in the proposal |
| Hand-bridge test deps with NODE_PATH/symlinks | (self-corrected mid-phase) | Run `npm install` in a fresh worktree before any vitest run |

Quality bars the user imposed implicitly by asking: coverage across *all* file types,
Monaco *worth-it* justification, *full* theme inheritance (not built-in vs/vs-dark only),
and real browser+docker verification — each question raised the bar a notch.

## 6. Skills, tools & memory created — and why they're effective

No new skill was created, but three existing skills carried the session end-to-end:
`openspec-apply-change` (phase-by-phase implementation with task-state tracking),
`ship-change` (archive → PR → CI-watch → CodeRabbit-triage → squash-merge), and a
`general-purpose` subagent for the caveman-style docs write (per the Documentation
Update Protocol).

**Recommended skill to create:** *"worktree-test-bootstrap"* — capturing the single most
expensive dead end of this session: an empty worktree `node_modules` silently resolves
workspace imports to the *main* repo, so new source files are invisible to vitest. The
skill would encode "run `npm install` in the worktree first; do not hand-bridge with
NODE_PATH or npx-cache symlinks." It removes ~15 min of thrash and is reusable for every
worktree-based OpenSpec change. Invoke it whenever the first vitest run in a
`.worktrees/*` dir fails to resolve a `@blackbelt-technology/*` import.

## 7. Pitfalls & dead ends

- **Worktree import resolution** — the biggest time-sink. Symptoms: vitest can't find
  the new shared file, or `jsdom`/`vitest` bin missing. Dead ends tried: worktree-local
  symlink into `node_modules/@blackbelt-technology`, `NODE_PATH` bridge, linking jsdom
  into the npx cache. **Fix:** `npm install` in the worktree. *If you hit missing
  workspace source in a worktree, install deps — don't bridge paths.*
- **Chromium download blocked** — Playwright and the `score_mockup`/screenshot tools both
  need `cdn.playwright.dev`, which timed out (180s). *If you can't execute an E2E spec,
  prove it with `playwright test --list` and use `agent-browser` for visual capture.*
- **`ts.worker` bloat** — Monaco pulls a 6 MB (1.36 MB gz) TypeScript language service
  you don't need for a read-only highlighter. *Disable diagnostics + drop the TS worker;
  add a `monaco` manualChunk and a size-guard test.*
- **`vite-env.d.ts` gitignored** — `packages/*/src/**/*.d.ts` is ignored by policy, so the
  `?worker` ambient types would vanish and CI `tsc` would fail. *Add a one-line
  `.gitignore` exception for the conventional filename rather than renaming it.*
- **OpenSpec MODIFIED header mismatch on archive** — a renamed requirement can't use
  MODIFIED (matches by exact header). *Model a rename+behavior-change as REMOVED + ADDED.*
- **Full-suite test flakes** — ~9–10 server tests fail under parallel forks (real HTTP
  servers racing on ephemeral ports). *Confirm they reproduce on clean `develop` before
  blaming your change; CI on clean runners is the authoritative gate.*
- **Worktree removal self-destruct** — the session's cwd *was* the worktree and held the
  untracked mockup. *Copy artifacts to `develop` before `git worktree remove --force`.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change dir (`openspec/changes/<name>/`), a running
docker harness for E2E (`docker/test-up.sh`, port `:18000`), and `agent-browser` for
visual capture (avoids the blocked Chromium screenshot path).

- [ ] Read `proposal.md` + `design.md` + `tasks.md`; answer scope with decision refs.
- [ ] Fold any missing scope (theming) into design+tasks; `openspec validate --strict`.
- [ ] Grep the real theme system (`themes.ts`, `useTheme()`, `getSyntaxTheme`) before
      writing `buildMonacoTheme()`.
- [ ] `npm install` **in the worktree** before the first vitest run.
- [ ] `/skill:openspec-apply-change <name>` — implement phase-by-phase, mark tasks green.
- [ ] Add `monaco` manualChunk, disable TS worker/diagnostics, add size-guard test.
- [ ] Author `tests/e2e/editor-pane.spec.ts` + faux scenario + seeded PNG/PDF fixtures;
      verify with `playwright test --list`.
- [ ] Build `mockups/editor-pane/index.html` with verbatim theme tokens; capture via
      `agent-browser`.
- [ ] `/skill:ship-change` — archive+sync, PR vs `develop`, watch CI, triage CodeRabbit,
      squash-merge.

**Final artifacts:** shared `file-kind.ts` classifier; server `/api/file` `{kind,
mimeType, size, content?}`; client `editor-pane-state.ts`, `monaco-theme.ts`,
`editor-pane/*` viewers + registry, split-button `OpenFileButton`; `tests/e2e/
editor-pane.spec.ts`; `mockups/editor-pane/index.html` → **merged PR #202** (squash
`34c6265`).

---

_Generated from session `019f1593` · `pi-agent-dashboard` · 2026-07-24. Source extract: `/tmp/facts-1784847526N.md`._
