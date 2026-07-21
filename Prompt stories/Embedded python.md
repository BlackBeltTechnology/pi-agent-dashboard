# How we did it: Bundling an embedded Python runtime — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, not an
implementation task. The operator wanted to reason through a hard product question:
**can the pi-dashboard Electron app ship its own Python runtime**, so agent tool calls
(and arbitrary `bash` calls like `python x.py` / `pip install foo`) "just work" without a
host Python?

The real objective, sharpened by the steering turns, was two-fold: (1) **converge on a
defensible architecture** for bundling + materializing a Python environment that mirrors
the app's existing bundled-git/bundled-node precedent, and (2) **capture that thinking as
durable OpenSpec artifacts** and run it through the full `plan-proposal` planning gate —
ending at the git-worktree boundary, ready to implement. No code was written; the
deliverable is a fully-planned, doubt-reviewed change: `bundle-python-runtime`.

## 2. TL;DR playbook

1. **Start in explore mode** (`openspec-explore`) — force a think-first stance so the AI
   grounds in real code before theorizing. Kickoff: "Can we ship an embedded Python
   runtime for tool calls? Explore before proposing."
2. **Make the AI find the precedent first.** Ask it to trace how the app already bundles
   git + node (`bundle-server.mjs`, `download-git-windows.mjs`, `augmentEnvWithGitSource`,
   the spawn-env PATH-inject seam). Python mirrors this 1:1 — that discovery reframes the
   whole problem as "clone an existing wire," not "invent."
3. **Poke the naive answer.** Ask "can we just ship a venv?" — surfaces the load-bearing
   truth (venvs are absolute-path/symlink/shebang-bound → not relocatable) and points at
   the clean design: ship the *interpreter*, materialize the *env* locally on first run.
4. **Fork the key decisions explicitly** with the AI and pick: fixed baseline vs arbitrary
   installs, `uv` vs hand-rolled pip, base(copy)+overlay(clone) layout, eager vs lazy
   materialization, source-selection polarity. Ground `uv` claims in real docs
   (`ctx_fetch_and_index` on docs.astral.sh) — don't hand-wave.
5. **Answer the AI's convergence questions tersely** ("1 / eager / Tier 2") — by this point
   it has framed the tradeoffs, so one-word picks unlock a lot.
6. **Say "capture it"** → AI runs a coherence check against archived changes, scaffolds the
   OpenSpec change, and writes `proposal.md` + `design.md` (decisions D1–D7 with rationale).
7. **Invoke `plan-proposal`** → doubt-review (single + cross-model), scenario-design HARD
   gate, fold 24 scenarios into `tasks.md`, commit on `develop`, stop at the worktree
   boundary.
