---
session: 019ef4df
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~15085 tok)"
upgrade_status: pending
openspec_changes: [add-markdown-knowledge-base]
proposal_excerpt: "Agents working in this repo (and any markdown-heavy project) repeatedly need to look up facts that are already written down — architecture decisions, API patterns, prior fixes, conventions — but have no fast, local, s…"
---

# How we did it: implementing & shipping the markdown knowledge-base change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change add-markdown-knowledge-base
```

The real objective, once it played out: **take a partly-built OpenSpec change from
1/70 tasks "done" to a merged PR.** That meant reconciling a stale task list against
code that already existed, implementing the remaining ~47 tasks in reviewable
increments, then (after `Use ship skill`) running the whole ship pipeline —
verify → archive → PR → CI → CodeRabbit → squash-merge → worktree cleanup — through
**five CI rounds**, most of them fighting *inherited breakage from a red `develop`*
rather than the operator's own code. The change added two publishable packages
(`packages/kb`, `packages/kb-extension`): a local markdown FTS knowledge base with a
retrieval pipeline, pluggable sources + TOFU trust, a directory-level AGENTS "DOX"
system, and a Phase-2 pi extension.

## 2. TL;DR playbook

1. **Invoke the apply skill** with the change name: `/skill:openspec-apply-change <name>`.
2. **Reconcile before coding.** Don't trust the checkbox count. Audit the existing
   code against `tasks.md`, run the baseline test suite, and re-count real progress
   (here: 1/70 → 23/70 just from reconciliation).
3. **Batch the remaining tasks into named increments** (A–E) and *check in with a
   plan* before the first major change (AGENTS.md rule). Ship each increment:
   implement → unit tests → typecheck against the **root** tsconfig → verify against
   the real corpus → mark tasks.
4. **After the last increment, say `Use ship skill`** and let the ship pipeline run:
   verify gate (`npm test` + lint + build) → `openspec archive` → commit → PR against
   `develop` → watch CI.
5. **Expect CI to be redder than your diff.** When CI fails on files you never
   touched, check whether **`develop` itself is red** (`gh run list --branch develop`)
   before "fixing" anything — the PR is tested *merged into develop's tip*.
6. **Triage CodeRabbit by severity.** Apply the critical (command-injection) + safe
   localized fixes; defer archived-prototype / heavy-lift / doc-nit threads with a
   one-line reason.
7. **Merge only on green CI.** If Actions stalls (no run for a push), *wait* — don't
   force-merge past absent CI. Re-merge `develop` when the PR goes CONFLICTING.
8. **Squash-merge, then clean up the worktree from the parent checkout** — the merge
   deletes your cwd out from under the shell, so re-anchor before the final commands.

## 3. How the collaboration unfolded

**Phase 1 — Reconcile (Discovery).** The AI loaded the apply skill, read the
proposal/design/spec, and audited the existing `packages/kb/` vertical slice. It
found the `tasks.md` status note *overstated* reality (claimed `init.ts` and split
SKILLs existed — they didn't) yet the core slice genuinely satisfied ~22 tasks. It
established a 13/13 passing baseline and noted the 691-file `doc-example/` corpus was
gitignored/absent from the worktree, so verification would point at the main repo by
absolute path. *Why it worked:* trusting the code over the checkboxes, and pinning a
green baseline before touching anything.

**Phase 2 — Plan the increments (Design).** Rather than grind 47 tasks linearly, the
AI split them into five mostly-independent increments (A: on-by-default retrieval +
`kb init`; B: pluggable sources + TOFU trust; C: DOX/directory AGENTS; D: Phase-2 pi
extension; E: verification + release wiring) and **checked in with the plan** per the
"before major changes" rule. The `go on` reply was the green light.

**Phase 3 — Implement & verify each increment (Generate → Verify, ×5).** Each
increment followed the same loop: write code → add unit tests → run vitest →
typecheck → **verify precision against the real corpus** (P@1 ≈ 0.80, Recall@10 ≈
0.95, MRR ≈ 0.85) → mark tasks. Real bugs surfaced in verification, not review:
a `**/*.md` glob that excluded top-level files, a `pos` plain-object prototype
collision on a `"toString"` token (fixed with a null-prototype object), a
file-path-vs-dir walk in the DOX manifest.

**Phase 4 — Ship (`Use ship skill`).** Verify gate passed after opting a legitimate
`execSync` in `sources.ts` out of the `no-direct-child-process` lint (git clone / tar
extract in a deliberately self-contained package). `openspec archive` synced a
21-requirement spec and archived the change.

**Phase 5 — The CI gauntlet (5 rounds).** This was the bulk of the session. Round 1:
`noImplicitAny` on `registerTool` execute params — CI runs the *full* lib-check while
local `--skipLibCheck` masked it. Rounds 2, 4, 5: **inherited `develop` breakage** —
a `DashboardEvent` cast, a missing publish-allowlist entry for `mockup-loop` — each
confirmed pre-existing by checking develop's own red CI and the `origin/develop...HEAD`
diff (zero changes to those files). Round 3: CodeRabbit's critical command-injection
fix + 5 hardening fixes. Along the way GitHub Actions *stalled* (no run created for two
pushes); the AI paused rather than force-merge, then re-merged develop when the PR went
CONFLICTING. Final commit green (8m12s), CodeRabbit pass, squash-merged as `081895eb`.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-markdown-knowledge-base`.
  Effective because it names the change and hands control to the skill; the operator
  didn't micromanage. *Make it stronger* by adding the expectation up front:
  *"reconcile the task checkboxes against existing code before implementing."*
- **`go on`** — a high-leverage unlock. After the AI presented the 5-increment plan,
  a two-word approval let it run the whole implementation loop unattended. Works
  *because the plan was explicit first* — approve a plan, not a void.
- **`Use ship skill`** — the single prompt that switched modes from "implement" to
  "land it," triggering the entire verify→PR→CI→merge pipeline. Effective as a clean
  handoff to a known skill rather than re-describing the steps.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause after each increment for direction | `go on` | State "implement all increments, check in only on scope changes" in the kickoff |
| Not self-transition from implement to ship | `Use ship skill` | Add "when tasks hit N/N, run the ship skill" to the apply flow |
| Edit the **main repo's** `release-cut/SKILL.md` by absolute path (not the worktree copy) | (self-caught) reverted main, re-applied in worktree | Always edit the worktree copy so changes ship in the PR — never absolute-path into the parent checkout |
| Treat CI failures as *its own* breakage | (self-caught) checked `develop` CI + `origin/develop...HEAD` diff | On any red CI touching files you didn't change, check develop's own CI status first |

The heaviest implicit steering was the **surgical-changes rule**: when CI failed on
inherited develop breakage, the AI resisted silently patching another team's code
until it had *proven* the breakage was pre-existing and minimal (compiler-suggested
`as unknown as` cast, one missing allowlist row).

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were saved this session — it was pure *application* of
existing ones (`openspec-apply-change`, `ship-change`). One subagent was spawned:

- **`general` subagent — "Add file-index rows for kb packages."** The AGENTS.md
  doctrine requires all `docs/` writes to go through a subagent in *caveman style*.
  Delegating the 27 file-index rows kept that prose out of the main context and
  enforced the house style. *Invoke it* whenever a change adds files that need
  `docs/file-index-*.md` rows.

**Skill worth creating:** a `diagnose-ci-vs-develop-breakage` playbook — *"PR CI red
on files not in your diff → run `gh run list --branch develop`, diff
`origin/develop...HEAD`, and only fix inherited breakage with the compiler-suggested
minimal change."* This exact dance recurred three times in one session.

## 7. Pitfalls & dead ends

- **`--skipLibCheck` hides CI failures.** Local typecheck passed; CI (root tsconfig,
  no skip) caught `noImplicitAny` on tool `execute` params. Reproduce CI locally with
  the *root* tsconfig, not per-package flags.
- **The gitignored `doc-example/` corpus is absent from worktrees.** Point verification
  at the main repo's copy by absolute path; expect one skipped test in the worktree.
- **`ExtensionContext` isn't exported from the pi package root.** Annotate structurally
  (`{ cwd: string }`) when you only need one field, instead of importing the type.
- **A `pos` plain object collides with `Object.prototype` keys** (a `"toString"` token
  breaks `.push`). Use `Object.create(null)`.
- **`**/*.md` excludes top-level files** if `**/` is translated as a required dir.
  Make `**/` optional in glob→regex.
- **`execSync` blocks the event loop**, so an in-process test HTTP server can't accept
  — a harness bug, not a code bug; the async unit test still validated the resolver.
- **GitHub Actions can silently drop a push** (no run created) while CodeRabbit still
  fires. Don't force-merge past absent CI; wait, and re-merge develop if the PR turns
  CONFLICTING.
- **Squash-merge deletes your worktree cwd.** `--delete-branch` fails on the local-git
  step when develop is checked out in the parent. Re-anchor the shell to an existing
  dir, delete the remote branch, then `git worktree remove` from the parent checkout.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; write access to the repo;
`gh` authed; the real test corpus path (main-repo `doc-example/` if verifying kb).

- [ ] `/skill:openspec-apply-change <name>`
- [ ] Audit code vs `tasks.md`; re-count real progress; pin a green baseline
- [ ] Group remaining tasks into named increments; present the plan; get "go on"
- [ ] Per increment: implement → unit tests → typecheck (root tsconfig) → verify on
      real corpus → mark tasks
- [ ] `Use ship skill` → verify gate (`npm test` + lint + build) → `openspec archive`
- [ ] Open PR against `develop`; watch CI
- [ ] On red CI touching files you didn't change → check `gh run list --branch develop`
      + `origin/develop...HEAD` before fixing
- [ ] Triage CodeRabbit by severity: fix critical + safe/local; defer the rest with reasons
- [ ] Merge only on green CI; wait out Actions stalls; re-merge develop on CONFLICTING
- [ ] Squash-merge → delete remote branch → `git worktree remove` from the parent checkout

**Final artifacts:** PR #155 squash-merged to `develop` as `081895eb`;
`packages/kb/` + `packages/kb-extension/` (70/70 tasks); spec
`markdown-knowledge-base` (21 requirements) archived under
`openspec/changes/archive/2026-06-23-add-markdown-knowledge-base/`.

---

_Generated from session `019ef4df` · `pi-agent-dashboard` · 2026-06-23. Source extract: `/tmp/session_facts.72a6ZH.md`._
