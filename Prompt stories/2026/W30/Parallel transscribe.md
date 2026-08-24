---
session: 019f8ec4
week: 2026/W30
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [parallel-transcription-file-pool, align-session-card-kb-slot-surface]
proposal_excerpt: "pi-transcribe processes files strictly one at a time. run.ts drives a serial for loop over toProcess, awaiting processFile before starting the next. Each file's wall-clock time is dominated by SonioxClien…"
---

# How we did it: Parallelize `pi-transcribe` at the file level — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a "think, don't
implement" stance. The real objective, once the first steering turn clarified it,
was: **`pi-transcribe` processes media files strictly one at a time**, and the
user's workload is *many short files*. They wanted the tool to process files
concurrently, decide a sensible parallelism level from the actual binding
constraints, capture it as an OpenSpec proposal, then implement + verify + land it.

Plainly: *"My transcription batch is slow because it's serial. Make it parallel at
the file level, prove the concurrency ceiling from real limits, and ship it."*

## 2. TL;DR playbook

1. **Enter explore mode** on the target package and map *where the wall-clock time
   actually sits* before proposing anything (`run.ts` → `chunk.ts` → `soniox.ts`).
   The finding that unlocks everything: **`waitForCompletion` is pure idle polling** —
   the process sits waiting on Soniox, so overlapping those waits is a near-free win.
2. **Fetch the real provider limits** (`ctx_fetch_and_index` the Soniox *Limits &
   quotas* page) instead of guessing. Discovery: **100 pending transcriptions
   allowed** → the API is nowhere near the binding constraint; local RAM is.
3. **Scaffold the OpenSpec change** (`openspec change new parallel-transcription-file-pool`),
   mirroring an existing change's artifact shape. Read `config.ts` + its test first
   to match the env-var pattern exactly.
4. **Write proposal + design + tasks + spec delta**; pick **default concurrency = 8,
   clamp [1, 100]**, configurable via `TRANSCRIBE_CONCURRENCY`. Validate strict:
   `openspec validate <change> --strict`.
5. **Apply the change TDD-first**: env parsing in `config.ts`, then replace the
   serial `for` loop in `run.ts` with a bounded `runPool(size, width, work)` helper,
   then tests that *prove* peak in-flight ≤ `min(concurrency, fileCount)`.
6. **Extract `runPool` to module scope** when Biome flags `run`'s cognitive
   complexity — the pool logic reads better out of the closure anyway.
7. **Verify the automated tier**: `vitest run` (package), `tsc --noEmit`,
   `biome check`, `openspec validate --strict`. Defer the 2 live-key QA tasks.
8. **Archive → sync spec → commit only this change's files → push.** Stage
   surgically; leave the unrelated dirty tree untouched.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI read the plugin source and drew the
three-layer pipeline (file loop / chunk loop / Soniox flow), classifying each layer
by *whether the time is spent waiting vs computing*. Key insight surfaced here:
file-level and chunk-level loops are dominated by idle Soniox polling → parallelizable;
the Soniox upload→create→poll→get flow is a hard data dependency → not. This
"where does the time go" framing is what made the whole change safe to reason about.

**Phase 2 — Grounding the ceiling.** The human steered: *"1. parallelize at file
level; 2. I don't know the limits, check it; 3. yes."* The AI fetched Soniox's real
limits page (after a redirect on the first URL), landing the definitive figure:
**100 pending transcriptions**. That flipped the analysis — the binding constraint
is *local RAM*, not the API — which justified a bolder default than a timid 3–4.

**Phase 3 — Proposal.** On *"increase parallel processing number and draw
proposal"*, the AI scaffolded a spec-driven OpenSpec change: proposal / design /
tasks / spec-delta. It read an existing change and `config.ts`'s test to mirror
conventions, chose **default 8 / clamp [1,100]**, and passed `--strict` validation
clean before presenting.

**Phase 4 — Implementation (TDD).** On the `openspec-apply-change` skill turn, the
AI worked the tasks in order: env parsing → pool → tests → docs. When Biome's
cognitive-complexity gate tripped on the nested worker, it **extracted `runPool` to
module scope** — a clean fix that both satisfied the gate and improved readability.
68/68 tests passed.

**Phase 5 — Validation reality-check.** The human said *"build and deploy and run
browser to validate."* The AI **pushed back before doing the wrong thing**: this
package is a CLI + pi skill with **no build step, nothing to deploy, no browser
surface** — the dashboard rebuild-matrix doesn't apply. The correct validation was
the already-green automated tier (tests / tsc / biome / strict validate).

**Phase 6 — Land it.** On *"I will test later, archive, sync, commit and push,"* the
AI marked the 2 live-key QA tasks deferred, archived (syncing the main spec), and
**staged only this change's 12 files** — explicitly excluding a dirty tree of
unrelated changes — then committed and pushed to `develop`.

## 4. Prompts that worked

- **The goal prompt** (explore-mode kickoff): effective because it set a *thinking*
  stance first, forcing the AI to map the problem before touching code. A stronger
  explicit version: *"Explore `packages/video-transcription`: it transcribes files
  serially and my batch is many short files. Find where the wall-clock time goes and
  propose a file-level parallelism level grounded in Soniox's real limits."*
- **"1. file level; 2. I don't know, check it; 3. yes"** — a high-leverage
  three-part answer. "Check it" delegated the limits research; "yes" greenlit the
  direction without micromanaging. This is the pattern: *answer the AI's open
  questions tersely and let it run.*