8. **Trust the cross-model reviewer.** It caught that the original async-materialization
   design was *architecturally impossible* (can't `await` in a synchronous inject seam) —
   the single most valuable correction of the session.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / grounding (explore mode).** The AI resisted theorizing and instead
read the actual Electron packaging pipeline: `electron-builder.yml`, `bundle-server.mjs`,
`download-git-windows.mjs`, `download-node.sh`, and traced `augmentEnvWithGitSource` →
`getActiveGitSource` → `ensureBundledGitOnPath` into the process-spawn PATH seam. *Why it
worked:* it found the app **already bundles two runtimes** with a tested seam. The entire
problem collapsed to "do for Python what git already does."

**Phase 2 — Interrogate the naive path.** Operator: "Is it possible to deliver venv
itself?" The AI drew the venv anatomy and showed exactly where it snaps when moved
(`pyvenv.cfg home=`, symlinks, shebangs). *Decision point:* ship interpreter + materialize
venv locally (Option C), not a pre-built venv.

**Phase 3 — Fork the design decisions.** Over several "keep pulling" / numbered-answer
turns, the AI laid out each fork as a diagram + tradeoff table: reproducible build-artifact
vs mutable user state; `uv` vs pip; base(`copy`, robust) + overlay(`clone`, fast) layout;
eager single-flight materialization; `pythonSource` default flipped to **bundled**.
*Why it worked:* it grounded the `uv` claims in fetched Astral docs (offline mirror,
`--require-hashes`, bundled certs, relocatable cache) instead of guessing.

**Phase 4 — Capture.** "capture it" → coherence check (no duplicate of git/node changes) →
scaffold `bundle-python-runtime` → write `proposal.md` + `design.md` (D1–D7, 7 risks,
migration, open Qs) → validate → canvas. Exploration became durable artifacts.

**Phase 5 — Plan-proposal gate.** Invoking `plan-proposal` ran the real planning
machinery: **doubt-review** spawned a fresh-context Explore reviewer, then a **cross-model**
GLM reviewer (deliberately different architecture from the Claude author). GLM returned
**13 grounded, file-referenced findings** — several load-bearing. The AI reconciled all 13,
rewrote D5, added D8, then ran **scenario-design** (HARD gate: two unfillable observable
slots surfaced as decision-forcing questions, both resolved), wrote a 24-scenario
`test-plan.md` manifest, folded it into a 42-task `tasks.md`, validated, committed
`9c570ab39` on `develop`, and **stopped at the worktree boundary**.

## 4. Prompts that worked

- **The goal prompt (explore-mode preamble).** Entering `openspec-explore` was the
  highest-leverage move: it installed a *think-first, never-implement* stance that made the
  AI ground in real code and reason through tradeoffs before writing anything. A future
  operator should open the same way: *"Explore mode. Can we bundle an embedded Python
  runtime so agent + bash tool calls work with no host Python? Ground in how we already
  bundle git/node before proposing anything."*
- **"Is it possible to deliver venv itself?"** — a naive-sounding poke that forced the AI to
  expose the load-bearing constraint (venv non-relocatability). Great pattern: *aim a
  simple question at the part you suspect is fragile.*
- **"keep pulling" / "go on"** — cheap continuation prompts that let the AI fully develop a
  branch instead of stopping at the first plausible answer.
- **"1. Agents, but in bash calls have to work also / 2. eager / 3. Tier 2 is enough"** —
  terse, numbered answers to the AI's convergence questions. High leverage *because* the AI
  had already framed each fork; the operator only had to pick.
- **"capture it"** — the transition from thinking to durable artifact. One word, because the
  design had cohered.
- **Invoking `plan-proposal`** — didn't re-explain the plan; handed the AI the skill and let
  it run the gate end-to-end.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Theorize about bundling before reading the real pipeline | Explore-mode stance forced grounding first | Open in `openspec-explore`; ask for the precedent trace before any design |
| Accept "ship a venv" at face value | "Is it possible to deliver venv itself?" | State the constraint up front: *venvs aren't relocatable — ship interpreter, materialize env* |
| Stop at the first plausible design | "keep pulling", "go on" | Ask for the fork tree + tradeoffs, not a single recommendation |
| Leave `uv` behavior as ~80%-sure assumptions | (implicit) — AI self-corrected by fetching docs | Demand doc-grounding for any external-tool claim (`ctx_fetch_and_index`) |
| Design async venv-materialization awaited in the spawn seam | Ran `plan-proposal` → doubt-review → cross-model GLM caught it | Always route a non-trivial design through doubt-review *before* implementation; the sync/async seam mismatch is invisible on paper |
| Return truncated subagent findings | Noticed the truncation, pulled full detail, justified a cross-model second pass | Verify reviewer findings against real code; escalate to cross-model when the first return is partial or a finding looks load-bearing |

Scope clarifications the operator imposed that shaped the result: **"bash calls have to
work also"** (pins Python onto `PATH`, not a bespoke tool — confirms it rides the git wire);
**"eager"** materialization; **"Tier 2 is enough"** (per-arch tarball, offline interpreter,
graceful package degradation — bounds the scope).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was *created* this session — the value came from **composing existing
skills as a pipeline** and producing durable OpenSpec artifacts. Worth internalizing:

- **`openspec-explore`** — the think-first stance. *Effective because* it structurally
  prevents premature implementation and forces code-grounding; the AI produced a real
  architecture instead of a plausible-sounding sketch. Invoke it whenever the problem is
  "should we / how would we," not "build X."
- **`plan-proposal`** — the planning orchestrator (main session only). *Effective because*
  it chains doubt-review + scenario-design + task-fold into one gate that hardens a plan
  before a single line is written. Invoke it once a change's `proposal.md` + `design.md`
  exist and you want them battle-tested.
- **`doubt-driven-review` + cross-model reviewer** — the session's MVP. *Effective because*
  a **different-architecture** reviewer (GLM, not the Claude author) caught an
  architecturally-impossible design (async await in a sync seam) with file-level evidence.
  Invoke a cross-model pass whenever a design leans on a seam you haven't executed, or the
  first reviewer's return is partial/load-bearing.
- **The bundled-git precedent as a template** — the reusable *asset* here is recognizing
  that `augmentEnvWithGitSource` / `getActiveGitSource` / `ensureBundledGitOnPath` is a
  general "bundle-a-runtime-and-inject-it-on-spawn" pattern. *Recommendation:* if this
  recurs (bundling a 3rd runtime), consider a memory or short doc capturing
  "runtime-bundle seam = these three functions + `bundle-server.mjs` staging + GO/NO-GO".

## 7. Pitfalls & dead ends

- **`npx openspec change new` / `npx openspec new change` both failed.** The scaffold CLI
  surface was wrong; the AI recovered via `npx openspec --help` → `new --help` and the
  correct invocation. *If you hit this:* check `--help` for the exact subcommand before
  assuming the change didn't scaffold; verify with `ls openspec/changes/<name>/`.
- **Original design D5 was architecturally impossible.** "First call awaits the memoized
  materialize promise" cannot work — `augmentEnvWithGitSource` is called from **synchronous**
  chains (`buildSpawnEnv` via `binary-lookup.ts`, `terminal-manager.ts`) and the child is a
  separate process. *If you design an inject seam:* confirm whether the call site is sync
  before proposing an async step. The fix was sync-inject + bare-interpreter fallback +
  decoupled background materialize.
- **`uv --mirror file://` layout was unverified** and flagged as highest blast-radius. *If a
  design depends on an external tool's on-disk contract:* mark it a spike/unknown, don't
  bake it in as fact.
- **Subagent returns get truncated.** The first doubt-review return referenced Issues #1–#6
  but the bodies were cut. *If a reviewer summary is partial:* pull the full detail before
  reconciling; don't reconcile against a summary.
- **Two injection points, not one.** `terminal-manager.ts` confirmed both a ToolResolver
  path and a PTY path — Python needs both, like git. *Don't wire only the obvious seam.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the target repo on `develop`; awareness of the existing
bundled-runtime seam (`augmentEnvWithGitSource`, `bundle-server.mjs`, `download-*.mjs`); the
external-tool docs you'll ground on (`uv` → docs.astral.sh).

- [ ] Open in `openspec-explore` — think-first, never implement.
- [ ] Make the AI trace the existing bundle-a-runtime precedent (git/node) end-to-end.
- [ ] Poke the naive path ("just ship the venv?") to surface the load-bearing constraint.
- [ ] Fork the real decisions; ground external-tool claims in fetched docs, not assumptions.
- [ ] Answer convergence questions tersely once the tradeoffs are framed.
- [ ] "capture it" → coherence-check archived changes → scaffold change → `proposal.md` +
      `design.md` with numbered decisions + rationale.
- [ ] Invoke `plan-proposal`; **let doubt-review run a cross-model pass**; reconcile every
      finding against real code (verify, don't rubber-stamp).
- [ ] Run scenario-design's HARD gate; resolve unfillable observable slots as questions.
- [ ] Fold scenarios into `tasks.md`; validate; commit on `develop`; **stop at the worktree
      boundary** (implementation is a separate, headless phase).

**Final artifacts produced** (`openspec/changes/bundle-python-runtime/`):
`proposal.md` · `design.md` (D1–D8, doubt-reviewed) · `specs/**` (3 capabilities) ·
`tasks.md` (42 tasks: 18 impl + 24 folded tests) · `test-plan.md` (24 automated scenarios).
Committed `9c570ab39` on `develop`.

---

_Generated from session `019f686b-0951-7edb-b483-fb78491738ab` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/session_facts.md`._
