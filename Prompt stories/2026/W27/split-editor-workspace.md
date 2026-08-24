---
session: 019f24a4
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); large facts sheet (~17659 tok)"
upgrade_status: pending
openspec_changes: [split-editor-workspace]
proposal_excerpt: "Today the internal Monaco editor pane (`add-internal-monaco-editor-pane`, archived 2026-06-30) and `ChatView` are **mutually exclusive** — the content router renders either `/session/:id` (chat) **or** `/session/:id/e…"
---

# How we did it: Split editor + chat workspace — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a tiny question — **"Is there mockup presented for this proposal?"** — but the real objective, revealed by the second prompt (`/skill:openspec-apply-change split-editor-workspace`), was to **implement a large 30-task OpenSpec change end-to-end**: make the Monaco editor pane and `ChatView` render *side-by-side* (a resizable split workspace) instead of mutually-exclusive routes, plus everything that split implies — a toggle, auto-split-on-file-open, gitignore-aware `@`-mention search, a server `/api/grep` content-search endpoint, a dual-mode editor search panel, and a changed-on-disk banner. The user then drove two more phases with two-word prompts: **"review"** and **"use ship-change skill"**. Net objective: land the whole feature, reviewed and merged to `develop`, from inside a git worktree.

## 2. TL;DR playbook

1. **Confirm the mockup exists first** — `find openspec/changes/<change>/mockups -type f`; the mockup (`mockups/index.html`) is the DOM/spec source of truth for divider size, orientation, and states. Read it *before* writing layout components.
2. **Kick off apply with the skill**: `/skill:openspec-apply-change <change>`. In a worktree, resolve the skill from the **main repo root**, not the checkout.
3. **State a phase plan up front** (this change: 8 phases — split scaffold → toggle/auto-split → `@`-mention completeness → server grep → editor search panel → changed-on-disk banner → responsive/persistence QA → docs+gates). Announce progress at phase boundaries; pause only at genuine architectural forks.
4. **Build bottom-up with TDD**, one task at a time: write the test, run it scoped (`npx vitest run <file>`), then implement. Use an ephemeral `HOME` + `--localstorage-file` for isolation.
5. **For the invasive App.tsx integration**, read the router topology first (there were *two* router sites), then use a **context provider** (`SplitWorkspaceProvider`) + a thin connected wrapper (`SessionSplitView`) so state lifts once above both sites without prop-threading.
6. **Fix the worktree shared-package resolution early** (see §7) — symlink *all* `@blackbelt-technology/*` workspace packages into the worktree `node_modules` before making any typed `packages/shared` changes.
7. **Run the gates**: `openspec validate`, Biome on changed files (auto-fix imports, accept Tier-B/C `warn`s), root `tsc --noEmit`, full test regression per package.
8. **Delegate all `docs/` writes to a subagent** with the caveman-style rule verbatim; pre-draft the row content for accuracy.
9. **Review** ("review"): run CodeRabbit advisory + an independent review subagent in parallel; fix the valid finding *classes* (input validation, ReDoS, effect churn) yourself.
10. **Ship** ("use ship-change skill"): flip deferred QA task, build+test gate, archive+sync specs, commit (exclude unrelated edits + gitignored `dist`/symlinks), PR → `develop`, watch CI, squash-merge, remove worktree.

## 3. How the collaboration unfolded

**Phase A — Discovery (mockup check).** The AI answered the literal question (`mockups/index.html` exists, is part of the proposal) and offered to serve it. *Why it worked:* it treated the mockup as the layout contract and re-read it before building `SplitDivider`/`SplitWorkspace` to match the 6px bar and `col-resize`/`row-resize` cursors exactly.

