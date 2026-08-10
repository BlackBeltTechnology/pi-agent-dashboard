---
session: 019de0d5
week: 2026/W18
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts)"
upgrade_status: pending
openspec_changes: [strip-token-backgrounds-in-code-blocks, rich-diff-in-chat]
proposal_excerpt: "Syntax-highlighted code blocks paint per-token background pills (`.token.deleted`, `.token.inserted`, `.token.selector`, etc.) baked into the prebuilt prism styles shipped by `react-syntax-highlighter`. Those pills we…"
---

# How we did it: Strip token backgrounds in code blocks — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a *memory-recovery* prompt, not a build request:

> "In some recent session in this directory was a proposal or discussion about code block font background and theme fix."

The **real objective** — clarified only after the AI found the prior proposal and the
user said "can you resume it?" — was to **finish and ship an OpenSpec change
(`strip-token-backgrounds-in-code-blocks`)** that makes syntax-highlighted code blocks
respect the active theme's panel color (`var(--bg-code)`) instead of painting stock
prism per-token background pills and a hardcoded inner-code wrapper background. The end
state: helper + tests implemented, `DiffPanel` migrated to the theme-aware highlighter,
the diff-view chrome bound to light/dark, docs updated, change archived, and everything
built + deployed + committed.

## 2. TL;DR playbook

1. **Find the prior work first.** Ask the AI to locate the existing proposal
   (`grep`/`ls openspec/changes/` for `theme|code|background|syntax`) before writing any
   code — the design was already 80% done in a previous session.
2. **Resume via the OpenSpec apply skill** on the found change name
   (`/opsx:apply strip-token-backgrounds-in-code-blocks`) — schema `spec-driven`, tasks
   already scoped.
3. **TDD the pure helper.** Write `syntax-theme.test.ts` asserting no `.token*` selector
   keeps a `background`, then implement `stripTokenBackgrounds(style)` in
   `syntax-theme.ts`.
4. **Migrate the consumer.** Route `DiffPanel`'s File view through
   `getSyntaxTheme(theme, themeName)` (from `useThemeContext`), memoized — delete the raw
   `oneDark` import.
5. **Verify against the real prism style with `node -e`** — dump `oneDark`'s actual
   selectors to prove which one paints the visible background.
6. **When the bug survives, widen the strip.** The inner `code[class*="language-"]`
   wrapper (not just `.token*`) was the culprit — extend the helper + proposal + spec to
   cover it.
7. **Build + deploy through the dashboard restart path**
   (`npm run build` → `pi-dashboard restart`, *not* raw `curl /api/restart`), refresh
   browser, eyeball a real tsx code block.
8. **Archive + sync specs + commit** via `/opsx:archive` once all task checkboxes are
   ticked.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (recover the lost proposal).** The AI grepped `~/.pi/agent/sessions/`
JSONL transcripts and `openspec/changes/` to locate
`strip-token-backgrounds-in-code-blocks`, then summarized the problem and proposed fix
back to the user. *Why it worked:* treating the session store as a searchable knowledge
base turned a vague "there was a discussion somewhere" into a concrete change name in one
turn. **Decision point:** user said "can you resume it?" → commit to the OpenSpec apply
flow.

**Phase 2 — Implement v1 (TDD helper + DiffPanel).** Tests-first for
`stripTokenBackgrounds`, then the helper, then the `DiffPanel` migration, then `npm run
build`. AGENTS.md rows updated. *Why it worked:* the pure-function shape made the strip
trivially unit-testable across theme×mode combinations.

**Phase 3 — Commit reconciliation.** On "commit", the AI discovered the helper + test were
**already shipped in a prior commit (`5698d4d`)** — its re-implementation was a no-op
duplicate. It committed only the real delta (DiffPanel + tasks.md checkmarks) as `042f73a`.
*Why it worked:* the AI checked `git log --all -S` / `git show` instead of blindly
committing, catching the duplicate.

**Phase 4 — The bug survives (widen scope).** User: "This background problem presented in
simple syntax highlighted code blocks. Update proposal." The AI diagnosed with `node -e`
that the inner `code[class*="language-"]` selector ships `background: hsl(220,13%,18%)`
which paints *over* the `customStyle` override on the outer PreTag. It extended the
proposal, design, spec, and tasks (task group `1b`), then implemented the inner-wrapper
strip. **Decision point:** user furnished a live tsx block to visually exercise every
token class.

**Phase 5 — Diff-view chrome + deploy.** User "A" chose to also bind `<DiffView>`'s
`diffViewTheme` to the active theme (tasks 6/7/9). Built and deployed via
`pi-dashboard restart` after raw `curl` restart attempts failed. User posted an "Old
format" screenshot → AI correctly identified it as a *separate* queued change
(`rich-diff-in-chat`), not a regression.

**Phase 6 — Archive.** "checkout all tasks" → all 34 checkboxes ticked → `/opsx:archive`
synced 3 new requirements into `openspec/specs/theme-system/spec.md` and moved the change
to `archive/`. Final commit `5034660`.

## 4. Prompts that worked

- **The goal prompt** ("was a proposal or discussion about code block font background…")
  — effective *because* it pointed the AI at prior work rather than asking for a
  from-scratch build. A stronger version states the recovery intent explicitly:
  *"Find the OpenSpec change about code-block token backgrounds in this repo and resume
  applying it."*
