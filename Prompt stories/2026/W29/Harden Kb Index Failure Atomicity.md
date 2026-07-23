---
session: 019f5b28
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [harden-kb-index-failure-atomicity]
proposal_excerpt: "`kb index` is not idempotent under failure, and the worktree-init gate trusts the artifact it leaves behind. This bricks a checkout's knowledge base silently."
---

# How we did it: Harden `kb index` failure atomicity — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

Make `kb index` failure-atomic: an OOM-kill, SIGKILL, or Ctrl-C mid-index must not
leave behind a 56 KB `chunks=0` SQLite husk that the worktree-init gate trusts as
"indexed". The existing `kb index` opened the DB store **before** scanning source
files — any uncatchable termination between the open and the first insert produced a
valid-format but empty database. The change had to survive the exact termination
signals listed in the threat model (SIGKILL/OOM), preserve incremental indexing
speed (no full reindex on every run), and keep the existing `test -f index.db` gate
coherent. Running in an OpenSpec worktree against the `kb` package (TypeScript,
`better-sqlite3` via Node `DatabaseSync`, zero runtime deps).

**First prompt:** `doubt review` — a single two-word phrase that kicked off the
entire session.

## 2. TL;DR playbook

1. **Run `doubt-driven-review` on the proposal before any code.** Ground every
   factual claim against source. The review exposed the false "OR" in the plan and
   the incremental-indexing tension — fixing those in the spec before coding saved a
   re-architecture cycle.
2. **Spawn a fresh-context adversarial reviewer** via a subagent on a different model
   family (reasoning model, same-architecture fallback when cross-architecture
   unavailable). Convergence on the same critical findings raises confidence they're
   real.
3. **Write the reconciled decisions into `design.md`** with a Mermaid state diagram
   capturing the first-index-vs-incremental branch, the rejected approaches, and
   why. Use it as the single source of truth for all downstream artifacts.
4. **Align all four artifacts (proposal, tasks, both spec deltas)** with the
   reconciled design before writing any code. `openspec validate --strict` must pass
   on the full change.
5. **Commit the spec artifact alignment** as one atomic local commit.
6. **TDD: write the test first** — reproduce the husk (red), then implement.
   Extract a testable `runIndexAtomic` function from the untestable `cli.ts::runCmd`
   inline path. Route `index` through it exclusively.
7. **Verify kb suite passes (68→70 tests)** after the extract. Check typecheck +
   Biome. Isolate pre-existing failures to confirm no regression.
8. **Ship via ship-change**: archive + sync specs, push, open PR, watch CI + 
   CodeRabbit. Apply CodeRabbit findings (all 3 were valid), re-push, re-watch CI.
   Squash-merge, delete branch + worktree.

## 3. How the collaboration unfolded

**Phase 1 — Adversarial proposal review (13:07–13:16, ~9 min).**
One word triggered the doubt-driven-review skill. The AI read every source file the
proposal referenced (`cli.ts`, `sqlite-store.ts`, `indexer.ts`, `.pi/settings.json`),
grounded every factual claim, and produced a structured CLAIM→FINDINGS→RECONCILE
report. Two critical findings: (1) the proposed "OR" between temp-DB+rename and
close+unlink was **false** — OOM/SIGKILL never reaches cleanup code, so only
temp+rename survives the stated threat model; (2) a fresh temp DB has no `files`
mtime/sha256 state, so every run becomes a full reindex, contradicting the incremental
requirement. The AI pushed back on the spec before any code was written.

**Phase 2 — Cross-model validation attempt (13:11–13:16).**
The AI tried three model families (GPT-5.2, Gemini-3-Pro, GPT-5.1) via subagents for
a cross-architecture review. All returned empty — the internal `model` override didn't
route to a different architecture in this harness. When told "use internal models, not
external CLIs", the AI pivoted to deepseek-v4-pro (which answered but self-identified
as Claude — same architecture). The fresh-context review independently reproduced both
Critical findings, plus two the AI had underweighted. **Key tactic:** convergence on
the same findings across two independent reads (same-architecture, but no shared
reasoning) raised confidence without a true cross-model reviewer.

**Phase 3 — Design reconciliation and artifact alignment (13:22–13:36, ~14 min).**
The AI wrote three new sections (`design.md`, aligned `proposal.md`, rewrote `tasks.md`
§2-4, both spec deltas) in one commit. The Mermaid state diagram in `design.md`
captured D1 (temp+rename on first index, in-place on incremental), D2 (keep
file-existence gate, don't probe emptiness), and D3 (config-source missing =
warn+skip, explicit `--source` missing = error). All five artifacts passed
`openspec validate --strict`.

**Phase 4 — TDD implementation (13:42–13:58, ~16 min code + test).**
The AI extracted `index-run.ts` (testable `runIndexAtomic`), redirected `index` in
`cli.ts` to bypass `openStore` (which pre-created the husk), added
`finalizeRename`/`closeAndUnlink` to `sqlite-store.ts`, and degraded missing config
directories in `indexer.ts` to warn+skip. Eight test scenarios covered the husk
reproduction (red-first), atomicity, orphan sweep, and config degradation. All
passed.

**Phase 5 — Ship loop (13:59–14:51, ~52 min).**
Ship-change ran the full pipeline: archive specs, push, PR against `develop`,
watch CI green (10m16s, clean-env), watch CodeRabbit (3 valid findings), apply
fixes (peer-aware orphan sweep, return counts from atomic path, all-missing guard
before store open), re-push, re-watch CI (10m36s, green), squash-merge PR #299,
delete branch and worktree. One notable pitfall: the CI fix commit triggered a
repo-convention lint (`no-direct-process-kill`) resolved with kb's established
per-line opt-out marker.

