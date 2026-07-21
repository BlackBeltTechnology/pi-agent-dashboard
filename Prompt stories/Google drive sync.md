# How we did it: Designing a bidirectional cloud-sync connector — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal:
> take a vague "let the LLM edit files in a local folder and sync them back to Drive"
> idea and turn it into a data-loss-safe, pressure-tested, committed OpenSpec change —
> **without writing a line of implementation code.**

---

## 1. Goal (the ask)

The session opened in **explore mode** (a thinking-only stance — read/search allowed,
implementation forbidden). The operator's real ask landed in prompt 2:

> "I would like to give a tool for the LLM to search files, store local changes, and
> download / sync back the file… connect a local folder and make a two-side
> synchronization… put a marker file inside the directory which contains the drive
> link… commands to download changes, upload changes or sync… I don't want to work
> offline, because I have state in local. But when concurrent modification happens in
> the same file, be able to detect that. Maybe 10–10,000 files with complete
> hierarchy. I don't care about rate limits."

Restated after the steering turns clarified it: **design (not build) a stateful,
bidirectional file-sync engine** where an LLM edits files in a local folder and syncs
them back to Google Drive (and ideally Dropbox/OneDrive/iCloud too), with a marker
file per folder, git-style three-way conflict detection, and a hard **data-safety-first**
posture. The deliverable is a **complete, doubt-reviewed OpenSpec change** captured on
`develop` and ready to hand to a worktree builder — never any runtime code.

## 2. TL;DR playbook

1. **Start in explore mode** (`/skill:openspec-explore`). State up front: "think and
   pressure-test only, don't scaffold yet." Give the AI the *use case* (LLM editing
   files locally), not a solution ("should I cache in SQLite?").
2. **Let the AI reframe the problem.** It correctly reframed "cache for speed" →
   "**sync ledger**" (SQLite becomes the load-bearing baseline, not an optional cache).
   Accept reframes that shrink the hard part.
3. **Nail the policy before the mechanism.** Drive one decision at a time with terse
   steers: `nail down policy` → `1. keeping out / 2. deletes always manual` →
   `resolve`. Force the conflict/delete posture to settle first.
4. **Widen scope deliberately, once.** Ask `is it possible to support other file share
   services?` — this forces a **provider-adapter interface** (5 verbs) that keeps the
   engine provider-agnostic.
5. **Say `pressure test` repeatedly.** Each round the AI tries to *break* its own
   design and finds real data-loss paths (crash atomicity, exactly-once impossibility,
   native-doc conversion). This is the highest-leverage move in the whole session.
