---
session: 019de313
week: 2026/W18
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [strip-token-backgrounds-in-code-blocks]
proposal_excerpt: "Syntax-highlighted code blocks paint per-token background pills (`.token.deleted`, `.token.inserted`, `.token.selector`, etc.) baked into the prebuilt prism styles shipped by `react-syntax-highlighter`. Those pills we…"
---

# How we did it: Search, resume & land an OpenSpec code-block theme fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a vague memory of past work:

> *"In some recent session in this directory was a proposal or discussion about code block font background and theme fix."*

The **real objective**, once the two steering turns landed, was: *find the OpenSpec
proposal that was drafted in an earlier session, then actually implement and ship it.*
The concrete work: strip the per-token background "pills" that
`react-syntax-highlighter`'s prism styles bake into `.token.*` selectors, so code
blocks and diffs use the theme's own panel background (`var(--bg-code)`) instead of a
noisy mismatched wash — then build and deploy.

## 2. TL;DR playbook

1. **Find the prior work by content, not memory.** Grep the session JSONLs for the
   topic (`grep -li "code block.*\(font\|background\|theme\)" *.jsonl`), then confirm
   an OpenSpec change exists: `ls openspec/changes/ | grep -iE "code|theme|background"`.
2. **Resume the OpenSpec change** instead of re-deriving it:
   `openspec instructions apply --change strip-token-backgrounds-in-code-blocks --json`
   and read its `proposal.md` / `tasks.md`.
3. **Write the test first** — `syntax-theme.test.ts` asserting no `.token*` selector
   keeps a `background`/`backgroundColor` across every theme (dark+light × base,
   dracula, nord, github, catppuccin), while wrappers keep theirs.
4. **Implement the pure helper** `stripTokenBackgrounds(style)` in `syntax-theme.ts`
   and wire it into `getSyntaxTheme()` on both the resolved-theme and fallback paths.
5. **Migrate the consumer** — route `DiffPanel`'s File view through
   `getSyntaxTheme(theme, themeName)` (memoized) instead of importing `oneDark` raw.
6. **Verify in a clean HOME** — `HOME=$(mktemp -d) npx vitest run …` to dodge stale
   local config, then `npx tsc --noEmit -p packages/client`.
7. **Update AGENTS.md rows** (new `syntax-theme.ts`, amended `DiffPanel.tsx`), mark
   the automated tasks done, leave the manual visual-smoke tasks unchecked.
8. **Build & deploy:** `npm run build` then restart. When the `curl /api/restart`
   dance flaked, fall back to the canonical `pi-dashboard restart`.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (find the ghost session).** The AI didn't have the proposal in
context, so it searched the raw session JSONLs on disk with `grep`/`python3` and
cross-checked against `openspec/changes/`. It surfaced
`strip-token-backgrounds-in-code-blocks` and summarized the problem and proposed fix
back to the user. *Why it worked:* treating past sessions as a searchable corpus beat
asking the user to remember which session it was.

**Phase 2 — Resume, not restart.** On *"can you resume it?"* the AI ran the OpenSpec
apply instructions, read the context files, and reported `Progress: 0/5`. The change
already carried `proposal.md`, `design.md`, `tasks.md` and `specs/` — so the AI
executed the plan rather than re-authoring it.

**Phase 3 — TDD implementation.** Test first (`syntax-theme.test.ts`, 13 cases), then
the pure `stripTokenBackgrounds` helper, then the `DiffPanel` migration. Build passed;
the AI marked automated tasks complete and explicitly *skipped* the manual visual-smoke
task rather than falsely checking it.

**Phase 4 — Docs & ship.** Updated two AGENTS.md rows, then on *"build and deploy"*
ran `npm run build` and attempted the restart. The decision point here was the human's
terse deploy command — the AI owned the deploy mechanics and recovered from a flaky
restart endpoint on its own.

## 4. Prompts that worked

- **Goal prompt (weak → stronger):** *"In some recent session … was a proposal about
  code block font background and theme fix."* This worked only because the AI knew to
  search session history. A stronger kickoff: *"Find the OpenSpec change about code
  block token backgrounds in this repo and summarize its status."*
- **High-leverage follow-up:** *"can you resume it?"* — three words that turned a
  read-only search into a full implement-and-verify run, because an OpenSpec change
  with a `tasks.md` is directly resumable.
- **Deploy trigger:** *"build and deploy"* — terse but sufficient once the repo's
  build+restart workflow is known. In this repo, prefer stating it as *"build the
  client and restart the dashboard."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the vague ask as read-only investigation | "can you resume it?" | State the outcome up front: "find it **and implement it**" |
| Stop after summarizing the proposal | Explicit resume request | Point straight at the OpenSpec change and say "apply it" |
| Leave deploy implicit | "build and deploy" | Include build+restart in the original ask |

The user imposed a quiet quality bar by asking to *deploy* — i.e. the change wasn't
"done" at green tests; it had to be built into the client bundle and the dashboard
restarted.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session, but two workflows are clearly repeatable
and worth capturing:

- **"Find prior work in session JSONLs"** — grep the on-disk session transcripts by
  topic, then reconcile against `openspec/changes/`. *Effective because* it recovers
  work the current context has no memory of. Worth a small skill:
  `find-prior-session-work`.
- **The `stripTokenBackgrounds` pattern** is already documented via the new AGENTS.md
  row, which is the right home — no separate skill needed.

## 7. Pitfalls & dead ends

- **Stale local vitest environment.** The first `npx vitest run` needed rescuing with
  `HOME=$(mktemp -d) npx vitest run …` to isolate from local config. If tests behave
  oddly, run them under a throwaway HOME.
- **Flaky `/api/restart` curl dance.** Three `curl … /api/restart` variants failed
  (chained `sleep`/`jq` shell quoting and endpoint timing). The reliable path was the
  canonical `pi-dashboard restart`. Don't hand-roll the restart curl — use the CLI.
- **Don't false-check manual tasks.** Task 4 (visual smoke) stayed unchecked. Marking
  automated-only completion honestly keeps `tasks.md` truthful.

## 8. Reproduce it faster — checklist

- [ ] `grep -li` the session JSONLs for the topic; confirm the OpenSpec change exists.
- [ ] `openspec instructions apply --change <name> --json`; read `proposal.md` + `tasks.md`.
- [ ] Write the assertion test first (all themes × light/dark).
- [ ] Add the pure helper + wire it into both code paths.
- [ ] Migrate the raw-import consumer to the themed getter (memoized).
- [ ] `HOME=$(mktemp -d) npx vitest run …` then `npx tsc --noEmit -p packages/client`.
- [ ] Update AGENTS.md rows; check only automated tasks.
- [ ] `npm run build` then `pi-dashboard restart`.

**Inputs to have ready:** the repo checked out, an existing OpenSpec change (or the
session history containing it), a running dashboard on `localhost:8000`.

**Artifacts produced:**
`packages/client/src/lib/syntax-theme.ts` (helper),
`packages/client/src/lib/__tests__/syntax-theme.test.ts` (new, 13 tests),
`packages/client/src/components/DiffPanel.tsx` (migrated),
`openspec/changes/strip-token-backgrounds-in-code-blocks/tasks.md` + `AGENTS.md` (updated).

---

_Generated from session `019de313-7a05-759e-9dc5-a6fe97df9bc2` · `pi-agent-dashboard` · 2026-05-01. Source extract: session facts sheet._