- **"increase parallel processing number and draw proposal"** — one line that both
  set a design preference (be more aggressive) and requested the artifact.
- **"build and deploy and run browser to validate"** — a *weak* prompt for this
  change (wrong ritual for a CLI package). It still worked because the AI corrected
  it. Stronger: *"validate however is right for this package."*
- **"I will test later, archive, sync, commit and push"** — crisp closing sequence;
  the "test later" clause pre-authorized deferring the live-key QA tasks.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Ask *where* to parallelize (file vs chunk) | "parallelize at file level" | State the granularity in the goal prompt (workload = short files → file-level) |
| Want to guess a safe-but-timid concurrency | "check it" (the real limits) | Tell it to fetch provider limits before choosing a number |
| Propose a conservative default | "increase parallel processing number" | State the risk posture up front (aggressive vs conservative) |
| Follow the literal "build/deploy/browser" ritual | Package has no such surface | AI self-corrected — reward this; let it map the request to the package's real shape |
| Stage the whole dirty tree | (implicit) "commit **this** change" | AI staged only the 12 change files; make "surgical staging" the standing rule |

The reusable quality bar the human imposed: **decisions must be grounded in real
numbers** (Soniox's 100-pending limit), not vibes.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created, but the session leaned on several to good effect:

- **`openspec-explore`** — enforced a think-first stance so the pipeline analysis
  (where the time goes) happened *before* any code. Invoke it whenever the "right
  design" is unclear and you'd otherwise start editing prematurely.
- **`ctx_fetch_and_index`** — fetched + indexed the Soniox limits docs so the
  concurrency ceiling came from the vendor, not a guess. Invoke it any time a design
  number depends on an external provider's real quotas.
- **`openspec-apply-change`** — drove the TDD task order and kept the change spec-driven.

**Skill worth creating:** a *"parallelize a serial provider-bound loop"* playbook —
(1) map where wall-clock sits, (2) fetch the provider's real concurrency limit,
(3) pick a bounded pool default clamped to that limit, (4) prove peak in-flight with
a real-timer test, (5) extract the pool helper to dodge complexity gates. This
session is a clean template for it.

## 7. Pitfalls & dead ends

- **Soniox rate-limits URL redirected** to a generic page on first fetch. Fix: the
  real docs use `/docs/stt/...` paths — fetch the specific *Limits & quotas* page.
- **Biome cognitive-complexity gate tripped** on the nested worker inside `run`.
  Fix: extract a module-scope `runPool(size, width, work)` helper — satisfies the
  gate *and* reads better. Don't try to inline-suppress it.
- **"Build/deploy/browser" doesn't apply** to `packages/video-transcription`: no
  build (`.ts` bin via jiti/tsx), nothing to deploy (in-place workspace package), no
  browser surface (CLI + skill). If a validation ritual doesn't map to the package,
  say so instead of running it hollow.
- **Dirty working tree.** Unrelated uncommitted changes were present
  (`docs/AGENTS.md`, `groups.json`, a Dockerfile, untracked dirs, `package-lock.json`).
  Stage *only* the change's paths; don't `git add -A`.
- **2 tasks can't be automated** (5.2/5.3 need a live `SONIOX_API_KEY` + media).
  Mark them deferred-to-live-test rather than blocking the archive.

## 8. Reproduce it faster — checklist

**Inputs to have ready**
- Target package: `packages/video-transcription` (CLI `pi-transcribe` + pi skill).
- Provider docs URL for real limits (Soniox *Limits & quotas*).
- (For live QA only, deferred) `SONIOX_API_KEY` + sample media files.

**Steps**
- [ ] Explore-mode map of `run.ts` → `chunk.ts` → `soniox.ts`; identify idle-wait layers.
- [ ] `ctx_fetch_and_index` the provider limits page; record the pending ceiling (100).
- [ ] `openspec change new parallel-transcription-file-pool`; mirror an existing change.
- [ ] Read `config.ts` + its test; add `TRANSCRIBE_CONCURRENCY` (int ≥1, default 8, clamp ≤100).
- [ ] Write proposal / design / tasks / spec-delta; `openspec validate --strict`.
- [ ] Replace serial `for` in `run.ts` with `runPool(size, width, work)`.
- [ ] Add tests proving peak in-flight ≤ `min(concurrency, fileCount)` and N=1 ≡ N=4 outcomes.
- [ ] Extract `runPool` to module scope if Biome flags complexity.
- [ ] `vitest run` + `tsc --noEmit` + `biome check` + `openspec validate --strict` → all green.
- [ ] Mark live-key QA tasks deferred; `openspec archive` (syncs spec).
- [ ] Stage ONLY this change's files; commit; push.

**Final artifacts produced**
- `openspec/changes/archive/2026-07-23-parallel-transcription-file-pool/` (proposal, design, tasks, spec-delta)
- `packages/video-transcription/src/config.ts` — `TRANSCRIBE_CONCURRENCY` → `Config.concurrency`
- `packages/video-transcription/src/run.ts` — serial loop → `runPool` bounded file-level pool
- `packages/video-transcription/src/__tests__/{config,run}.test.ts` — +6 / +4 cases (68/68 pass)
- `packages/video-transcription/.pi/skills/video-transcription/SKILL.md`, `README.md`, `src/AGENTS.md` — env docs
- Commit `a9b08d7ad` on `develop` (12 files)

---

_Generated from session `019f8ec4-5381-72fc-8f25-3d2b8c89ab34` · `pi-agent-dashboard` · 2026-07-23. Source extract: `/tmp/facts-91012-1128.md`._