6. **Force a completeness proof.** Say `completeness matrix` — turns "everything routes
   to a safe behavior" from an assertion into a checkable `local × baseline × remote →
   route` function (the spec backbone).
7. **`capture it`** into OpenSpec (`proposal.md` + `design.md` first, specs/tasks later).
8. **Run `/skill:plan-proposal`** from the main session — it runs `doubt-driven-review`
   (single + cross-model), folds scenarios into `tasks.md`, commits to `develop`, and
   **stops at the worktree boundary**. Answer its HARD gate (concrete numbers it can't
   invent), then let it commit.

## 3. How the collaboration unfolded

Six phases over ~18h wall-clock (mostly idle gaps between operator turns), 13 operator
prompts, Opus at high thinking, ~$13.60.

**Phase 1 — Reframe (prompts 1–2).** The operator asked what looked like a caching
question. The AI *refused the frame* and drew the real one: not a cache, a **three-way
sync ledger** (local vs. baseline vs. remote md5, the git model). *Why it worked:* the
AI diagrammed the core tension (NO CACHE vs SQLITE CACHE) and the three-way state
before picking, so the operator could see *why* the ledger is load-bearing rather than
being told.

**Phase 2 — Policy lockdown (prompts 3–5).** Terse steers (`nail down policy`, then two
numbered choices, then `resolve`) settled the conflict posture: conflicts **stage aside**
to `.gdrive-sync/conflicts/` (out of the tree the LLM walks), deletes are **never
auto-propagated** (manual only), per-file `canEdit` caps beat folder-level guesses.
*Decision points the human owned:* keep-out-of-tree vs. keep-both; manual-only deletes;
and the read-only-share question, which surfaced that Drive permissions are per-file, not
per-folder.

**Phase 3 — Multi-provider (prompt 6).** "Support Apple/SharePoint/Dropbox?" forced the
**Provider adapter** (`list / download / upload / delta / caps`). *Why it worked:* the
engine already never mentioned Google, so the seam was cheap — but the AI then
**pressure-tested the interface across Dropbox + OneDrive** and found two verbs break as
specified (mtime ambiguity, hash-vs-cTag), turning a naive interface into a real one.

**Phase 4 — Pressure test (prompts 7–10).** The heart. Repeated `pressure test` steers
made the AI attack its *own* design and then its *own fixes*: crash atomicity between
upload and baseline write (silent staleness), the **exactly-once impossibility** (journal
records intent, not outcome → choose at-least-once), and "coverage ≠ automation." The AI
hit "bedrock" (distributed-systems walls) and correctly converted unfixable gaps into
*reported* postures rather than fake fixes.

**Phase 5 — Capture + completeness (prompts 11–12).** `capture it` scaffolded the
OpenSpec change (`add-cloud-sync-connector`), noting the boundary with the existing
`add-connector-layer` (that one is stateless HTTP invoke; this is stateful sync — not a
dupe). `completeness matrix` produced the spec backbone: every `(local × baseline ×
remote)` cell maps to exactly one safe route (`noop / pull / push / stage-aside / report
/ skip+report / rebind`), with pre-passes for structural overrides and native docs.

**Phase 6 — plan-proposal + doubt review (prompt 13).** `/skill:plan-proposal` ran three
`doubt-driven-review` cycles (single-model, then cross-model **glm-5.2** for architectural
diversity). The reviews **converged** and caught four genuine data-loss paths — including
one the AI's *own cycle-1 fix* had introduced. It then hit `scenario-design`'s HARD gate
(needed concrete N/K numbers), the operator answered `N=3, K=10, functional-only`, and
the skill folded 45 automated scenarios into `tasks.md` (68 parser-safe checkboxes),
committed to `develop`, and stopped at the worktree boundary.

## 4. Prompts that worked

- **The goal prompt (rewrite for reuse).** The operator's opener was a good use-case
  dump (file counts, concurrency requirement, "state in local"). Keep that. The one
  improvement: lead with the *posture* — "**Data-safety first: never lose or silently
  overwrite; when in doubt, report and let me decide.**" That single sentence is what
  every later pressure test was really enforcing; stating it up front saves rounds.
- **`nail down policy` / `resolve` / numbered replies (`1. keeping out / 2. deletes
  always manual`)** — high-leverage because they *close* one decision instead of
  reopening the whole space. Terse, decisive steering beats paragraphs here.
- **`pressure test` (used 3×)** — the single most valuable prompt in the session. It
  flips the AI from *defending* its design to *attacking* it, which is where the real
  bugs surfaced. Reusable verbatim.
- **`completeness matrix`** — converts confident hand-waving into a checkable function.
  Demand it whenever the AI claims "everything is handled."
- **`is it possible to support other services?`** — a scope-probe that pays off by
  forcing a clean abstraction *before* it's expensive to add.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer the *literal* question ("cache in SQLite?") | Give the real use-case; let the AI reframe to a sync ledger | State the true objective (bidirectional sync) + data-safety posture in prompt 1 |
| Declare the design "safe, the rest is just knobs" | `pressure test` — repeatedly | Ask "what would make you *wrong*?" and require self-attack before accepting "done" |
| Guess folder-level permissions | `check: does this work with read-only shares?` | State that Drive perms are per-file up front → per-file `canEdit` caps |
| Propose a "fix" that only relocates the failure | `pressure test?` on the fixes themselves | Require the AI to attack its own patches, not just the original design |
| Introduce a *new* data-loss bug while fixing another (cycle-1 `resolve` fix) | Run **cross-model** doubt review; it caught the AI's own regression | Always take the cross-model second opinion when the author fixed a P1 |
| Want to invent boundary numbers (N, K) to look complete | Answer the HARD gate explicitly (`N=3, K=10, functional-only`) | Have concrete limits ready before folding scenarios |
| Treat `openspec validate` "errors" as failures | Recognize missing `specs/`/`tasks.md` is expected mid-capture | Know 2/4 artifacts is a valid checkpoint for "captured thinking" |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were *created* this session — the value came from **composing
existing ones in the right order**. Worth understanding why each was effective, because
reproducing the result means invoking them the same way:

- **`openspec-explore`** — the thinking-only stance. Effective because it *forbids
  implementation*, so the operator can pressure-test a design for hours without the AI
  prematurely writing code. Invoke it for any "should we / how would we" design question
  before a change exists.
- **`doubt-driven-review`** (invoked by `plan-proposal`) — the star. It spawns a
  **fresh-context adversarial reviewer** that never sees the author's CLAIM, then a
  **cross-model** reviewer (glm-5.2, deliberately a different family than the Claude
  author) for architectural diversity. Effective because it caught four real data-loss
  paths — including a regression the author itself introduced — that the confident
  exploration had missed. Invoke it before any irreversible/high-stakes design stands.
- **`plan-proposal`** — the orchestrator that chains artifact-creation → doubt-review →
  scenario-design → fold → commit, and **stops at the git-worktree boundary**. Effective
  because it enforces the review gate mechanically and keeps planning on `develop`
  (interactive) separate from building (headless worktree). Must run in the **main
  session**, never a subagent (it nests subagent spawns, which are blocked otherwise).
- **`scenario-design`'s HARD gate** — refuses to fold scenarios when a boundary needs a
  number the AI would otherwise invent. Effective because it converts a silent
  assumption into an explicit operator decision.

*Recommendation:* if you repeat this design pattern (data-safety-first sync/ledger),
consider a memory capturing the **impossibility triangle** (exactly-once is impossible →
choose at-least-once + report) so the AI reaches for "report, don't guess" immediately
instead of after three pressure-test rounds.

## 7. Pitfalls & dead ends

- **"Server-authoritative" concurrency looked viable, then collapsed.** Preconditions
  (eTag) only guard the *push* path; the *pull* direction still needs a local baseline,
  and the local/iCloud adapter has no precondition at all. → Keep the **local baseline
  as truth**, use server preconditions only as a backstop.
- **Journaling ≠ exactly-once.** The intent-journal records intent, not remote outcome;
  a replayed `create()` with no idempotency key makes duplicates. → Adopt the *posture*
  **at-least-once (tolerate harmless dup/orphan, never lose)** and *report* it — don't
  pretend the gap closes.
- **Fixing a P1 can create a P1.** Cycle 1's `resolve` fix advanced the baseline to
  merged-local → next sync pulled old remote over the merge = data loss. → `resolve`
  must **push merged→remote** and set *both* `baselineLocalHash` and `remoteVersion`,
  ending in `noop`. Always re-review your own fixes (cross-model).
- **Native Google docs have no md5.** Routing them through `push` silently converts the
  format. → Pre-pass: native-doc + local edit → `skip+report`, **never** push.
- **`openspec validate` "error" at 2/4 artifacts is not a failure** — it just flags that
  `specs/` and `tasks.md` aren't written yet. Capturing thinking (proposal + design) is a
  valid stopping point.
- **Nearly duplicated an existing change.** `add-connector-layer` (stateless HTTP/OpenAPI
  invoke gateway) looks adjacent. → Note the boundary in the proposal: this is a
  *stateful* sync engine; they share auth but don't overlap.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The use case in one line + the **data-safety posture** ("never lose/overwrite; report
  when in doubt").
- Concrete boundary numbers the scenario gate will demand (this run: `N=3` conflict
  copies, `K=10` tombstone-retention cycles, functional-only tests).
- On `develop`, OpenSpec available, no worktree yet.

**Steps:**
1. `/skill:openspec-explore` — state "think + pressure-test only, don't scaffold."
2. Give the use case + posture; accept the AI's **cache → sync-ledger** reframe.
3. Lock policy one decision at a time: conflict = stage-aside; deletes = manual;
   caps = per-file. (`nail down policy` → numbered replies → `resolve`.)
4. Probe scope once: "support other providers?" → 5-verb **Provider adapter**.
5. `pressure test` 2–3× until the AI hits distributed-systems bedrock and converts
   unfixable gaps to *reported* postures.
6. `completeness matrix` — demand a `(local × baseline × remote) → route` function.
7. `capture it` → OpenSpec `proposal.md` + `design.md` (specs/tasks come later).
8. `/skill:plan-proposal` from the **main session** — let it run doubt-review
   (take the cross-model opinion), answer the HARD gate, let it fold + commit + stop.

**Final artifacts produced (committed to `develop`, `c6959899f`):**
- `openspec/changes/add-cloud-sync-connector/proposal.md`
- `openspec/changes/add-cloud-sync-connector/design.md` — the star (impossibility
  triangle + failure-mode catalog + 8 decisions + provider table + 3 invariants)
- `openspec/changes/add-cloud-sync-connector/specs/cloud-file-sync/spec.md` — 42+
  scenarios, the completeness-matrix backbone
- `openspec/changes/add-cloud-sync-connector/test-plan.md` — scenario→level manifest
- `openspec/changes/add-cloud-sync-connector/tasks.md` — 68 parser-safe checkboxes
- Ready to spawn a worktree via `ship-it` from that commit.

---

_Generated from session `019f688e-a601-7ff8-9e24-dbb2cfe619f0` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/gdrive_facts.md`._
