---
session: 019de7a9
week: 2026/W18
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
---

# How we did it: From "what is a release cut?" to a green tree — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened as a *knowledge* question, not a task:

> "What is release-cut or cut release?"

The real objective emerged through the steering turns. The operator was standing at
the edge of cutting a release, wanted to understand what the mechanism actually does
(including whether it updates the public site), and — on discovering the working tree
was **not green** — pivoted to the concrete work: **clear every `tsc --noEmit` and
`npm test` failure blocking a clean release, and land the fixes as focused commits.**
So the arc is: *understand the release pipeline → verify the site-update chain → make
the tree releasable*.

## 2. TL;DR playbook

1. Ask the AI to explain the release mechanism by reading the skill, not from memory:
   *"What does cut-release do? Read `.pi/skills/release-cut/SKILL.md` and trace the
   workflows it triggers."*
2. Verify the side-effect you care about explicitly: *"Does it upgrade the version
   shown on the site?"* — force it to trace the `publish.yml → sync-release-version.yml
   → deploy-site.yml` chain, not hand-wave.
3. Before tagging anything, run the gates: `npm run lint` (`tsc --noEmit`) and
   `npm test`. A release cut on a red tree is a broken release.
4. Paste the **raw error block** into the chat. Let the AI fix all errors in one pass,
   grouped by file, then re-run `npm run lint` to confirm zero.
5. Commit the type fixes as one focused commit — stage **only** the files your change
   touched (`git add -A packages/`), leaving unrelated working-tree churn (workflows,
   site, openspec) unstaged.
6. Run `npm test` and paste any failing suite. Fix test-vs-source drift (assertions
   that lag behind new features) and genuine component bugs separately.
7. Re-run `npm test` + `npm run lint` → both green → commit the test fixes as a second
   focused commit. Now the tree is releasable.

## 3. How the collaboration unfolded

**Phase 1 — Explain the pipeline (Discovery).** The AI `cat`-ed
`.pi/skills/release-cut/SKILL.md` and the `.github/workflows/` files rather than
answering from memory. It laid out the four steps release-cut performs (promote
`## [Unreleased]` → dated section, bump every workspace `package.json`, commit
`chore(release): vX.Y.Z`, tag + push) and what the tag fires in CI (npm publish,
Electron artifacts across platform tuples, a draft GitHub Release). *Why it worked:*
grounding the explanation in the actual skill file makes it trustworthy and current,
not a stale recollection.

**Phase 2 — Trace the site-update chain (Verify a side-effect).** The operator asked
the sharp follow-up: *does the site get the new version?* The AI traced the real
causal chain and surfaced the crucial nuance: **release-cut itself does not touch the
site.** The site only updates after a human clicks "Publish release" on the draft,
which fires `release: published` → `sync-release-version.yml` writes
`latest-release.json` to `develop` → the `site/**` change triggers `deploy-site.yml`.
*Decision point:* knowing the site lags until the draft is manually published changes
how you sequence a release announcement.

**Phase 3 — Clear the type errors (Gather + fix).** The operator pasted a
`tsc --noEmit` dump (13 errors across client + server). The AI fixed them by file:
added an optional `reattachPlacement` to `ServerConfig` with a `?? "always"` fallback
(so existing test fixtures keep working), wired it through `cli.ts`, fixed a missing
`filePath` in a test `selection` prop, gave a mock an explicit `(...args: unknown[])`
signature, threaded a new third `toolCallId` arg through 4 call sites, and swapped a
dead `@ts-expect-error` for a runtime cast. Re-ran `npm run lint` → clean → committed
`162845e`.

**Phase 4 — Clear the test failures (fix drift + a real bug).** A second paste showed
two distinct failure classes. (a) `themes.test.ts` asserted `THEMES.length === 5` but
four themes had been added (tokyo-night, rose-pine, solarized, gruvbox) → assertion
bumped 5 → 9. (b) `SessionCard` tests threw *"Slot consumer must be rendered inside
`<PluginContextProvider>`"* because `JjInitAffordance` (rendered inline in
`SessionCard`, not through a plugin slot) called `usePluginConfig`, which throws with
a null context. The AI first reached for a `try/catch` around the hook, then
**self-corrected**: that violates rules-of-hooks (the inner `useState`/`useEffect`
only run on the success path). The clean fix was to drop the hook entirely — the
`SHOW_BY_DEFAULT_UNTIL_SETTINGS_WIRED = true` constant preserves identical end-user
behavior. `npm test` → 4132 passed, `npm run lint` → clean, committed `520a0e9`.