## 4. Prompts that worked

| Prompt | Why it was effective |
|--------|----------------------|
| `doubt review` | Two words triggered the full adversarial review pipeline — read every source file, grounded every claim, produced structured findings. No preamble needed because the context was already loaded (OpenSpec worktree with proposal open). |
| *The spec-aligning loop* (reads of `cli.ts`, `sqlite-store.ts`, `indexer.ts`) | Not a prompt — the AI autonomously read every referenced source file to ground its review. This is the right default behavior; if the AI skips it, ask "read each source file the proposal cites and verify its claims." |
| `/skill:openspec-apply-change harden-kb-index-failure-atomicity` | Invoked the spec-driven implementation skill after the specs were aligned. This is the standard trigger for starting work. |
| `ship-change` | One word triggered the full ship pipeline. Works because the OpenSpec + ship-change skills are wired. |

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Try external CLI tools (`gemini`, `codex`) for cross-model review | "Do not use other CLI tool. There is internal provided models" | State the constraint up front: "use only the Agent tool with internal model overrides, never bash CLIs" |
| Produce findings only (no write action) after the review | "write" | Add "then write the decision into the change artifacts" to the review prompt |
| Pause after writing for a next-step decision | "commit" / "ship-change" | Include a sequencing note: "after design reconciliation, commit locally; after implementation, ship via ship-change" |

## 6. Skills, tools & memory created — and why they're effective

This session created **no new skills or memories** — it was an implementation run
within an existing OpenSpec workflow that leveraged already-wired skills:

- **`doubt-driven-review`** — the single most impactful skill used. It owns the
  adversarial review of a plan before code exists. In this session it caught the
  false "OR" that would have re-bricked checkouts under the exact failure modes the
  proposal cited. Always invoke it when a proposal presents multiple approaches as
  interchangeable that are not, or when the threat model and implementation plan
  have a gap.
- **`openspec-apply-change`** — the spec-driven implementation pipeline. Standard
  for writing code in this project.
- **`ship-change`** — the end-to-end ship pipeline (archive, PR, CI watch, merge,
  cleanup). Used as the final step.
- **`review-code`** (via CodeRabbit PR gate) — caught three valid issues in the
  implementation (redundant store open, peer-aware orphan sweep, guard ordering).
  All localized and fixable.

**Recommendation:** If you repeat this workflow (doubt-review → design → implement →
ship in one session), consider writing a `spec-to-ship` meta-skill that sequences the
four skills.

## 7. Pitfalls & dead ends

- **External CLI tools (`gemini`, `codex`) failed** — `gemini` had a broken dyld
  library; `codex` returned authorization error. The internal subagent `model`
  override returned empty for three different model families in this harness. The
  workaround: use a fresh-context reviewer on the **same** architecture (deepseek-v4-pro
  routed as Claude but produced independent findings). Cross-model validation was
  genuinely unavailable.
- **Repo-convention lint: `no-direct-process-kill`** — the fix commit used
  `process.kill(pid, 0)` to check if a peer is alive, which the shared lint test
  forbids. The resolution was kb's established `// ban:process-kill-ok` per-line
  opt-out (kb is self-contained with zero deps on `pi-dashboard-shared`). Even the
  JSDoc comment containing the literal `process.kill(` in backticks triggered it.
- **Pre-existing test failures masked as regressions.** The local `npm test` had 22
  failures (jimp native-image, doctor-route timing). The AI had to isolate them
  by confirming none originated from `packages/kb`. CI proved they were
  environmental. Always run the targeted test suite first, then check whether
  unrelated failures pre-exist (run on base commit).
- **Worktree collision after merge:** The local `.worktrees/` branch couldn't be
  cleaned up automatically because `develop` was checked out in the parent repo.
  Harmless — the remote merge + branch delete succeeded.

## 8. Reproduce it faster — checklist

- [ ] **Open the OpenSpec worktree** (`openspec change new ...` or existing)
- [ ] **Run doubt-driven-review** on the proposal — one prompt, `doubt review`
- [ ] **Verify cross-model validation** is achievable; if not, note the gap
- [ ] **Write `design.md`** with the reconciled decisions + Mermaid diagram
- [ ] **Align all artifacts** (proposal, tasks, spec deltas); `openspec validate --strict` passes
- [ ] **Commit spec alignment** locally
- [ ] **TDD: write test first** (red), then implement the smallest fix
- [ ] **Verify targeted suite + typecheck + Biome** — isolate pre-existing failures
- [ ] **Mark tasks complete** in `tasks.md`
- [ ] **Run `ship-change`** — archive, push, PR, CI watch, CodeRabbit triage
- [ ] **Squash-merge, delete branch + worktree**

### Key inputs
- Existing OpenSpec change with proposal + tasks + spec files
- Access to source files the proposal cites (for grounding)
- Internal subagent reachable for fresh-context review
- GitHub auth (`gh`)

### Artifacts produced
- `packages/kb/src/index-run.ts` (new) — `runIndexAtomic` with temp+rename
- `packages/kb/src/cli.ts` — `index` routed through atomic path
- `packages/kb/src/indexer.ts` — missing config dir degrades (warn+skip)
- `packages/kb/src/sqlite-store.ts` — `finalizeRename`, `closeAndUnlink`
- `packages/kb/src/__tests__/index-atomicity.test.ts` (new) — 8 scenarios
- PR #299 merged into `develop` (squash commit `81375f38`)
- OpenSpec change archived: `openspec/changes/archive/2026-07-13-harden-kb-index-failure-atomicity/`

---

_Generated from session `019f5b28` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/guideline_6SOWhz`._
