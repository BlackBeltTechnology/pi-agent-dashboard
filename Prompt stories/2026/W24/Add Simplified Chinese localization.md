---
session: 019ec725
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
---

# How we did it: Add Simplified Chinese localization — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was terse: *"rebase to develop. Maybe new string keys have to be added."*
A stale localization branch (`pr-93`, Simplified Chinese) sat ~30 commits behind
`develop` and needed to land. But the real objective only emerged through steering:
not just a mechanical rebase, but a **full i18n coverage sweep** — wrapping every
hardcoded English string across the client in a translator call, generating zh-CN for
all of them, and shipping the merged result. What started as "resolve conflicts and
push" became "translate the entire client UI, then merge the PR."

## 2. TL;DR playbook

1. Rebase the feature branch onto `origin/develop`; resolve conflicts by **keeping
   develop's new functionality and re-applying the i18n wrapper on top** (not either/or).
2. When `git rebase --continue` hangs, it opened `$EDITOR` — re-run with
   `GIT_EDITOR=true git rebase --continue`.
3. Gate every rebase/edit with the repo's real build: `npm run build` (not raw `tsc`,
   which trips on project-reference config quirks).
4. Force-push the rewritten history with `--force-with-lease`, then port the original PR
   description verbatim to the new PR and cross-link the old one.
5. Scan all `.tsx/.ts` for user-facing strings not wrapped in `t(...)` before touching
   anything — produce a per-file count report to size the job.
6. Add a **module-level `t()`** to `i18n.tsx` (synced by the Provider) so helpers, event
   handlers, and toast calls — not just hook-based components — can translate.
7. Wrap strings with a **TypeScript-AST codemod**, not regex (regex matches generics like
   `Promise<DoctorReport>` as JSX text). Import the translator as `{ t as i18nT }` to dodge
   local `t` shadowing (e.g. `.map((t) => …)`).
8. Emit a key→English manifest; fan it out to parallel `translator` subagents for zh-CN;
   validate every key is present with no placeholder drift; merge centrally into one dict.
9. `npm run build` + full client test suite green after each batch; then commit, push, and
   merge the PR (`gh pr merge --rebase`).

## 3. How the collaboration unfolded

**Phase 1 — Rebase & conflict resolution.** The AI rebased `pr-93` onto `origin/develop`
and hit 5 conflicts across `SessionList.tsx` and `SettingsPanel.tsx`. The winning move
was **compositional**: keep develop's new props/refactors (`onReplaceProposal`,
`onOpenBoard`, `restart.run()`, `OpenSpecProfileSection`) *and* re-wrap the new strings in
`t()`. develop had introduced a new debug toggle, so two new keys
(`settings.capturePiOutput` / `…Hint`) were added — vindicating the user's "maybe new
string keys have to be added" hunch. A local-only `.pi/settings.json` dev-path change was
reverted so it wouldn't ride along.