## 4. Prompts that worked

- **The goal prompt** — *"What is release-cut or cut release?"* A good kickoff because
  it invited the AI to teach from the source file first. Stronger still:
  *"Explain what cut-release does by reading `.pi/skills/release-cut/SKILL.md` and
  list every CI workflow the tag triggers."*
- **High-leverage follow-up** — *"Check that is it upgrading the version in site?"*
  One line, but it forced the AI to trace a multi-workflow chain and surface the
  non-obvious truth (site lags until manual publish). Rewrite:
  *"Trace whether cutting a release automatically updates the version shown on the
  public site — name each workflow in the chain."*
- **Paste-the-error prompts** — dropping the raw `tsc`/vitest output verbatim (prompts
  3 and 5) is the highest-leverage move here: the AI gets exact file:line:code and
  fixes everything in one pass. Don't summarize errors; paste them.
- **`commit changes`** — terse, but effective because the AI had already grouped the
  work; it staged only the touched files and left unrelated churn alone.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Explain the release mechanism at a high level | "Check that is it upgrading the version in site?" | Ask specifically about the side-effect you care about — force a workflow-by-workflow trace |
| Treat a release-readiness question as done after the explanation | Pasting the actual `tsc --noEmit` failures | Run `npm run lint` + `npm test` as an explicit gate *before* any tag |
| Reach for a `try/catch` around a React hook to make it defensive | (self-corrected mid-turn) — rules-of-hooks violation | State the constraint up front: "conditional hooks are illegal; drop the hook or lift the provider" |
| Risk staging unrelated working-tree churn | "commit changes" (relied on grouping) | Say "commit ONLY the files this fix touched; leave workflows/site/openspec unstaged" |

The recurring theme: the operator's short redirections repeatedly **narrowed** the AI
from a broad answer to the specific verifiable thing (site chain, exact errors, focused
commits).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work leaned on the **existing**
`release-cut` skill as a source of truth. That is itself the lesson: because the
release pipeline was already captured as a skill file, the AI could answer authoritatively
by reading it rather than guessing.

If a reusable asset *should* exist from this session, it is a **"pre-release green-tree
gate"** checklist skill: run `npm run lint` + `npm test`, fix drift-vs-real-bug
separately, commit each class as a focused commit — invoked whenever someone says
"cut a release" so the tree is verified releasable before the tag is pushed.

## 7. Pitfalls & dead ends

- **Cutting on a red tree.** `release-cut` pushes a tag that immediately fires npm
  publish + Electron builds. If `tsc`/tests are red, you ship broken. *Gate first.*
- **`try/catch` around a React hook.** It looks defensive but violates rules-of-hooks —
  the inner `useState`/`useEffect` only run on the success path. If a hook throws
  because context is missing, **drop the hook** or render the component through its
  proper provider/slot, don't wrap it.
- **Assertion drift.** `themes.test.ts` hard-coded `THEMES.length === 5` and silently
  rotted when themes were added. If a count assertion fails after a feature landed,
  the *test* is stale, not the source.
- **The site doesn't auto-update on tag.** It waits for a human to click "Publish
  release" on the draft. Don't announce a version before the draft is published, or
  the site will still show the old one.
- **Two `edit` errors occurred** during the fixes — expect the occasional failed edit
  and re-target; not every first patch lands.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a clean-ish working tree, `npm` deps installed, the raw
`npm run lint` and `npm test` output to paste.

- [ ] Ask the AI to explain `release-cut` by reading `.pi/skills/release-cut/SKILL.md`.
- [ ] Force a trace of the site-update chain (`publish.yml → sync-release-version.yml →
      deploy-site.yml`) — confirm the site only updates after manual "Publish release".
- [ ] Run `npm run lint` (`tsc --noEmit`); paste failures; fix all in one pass by file.
- [ ] Re-run `npm run lint` → clean → `git add -A packages/` → focused commit.
- [ ] Run `npm test`; paste failures; separate assertion-drift from real bugs.
- [ ] For hook-context errors: drop the hook or lift into the provider — never `try/catch`.
- [ ] Re-run `npm test` + `npm run lint` → both green → second focused commit.
- [ ] Only now cut the release.

**Artifacts produced:** two focused commits (`162845e` type fixes across 7 files,
`520a0e9` test fixes) — final state `npm test` 4132 passed, `npm run lint` clean.

---

_Generated from session `019de7a9` · `pi-agent-dashboard` · 2026-05-02. Source extract: facts sheet (mktemp)._