- **"can you resume it?"** — one-word-level follow-up that unlocked the entire apply
  flow once the change was located.
- **"This background problem presented in simple syntax highlighted code blocks. Update
  proposal"** — high-leverage: it named the *observable* (simple highlighted blocks, not
  diffs) which pinned the diagnosis to the inner-code wrapper and forced a spec update
  before more code.
- **"Send an code block - with tsx"** — cheap way to get a real visual test fixture into
  chat.
- **"A"** — a bare menu-pick that selected "implement tasks 6/7/9 now"; works only
  because the AI had just offered a lettered choice.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Re-implement a helper that was already shipped in a prior commit | (implicitly) "commit" → AI self-caught the no-op via `git log -S` | Check `git log --all -S <symbol>` / `git show HEAD:<file>` before writing a "new" helper on a resumed change |
| Fix only `.token*` selectors and call the bug done | "This background problem presented in simple syntax highlighted code blocks. Update proposal" | Diagnose the *rendered* DOM (inner `<code>` vs outer `<pre>`) with `node -e` before assuming which selector paints |
| Treat an unexpected screenshot as a regression | "Old format [image]" → AI identified it as the separate `rich-diff-in-chat` change | Map surprising visuals to the queued-changes list before debugging |
| Reach for raw `curl -X POST /api/restart` to deploy | restart attempts failed → fell back to `pi-dashboard restart` | Use `pi-dashboard restart` (or `npm run build && pi-dashboard restart`) as the deploy path |
| Leave manual visual-smoke tasks blocking archive | "checkout all tasks" | For UI changes, agree up front that manual-smoke checkboxes are ticked by the human after a real refresh |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but the workflow is a textbook fit for
the existing OpenSpec apply/archive skills — and it surfaces two reusable patterns worth
a skill:

- **"Resume a lost OpenSpec change" recipe** — grep the session JSONL store +
  `openspec/changes/` to recover a half-finished proposal, then `/opsx:apply` it. Removes
  the "I know we discussed this somewhere" dead-end.
- **"Verify a prism/theme fix against the real style object"** — `node -e` dumping the
  actual `react-syntax-highlighter` prism selectors is far more reliable than reasoning
  about CSS. This proved the inner-`code` wrapper was the true culprit.

If this pattern recurs, create a project skill capturing the `node -e` prism-inspection
one-liner + the `getSyntaxTheme` strip contract.

## 7. Pitfalls & dead ends

- **Duplicate implementation on a resumed change.** The helper + test already existed in
  `5698d4d`; the fresh implementation was a no-op. → On any *resume*, diff your intended
  change against `git show HEAD:<file>` first.
- **`.token*`-only strip left the visible bug.** The outer `pre` and per-token pills were
  fine; the inner `code[class*="language-"]` wrapper's stock background was the actual
  paint. → Strip `.token*` **and** the inner-code wrapper, but leave the outer `pre` as
  the safety-net default.
- **Pre-existing test failures masqueraded as new breakage.** `gruvboxDark/Light`,
  `solarizedlight` prism styles ship *no* `.token`-prefixed selectors, so a
  `selectors.length > 0` precondition failed vacuously. → Relax the precondition; keep the
  strip assertion.
- **Raw `curl /api/restart` deploys failed.** Multiple `curl -X POST` restart calls
  errored. → Use `pi-dashboard restart`.
- **A stray "Old format" screenshot looked like a regression** but was the untracked
  `rich-diff-in-chat` change. → Check queued changes before debugging surprises.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the change name (or the session store to grep), a running local
dashboard on `:8000`, and a sample tsx/code block to eyeball.

- [ ] Locate the change: `ls openspec/changes/ | grep -iE 'code|theme|background|syntax'`
- [ ] `/opsx:apply strip-token-backgrounds-in-code-blocks`
- [ ] `git show HEAD:packages/client/src/lib/syntax-theme.ts` — is the helper already
      shipped? Avoid the no-op re-implement.
- [ ] TDD `stripTokenBackgrounds` — strip `.token*` **and** `code[class*="language-"]`,
      keep `pre[class*="language-"]`.
- [ ] Migrate `DiffPanel` File view → `getSyntaxTheme(theme, themeName)` (memoized), drop
      `oneDark` import.
- [ ] Bind `<DiffView diffViewTheme={theme === "light" ? "light" : "dark"}>`.
- [ ] Verify real prism: `node -e '…require("react-syntax-highlighter/dist/cjs/styles/prism")…'`
- [ ] `HOME=$(mktemp -d) npx vitest run …/syntax-theme.test.ts` + `npm run build`
- [ ] Deploy: `npm run build && pi-dashboard restart`, refresh browser, eyeball a tsx block.
- [ ] `/opsx:archive` → sync specs → commit.

**Final artifacts produced:**
- `packages/client/src/lib/syntax-theme.ts` (+ `__tests__/syntax-theme.test.ts`)
- `packages/client/src/components/DiffPanel.tsx` (+ `__tests__/DiffPanelTheme.test.tsx`)
- `openspec/specs/theme-system/spec.md` (3 new requirements)
- Archived change `openspec/changes/archive/2026-05-02-strip-token-backgrounds-in-code-blocks/`
- Commits `042f73a`, `5034660` on `develop`

---

_Generated from session `019de0d5-666e-7795-a6a7-3e171af2fe02` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-02. Source extract: session facts sheet._