**Phase 2 — Land the rebased branch.** The `git rebase --continue` **hung** because it
opened the commit-message editor; the fix was `GIT_EDITOR=true`. Verification used
`npm run build` (the repo's real toolchain) rather than a bare `tsc -p` that failed on a
project-reference quirk unrelated to the change. Force-pushed with `--force-with-lease`.
Then the original PR #93 body was copied verbatim into the new PR #123, with a
cross-linking comment on #93.

**Phase 3 — Coverage scan (the pivot).** Prompted to "scan all source for missing i18n
captions," the AI ran a heuristic scan of **543 files** and reported the headline: only
**8 components** were translated; **138 files / 689 strings** were still hardcoded. It
produced a ranked per-file count table — the decision-forcing artifact that turned a vague
ask into a scoped, sized job.

**Phase 4 — Architecture decision + codemod.** The AI *stopped before editing 138 files*
to surface one architectural fork: the hook-based `t` can't be called from helpers/toasts,
so it proposed a **module-level `t()`** synced by the Provider. After go-ahead, it chose a
**TypeScript-AST codemod over regex** — the regex dry-run had wrongly matched
`Promise<DoctorReport>` (a generic) as JSX text. The AST version wrapped 800 strings across
123 files, decoding HTML entities (`you&apos;re` → `you're`) so they render as JS strings.

**Phase 5 — Collision fix & verification.** The first pass used bare `t`, which shadowed
local `.map((t) => …)` params (found via a failing `extension-ui-decorators.test.tsx`). Fix:
import as `i18nT` uniformly. After the alias, **all 2441 web tests passed**.

**Phase 6 — Translate & merge.** The key→English manifest was split into 4 chunks and
dispatched to parallel `translator` subagents for zh-CN. All 637 keys validated present
(chunk 1's "145 vs 160" was a self-report miscount, not real loss), merged centrally into
one `zhCN` dict to avoid conflicts. Final build + tests green; committed, pushed, and merged
PR #123 via `gh pr merge --rebase` (after `gh pr ready`).

## 4. Prompts that worked

- **Goal prompt** — *"rebase to develop. Maybe new string keys have to be added."* The
  second sentence was high-value: it flagged the exact risk (develop adds UI → new keys)
  and the AI acted on it. **Stronger version:** *"Rebase pr-93 onto develop; when resolving
  conflicts keep develop's new functionality and re-wrap any new strings in `t()`; add
  zh-CN for any new keys; verify with `npm run build`."*
- **High-leverage follow-up** — *"Scan all source for missing i18n captions, messages."*
  One sentence that reframed the whole task from a rebase into a full-coverage sweep. It
  worked because the AI answered with a **sized report** (files × strings) before editing,
  making the scope decision explicit.
- *"merge PR, delete branch"* — a clean terminal instruction once green.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the task as a mechanical rebase only | "Scan all source for missing i18n captions, messages" | State the full-coverage goal in prompt 1 |
| Stall silently on a hung `git rebase --continue` | "it seems last command stuck" | Always run rebase-continue with `GIT_EDITOR=true` |
| Stop after rebase without shipping | "commit and push" / "merge PR, delete branch" | Name the terminal state (merged, branch deleted) up front |
| Leave PR provenance implicit | "Add the original description and add comment to pr-93 with the new PR" | Port the old PR body + cross-link on any rebase-into-new-PR |

Also: the user's implicit quality bar was *green build + full test suite* at every step —
the AI honored it, and it caught the `i18nT` shadowing bug.

## 6. Skills, tools & memory created — and why they're effective

No persistent skill or memory was saved this session, but two reusable assets emerged:

- **`translator` subagents (×4, parallel).** Fan a key→English manifest out in chunks for
  zh-CN, keeping the main context clean and parallelizing a 637-key translation. Invoke
  whenever a large translation manifest must be produced without polluting the driver's
  context; always **validate every key is present with no placeholder drift** afterward
  (subagents self-report counts unreliably).
- **The AST i18n codemod pattern.** A TypeScript-AST transform that wraps only real
  `JsxText`/`JsxAttribute` nodes, decodes HTML entities, and imports the translator as an
  alias to avoid shadowing. This is the reusable core worth **saving as a skill** —
  "AST-safe i18n string-wrapping codemod" — because it removes hundreds of manual edits and
  is provably safe where regex is not.

## 7. Pitfalls & dead ends

- **`git rebase --continue` hangs** → it opened `$EDITOR`. Re-run with `GIT_EDITOR=true`.
- **Bare `tsc -p` fails on a project-reference config quirk** unrelated to your change →
  verify with the repo's `npm run build` instead.
- **Regex i18n codemod is unsafe** → it matched `Promise<DoctorReport>` (a generic) as JSX
  text. Use a TypeScript AST that only touches `JsxText`/`JsxAttribute` nodes.
- **Bare `t` import collides with local `t`** (`.map((t) => …)` in `ToastSlot.tsx`) → import
  as `{ t as i18nT }` uniformly. A client test caught it.
- **`JsxText` carries raw HTML entities** (`you&apos;re`) → decode them in the fallback or
  they render literally as JS strings.
- **Noise in the test run** — `pi-image-fit` (jimp native) and `pi-dashboard-server` e2e
  failures were pre-existing/unrelated; don't chase them. Isolate the one client suite that
  matters (`extension-ui-decorators.test.tsx`).
- **`gh pr merge --delete-branch` errored** trying to switch the local checkout to
  `develop` (busy in the main worktree) — the remote merge still succeeded; delete the
  remote branch explicitly with `git push origin --delete`.

## 8. Reproduce it faster — checklist

- [ ] Rebase feature branch onto `origin/develop`; resolve conflicts **compositionally**
      (keep develop's changes + re-wrap strings in `t()`); add keys for new UI.
- [ ] `GIT_EDITOR=true git rebase --continue` if it hangs.
- [ ] Verify with `npm run build`; force-push with `--force-with-lease`.
- [ ] Port original PR body + cross-link on the rebased PR.
- [ ] Scan all `.tsx/.ts` for un-`t()`-wrapped user-facing strings → per-file count report.
- [ ] Add module-level `t()` to `i18n.tsx`, synced by the Provider.
- [ ] Wrap strings with an **AST codemod** (skip generics), import as `i18nT`, decode HTML
      entities; emit a key→English manifest.
- [ ] Fan the manifest out to parallel `translator` subagents; validate all keys present,
      no placeholder drift; merge into one dict centrally.
- [ ] `npm run build` + full client suite green; commit, push, `gh pr merge --rebase`;
      delete the remote branch explicitly if `gh` errors on the local checkout switch.

**Inputs to have ready:** a stale localization branch, write access to the repo + `gh`, the
target language, and the repo's `npm run build` / vitest toolchain.
**Artifacts produced:** merged PR #123 (rebased onto develop, 637 zh-CN keys), edits to
`i18n.tsx`, `SessionList.tsx`, `SettingsPanel.tsx`, and 120+ codemod-wrapped components.

---

_Generated from session `019ec725` · `pi-agent-dashboard/.worktrees/pr-93` · 2026-06-14. Source extract: deterministic facts sheet._
