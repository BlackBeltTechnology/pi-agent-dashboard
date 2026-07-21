# How we did it: Improve KB usage — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal:
> *make agents actually use the knowledge-base tools instead of reflex-grepping source.*

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, not an
implementation task. The real objective surfaced within minutes of investigation: agents
in this repo *reflex-grep source* (`grep -rn "SymbolName" packages/`) instead of calling
the `kb_*` tools that the `AGENTS.md` "Docs-First Gate" tells them to use. The goal became:
**diagnose why the kb gate is ignored, then fix the doctrine so the reflex changes** — and,
as a spun-off second thread, **fix a runtime gap where `kb_neighbors`/`kb_get` return empty
on a cold (active-but-uninitialized) index.** Two focused OpenSpec changes came out of one
exploration.

## 2. TL;DR playbook

1. **Open in explore mode first** (`openspec-explore`). State the suspicion ("agents ignore
   the kb gate") but let the AI gather *evidence* before proposing anything.
2. **Demand measured evidence, not vibes.** The AI parsed the last 20 sessions' JSONL logs
   programmatically and counted `grep/rg` (234) vs `kb_search` (24) calls, then broke down
   *what* the greps targeted (137 source symbol-lookups). That number *is* the argument.
3. **Reframe, don't add.** The key insight: the prose "STOP" gate was ignored while the
   Discipline-Skills **table** was obeyed → convert the gate into a mechanical
   `reflex → exact kb command` substitution table. Less text, more compliance.
4. **Run the coherence check before scaffolding** (`pre-scaffold-openspec-coherence-check`):
   confirm the new change complements — not duplicates — in-flight kb changes.
5. **Scaffold → validate → commit per artifact.** `openspec new change`,
   `openspec validate --strict`, then a `commit` steer after each phase (propose / implement
   / test / archive).
6. **Push back when a test approach is wrong.** When asked to test with Playwright+docker,
   the AI investigated the seeding path, found a *deterministic composer*, and wrote a fast
   unit test instead — explaining why.
7. **Let a probing question become its own change.** "Is lazy indexing added when kb active
   but not initialized?" → trace the code → find the gap → propose the cold-start guard
   (Option B) → implement TDD → archive.
8. **Keep commits surgical.** Stage only your change's files; leave unrelated ambient drift
   (`groups.json`, `package-lock.json`) and other sessions' WIP untouched.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (evidence-first).** The AI rejected the noisy `session_search` tool
and went straight to the raw session JSONL on disk, iterating on the schema (`toolCall`
part type) until it could count tool calls programmatically. Output: a hard table —
234 grep/rg vs 24 kb_search, 6/20 sessions grepped source *before* any kb_search, 137
bypassing greps were symbol-lookups. *Why it worked:* the diagnosis was unarguable because
it was measured, not asserted.

**Phase 2 — Root-cause reframe.** Reading the `project-init` coding template, the AI found
it ships "Read the file first" to new projects — actively steering *away* from kb. The
framing insight ("the table is obeyed, the prose gate isn't") turned the fix from "write
more guidance" into "convert the gate to a substitution table." Decision point: the human
implicitly endorsed by saying `commit`.

**Phase 3 — Change #1: `steer-agents-to-kb-tools`.** Coherence-checked against three active
kb changes, scaffolded, validated `--strict`, implemented (3 doctrine files: root gate,
seeded `dox-doctrine.md`, coding template), committed per phase, archived, main spec synced.

**Phase 4 — A steer that got corrected.** The human said the manual tasks "can be tested
with playwright and docker test." The AI *investigated first* and pushed back: project-init
seeding runs through a **deterministic composer** (`seed-doctrine.ts` `buildDoctrineBlock`),
so a unit test asserting the composer's real output is faster, deterministic, and hits the
right target — versus a slow, flaky, wrong-layer E2E. The human said `do it`; 9/9 tests pass.

**Phase 5 — Change #2 from a question.** "Is lazy indexing added when kb active but not
initialized?" The AI traced `kb_search → reindexNow → getKb` and found: `kb_search`
self-populates on cold start, but `kb_neighbors`/`kb_get` don't. It presented three options
in a table and recommended **Option B (cold-start guard)** — `if counts().chunks === 0 →
reindexNow`, zero warm-path cost. Human: `yes`. Implemented TDD (`ensurePopulated` helper,
3 new tests), archived, spec synced.

## 4. Prompts that worked

- **The goal prompt** (`openspec-explore`): starting in explore mode was the right kickoff —
  it forced *investigation before implementation* and produced measured evidence rather than
  a guessed fix. Stronger next-time framing: *"Explore why agents ignore the kb gate. Pull
  real tool-usage counts from recent sessions before proposing anything."*
- **High-leverage follow-ups** — each was tiny but unlocked a full phase:
  - `commit` (×6) — a rhythm marker: finish a phase, commit, move on. Kept the git history
    clean and phase-aligned.
  - `do it` / `yes` — approve-and-proceed unlocks after the AI laid out a recommendation.
    They worked *because* the AI had already presented the tradeoffs; the human only had to
    ratify.
  - `Is currently lazy indexing added when knowledge base active and not yet initialized?` —
    the single highest-leverage prompt: a precise runtime question that spawned an entire
    second change. Model to reuse: **ask a specific "does X actually happen in code?"
    question** and let the AI trace it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for `session_search` (noisy) first | (self-corrected) went to raw JSONL | State up front: "measure from raw session logs, not session_search" |
| Stop after exploring | `commit` then `openspec-apply-change` | Say "explore → propose → implement" as the intended arc when you already know you want to land it |
| Accept a test layer at face value | proposed Playwright+docker; AI investigated and returned a **unit test** | Ask "what's the *cheapest correct* test layer?" and let the AI find the deterministic seam before writing tests |
| Bundle unrelated dirty files into a commit | AI proactively excluded `groups.json` / `package-lock.json` / another session's WIP | Keep it — the AI's surgical-commit discipline was a feature; confirm ambient drift ownership before touching |
| Over-document a ~10-line fix | AI skipped `design.md` (decision lives in `proposal.md`) | For tiny fixes, say "proposal-only, skip design.md" to save a round-trip |

The load-bearing correction is Phase 4: **the user's suggested test approach was wrong, and
the AI was right to investigate before complying.** The guardrail is to *invite* that
pushback — frame test requests as "find the right layer," not "write a Playwright test."

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — but the workflow leaned heavily on
**existing** skills, and the artifacts it produced are themselves reusable doctrine:

- **`kb-read-discipline` spec + substitution table** (the deliverable of change #1) is the
  reusable asset: it mechanically maps each investigation reflex to the exact `kb_*` command
  (`grep symbol → kb_search --doc-type agents`, chase imports → `kb_neighbors`, read a
  section → `kb_get`). *Why effective:* it replaces an ignored prose gate with a table agents
  already obey, and it seeds into *new* projects via `dox-doctrine.md`, so the fix compounds.
- **`ensurePopulated` cold-start guard** (change #2) makes `kb_neighbors`/`kb_get` self-init
  on first use at zero warm-path cost — closing a silent "empty results on a fresh index" trap.
- **Recommended skill to create:** a *"measure-tool-usage-from-session-logs"* helper. The AI
  hand-rolled JSONL parsing three times to get the grep-vs-kb counts. A small script
  (`analyze tool calls across last N sessions → counts + target breakdown`) would make this
  diagnosis a one-liner next time — the exact evidence that made the proposal unarguable.

## 7. Pitfalls & dead ends

- **`session_search` is noisy** for behavioral analysis → parse raw session JSONL on disk
  (`~/.pi/agent/sessions/--<cwd>--/*.jsonl`); the part type is `toolCall`.
- **Test isolation needs an ephemeral HOME** → prefix vitest with `HOME=$(mktemp -d)` or the
  kb/project-init tests touch your real `~/.pi`.
- **`biome --changed` found 0 files** — it diffs against *committed* state, so uncommitted
  edits are missed. Run `biome check <files>` directly, then `biome check --write` to autofix
  (that's what the repo's `quality:changed` oracle does under the hood).
- **Distinguish your findings from pre-existing ones** — 3 `noUnusedImports` errors were
  already on HEAD; removing them was safe hygiene, but leaving `extension.ts`'s pre-existing
  warns untouched respected the surgical-changes rule. Check `git show HEAD:<file>` before
  claiming a lint finding is yours.
- **`git index.lock` held by the live dashboard's `git status` poll** → it's transient, not
  stale. Wait/retry in a short loop; do **not** delete the lock.
- **`git add` aborts if any one pathspec matches nothing** (e.g. an already-`git mv`'d dir) →
  stage the surviving paths only, then verify the file actually landed in the commit
  (`git show --stat`).
- **Playwright+docker for a content-composition change is the wrong layer** — slow, flaky,
  and it tests model skill-adherence rather than your file change. Find the deterministic
  composer and unit-test its output.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** repo checked out on `develop`; the `openspec` CLI; vitest + biome;
awareness of any *other* in-flight OpenSpec changes (for the coherence check).

- [ ] Open `openspec-explore`; state the behavioral suspicion.
- [ ] Measure it: parse recent session JSONL, count `grep/rg` vs `kb_search`, break down grep
      targets. Make the number the argument.
- [ ] Reframe the fix as *changing the reflex* (substitution table), not adding prose.
- [ ] Run `pre-scaffold-openspec-coherence-check` against active/archived kb changes.
- [ ] `openspec new change` → write proposal/design/tasks → `validate --strict` → `commit`.
- [ ] `openspec-apply-change` → edit doctrine files → mark tasks → `commit`.
- [ ] For any test task, find the *deterministic seam* first; prefer a fast unit test over E2E.
      Run with `HOME=$(mktemp -d) npx vitest run <file>`.
- [ ] `openspec-archive-change` → sync delta into `openspec/specs/` → `validate` → `commit`.
- [ ] Keep commits surgical — exclude ambient drift and other sessions' WIP.

**Artifacts produced (both changes archived on `develop`):**
- `openspec/specs/kb-read-discipline/spec.md` (new capability, 4 requirements, 8 scenarios)
- `AGENTS.md` — Docs-First Gate rewritten as a substitution table
- `packages/extension/.pi/skills/project-init/dox-doctrine.md` + coding `AGENTS.md.tmpl`
  (seeded kb + degraded-manual READ discipline)
- `packages/kb-extension/src/reindex.ts` `ensurePopulated` + `kb_neighbors`/`kb_get` wiring,
  with 3 new tests in `reindex.test.ts`
- `openspec/specs/markdown-knowledge-base/spec.md` — cold-start self-population rule

---

_Generated from session `019f683c-e5ec-7225-be86-d85dd2d36f00` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/session_facts.md`._