**Phase B — Grounding + phase plan.** On `openspec-apply-change`, the AI read all context files, the spec deltas, and the key existing structures (App.tsx's 2146-line ternary router, EditorPane, `FilePreviewContext` as a provider idiom) *before* writing code. It then published an 8-phase plan. *Decision point:* the human let it run autonomously with phase-boundary check-ins rather than task-by-task approval.

**Phase C — TDD build, phase by phase.** Each task followed test→run→implement. The **App.tsx integration** (Task 1.4) was flagged as the highest-risk fork: the AI confirmed there were two router sites, chose a `SplitWorkspaceProvider` context to lift state once, and added a connected `SessionSplitView` wrapper because App's body renders *above* the provider. All 287 client test files stayed green after the restructure.

**Phase D — Cross-package work (bridge, server, protocol).** Gitignore-aware `searchFiles`, a new `/api/grep` route mirroring `/api/file`'s security gates, and a `file_changed` watch push. This surfaced the **worktree shared-resolution blocker** (§7), which the AI diagnosed empirically (probed tsc *and* runtime resolution) before fixing with symlinks.

**Phase E — Gates + docs.** `openspec validate`, Biome (0 Tier-A errors), tsc, full regression. Docs writes were **delegated to a subagent** per the Documentation Update Protocol.

**Phase F — Review.** On "review", the AI ran CodeRabbit (which hung/rate-limited on the 50-file diff) and compensated with an **independent review subagent**, fixing the same finding classes it would have raised.

**Phase G — Ship.** On "use ship-change skill", it ran the full pipeline and hit a real judgment call: CI failed — but on a **pre-existing, develop-wide Biome `--reporter=github` "Invalid color" infra bug**, not this change. It proved develop's own HEAD run failed identically, confirmed no branch protection, checked with the user at the merge guardrail, then squash-merged.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change split-editor-workspace`. A single skill invocation that carries the entire change spec; the best kickoff for a well-scoped OpenSpec change. *Stronger version for a cold start:* prepend one line of intent — "Apply split-editor-workspace end-to-end, TDD, pause only at architectural forks."
- **"review"** — one word, high leverage: triggered the full review gate (CodeRabbit + self-review) without micromanagement.
- **"use ship-change skill"** — delegated the entire land-it pipeline (archive, PR, CI watch, merge, cleanup) to a known skill.
- **"Is there mockup presented for this proposal?"** — a good *warm-up* probe that anchored later layout work to the real DOM contract. Effective because it made the mockup an explicit input rather than an afterthought.

The pattern that worked: **short prompts that hand off to a skill**, trusting the AI to plan phases and only surface at genuine forks.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer only the literal mockup question | (implicitly) expect the mockup used as the layout contract | Read `mockups/index.html` before writing any layout component |
| Risk merging with red CI | The AI self-invoked the guardrail and *asked* before the irreversible merge | Keep the "never merge on failing CI" rule; require proof the failure is pre-existing/develop-wide before overriding |
| Commit everything staged | Exclude the unrelated `manage-flows` edit + gitignored `dist`/symlinks | Check `git status` before staging; commit only files your change touched |
| Leave a `railParentLeft` module-global hack | Self-corrected to a proper container ref | Prefer refs over module-level mutable state in resize math |
| Emit stray `oldText2`/`newText2` keys in edits (3× repeated) | Redo the edit cleanly | One edit call = one clean `{oldText,newText}`; never invent numbered keys |

Note: this session was largely **self-steered** — the human gave only 4 prompts across 4h. The corrections above were mostly the AI catching itself. The one true human gate was the CI-red merge decision.

## 6. Skills, tools & memory created — and why they're effective

Two **project tool-quirk memories** were saved (no skills):

1. **Worktree shared-package resolution.** Captures that git worktrees under `.worktrees/` have no local `node_modules/@blackbelt-technology`, so `@blackbelt-technology/pi-dashboard-shared` (and siblings) resolve *up* to the main repo — meaning edits to the worktree's `packages/shared` are invisible to both tsc and runtime until you symlink the workspace packages into the worktree `node_modules`. *Effective because* it turns a 90-minute empirical debugging detour into a one-line fix next time.
2. **Pre-existing worktree test failures.** Records that `npm test` in a worktree shows failures unrelated to your change — `image-fit-extension` Jimp import errors (TS2595) and the `spa-fallback` 500 (missing real `dist/client` build). *Effective because* it lets a future session distinguish inherited noise from real regressions instantly.

**Recommended skill to create:** a `worktree-shared-resolution` skill wrapping the symlink fix (mirror all relative `@blackbelt-technology/*` links from main into the worktree `node_modules`) — it recurs on every cross-package change built in a worktree. (This may already exist as `fix-pi-ai-compat`-style notes; check before duplicating.)

## 7. Pitfalls & dead ends

- **Dual-package hazard in worktrees (the big one).** Editing the worktree's `packages/shared/protocol.ts` / `browser-protocol.ts` had no effect: both tsc and runtime resolved `@bb/shared` to the *main* repo's copy (hoisted node_modules), and a stale `packages/shared/dist/*.d.ts` in main made tsc read old declarations. **Fix:** symlink the worktree's `packages/shared` — and then *all* `@blackbelt-technology/*` workspace packages (they use relative `../../packages/<name>` targets) — into the worktree `node_modules`, killing the two-incompatible-`BrowserToServerMessage`-types hazard. Also clear `.tsbuildinfo` and rebuild worktree shared declarations if tsc still reads stale `.d.ts`.
- **Reverted a shared-module extraction.** An attempt to DRY the gitignore matcher into `packages/shared` was impractical mid-worktree (a *new* shared file isn't visible) — the AI inlined it in both places instead. Type-only changes to *existing* shared files work via plain JSON at runtime; brand-new shared *modules* do not, until symlinked.
- **CodeRabbit on a 50-file diff hangs / rate-limits.** First run timed out at 400s; the detail re-run hit a 32-min rate limit. Treat the gate as advisory/warn-and-continue and run an **independent review subagent** in parallel to cover the same finding classes.
- **CI red for a reason that isn't your code.** The `biome lint . --reporter=github` step emitted `##[error]Invalid color` (a GitHub annotation-parser failure) — local Biome was 100% clean (2057 files, exit 0), and *develop's own HEAD run failed the identical step*. Prove it's pre-existing/develop-wide before overriding the "no merge on red CI" guardrail.
- **`spa-fallback` test 500s without a real build.** Passes in isolation after `npm run build`; the worktree just lacks `dist/client`. Not a regression.
- **Scoped-test isolation.** Plain `npx vitest run` can touch real `~/.pi` state — always wrap with `HOME=$(mktemp -d)` + `NODE_OPTIONS="--localstorage-file=$(mktemp)"`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change dir (`openspec/changes/<change>/`) with `proposal.md`, `design.md`, `tasks.md`, and `mockups/index.html`.
- A git worktree for the change (`.worktrees/os-<change>/`).
- CodeRabbit CLI installed + authenticated (optional; advisory).

**Checklist:**
1. [ ] `find openspec/changes/<change>/mockups -type f` — read the mockup as the layout contract.
2. [ ] `/skill:openspec-apply-change <change>` (resolve skill from main repo root in a worktree).
3. [ ] **Symlink all `@blackbelt-technology/*` packages into the worktree `node_modules`** before any typed shared change; clear `.tsbuildinfo`.
4. [ ] State an N-phase plan; build bottom-up TDD, scoped `npx vitest run` with ephemeral `HOME`.
5. [ ] For invasive router edits: map all router sites first, lift state via a context provider + connected wrapper.
6. [ ] Gates: `openspec validate` · Biome (auto-fix imports, accept Tier-B/C warns) · root `tsc --noEmit` · full per-package regression.
7. [ ] Delegate `docs/` writes to a subagent with the caveman rule verbatim.
8. [ ] Review: CodeRabbit advisory + independent review subagent; fix input-validation / ReDoS / effect-churn classes.
9. [ ] Ship: exclude unrelated edits + `dist`/symlinks from the commit; PR → `develop`; prove any CI-red is pre-existing before merge; squash-merge; remove worktree.

**Artifacts produced:** ~29/30 tasks across `packages/client` (split-state, `useSplitRatio`, `SplitDivider`, `SplitWorkspace`, `SplitWorkspaceContext`, `SessionSplitView`, `SplitToggleButton`, `EditorSearchPanel`, `ChangedOnDiskBanner`, `rail-width`, `grep-api`), `packages/extension` (gitignore-aware `searchFiles`), `packages/server` (`ripgrep-detection`, `lib/grep`, `grep-routes`, `file-watch-manager`), `packages/shared` (protocol additions); 172 change tests; PR **#216**, squash-merged as `7edb764c`; archived to `archive/2026-07-03-split-editor-workspace/`.

---

_Generated from session `019f24a4-4d13-76f4-9e96-49e1c6fd1b39` · `pi-agent-dashboard` · 2026-07-03. Source extract: `/tmp/facts-1784846309N.md`._
