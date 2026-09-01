---
session: 019f71e1
week: 2026/W29
type: documentation
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (15 user prompts); large facts sheet (~23492 tok)"
upgrade_status: pending
---

# How we did it: Reverse-engineering OpenSpec specs from code — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking stance, not an
implementation workflow. The real objective, clarified in the first working turn, was:
build a **skill that reverse-engineers OpenSpec `spec.md` files from existing code**, and
crucially, **tune it with a measured A/B loop** before trusting it. The tuning method: pick
real specs as ground truth, have subagents blind-generate specs from code alone, then have a
judge subagent score generated-vs-real semantically. Once the generator prompt was proven,
run the skill across the whole monorepo to backfill missing capability specs so they enrich
`kb_search`. What began as "make a skill" became "**prove the skill works, quantify where it
breaks, harden it, then ship 102 specs.**"

## 2. TL;DR playbook

1. **Frame it as a tuning problem, not a coding task.** Say up front: "build the generator
   prompt, but validate it with a blind-generate → judge loop against N real specs first."
2. **Pick 6 real `spec.md` as ground truth** spanning easy→hard (single-file → cross-cutting).
   Map each to its source file(s). *Don't read the code yourself* — the subagents do, keeping
   the orchestrator's context clean.
3. **Build a throwaway harness**: `PROMPT_v1.md` (generator), `JUDGE_PROMPT.md` (judge),
   scratch dirs. Generators run **blind** (code only, never the real spec).
4. **Run iteration 1** — N parallel generators (`@research`), then N parallel judges. Read the
   scoreboard: requirement coverage, scenario coverage, hallucinations, format.
5. **Diagnose the systematic failure**, not per-spec noise. Here: under-scoped input — the
   generator can only spec what it's shown. Fix by making it **follow the contract across file
   boundaries** (v2 prompt). Re-run: 66.8% → 97.2% requirement coverage.
6. **Materialize the skill** (`SKILL.md` + discovery/generator/auditor prompts) with a
   discover → generate → audit → revise → promote pipeline and a **conservative duplication
   gate** (discovery reads existing specs, returns only genuine gaps).
7. **Live-validate on one spec-less package**, confirm zero hallucinations, then **bulk-run**
   across the monorepo. Promote only audit-passed + `openspec validate`-passed specs.
8. **Stress-test the model floor**: re-run the same 6 generations on cheaper models
   (`@compact`, `@fast`), judge with the constant `@research` instrument, measure the loss.
9. **Bake the findings back into the skill** (format hard-gate, `openspec validate` promote
   gate) and **move the experiment record into `docs/research/`** (delegated, caveman style).

## 3. How the collaboration unfolded

**Phase A — Frame & map (explore).** The AI resisted implementing (explore stance), instead
mapping 6 ground-truth specs to source files via `grep` for distinctive symbols. Decision
point: the human wanted a *measured* tuning loop, so the AI scaffolded a throwaway harness
rather than writing the skill first. **Why it worked:** treating prompt quality as an
optimization target (with a judge as fitness function) turned a vibes task into a metric.

**Phase B — Tune (generate → judge → diagnose → repeat).** Iteration 1 scored 66.8% req /
58.8% scen coverage. The AI correctly identified the *dominant* failure as under-scoped input
(server-restart 40% — its contract lived in files the generator wasn't shown), not model
weakness. v2 added cross-boundary exploration → 97.2% / 90.8%. **Why it worked:** diagnosing
the *systematic* root cause across specs beat tweaking any single spec.

**Phase C — Materialize & live-validate.** Built the skill with a conservative discovery gate
and an oracle-is-code auditor. First live run on `bus-client` produced zero hallucinations —
but surfaced a real defect: scratch specs under `openspec/` polluted `kb_search`. Fix:
relocate scratch to a gitignored repo-root dir. **Decision point:** the human's short "run"
authorized the live test.

**Phase D — Bulk backfill (autonomous).** With short steering ("keep going", "yes"), the AI
swept ~16 packages in waves, exercising the revise loop (~23 of 102 specs needed one revision,
all caught by the auditor, none reaching `openspec/specs/` as fabrications). Grew the corpus
399 → 501 (+26%).

**Phase E — Model-loss stress test.** The human asked to test cheaper/faster models. The AI
re-ran the same 6 generations on Haiku (`@compact`) and deepseek-flash (`@fast`), judge held
constant. Finding: **format compliance, not comprehension, is the cheap-model casualty**; a
one-line format directive recovered flash to 6/6 valid. Later scaled the test to 20/15/53-req
giants: the cheap-model gap *widens with complexity* (~1pt small → 22pt on the 53-req spec).

**Phase F — Harden & document.** Baked the format hard-gate + `openspec validate` promote gate
into the skill; committed 102 specs; moved the experiment record into `docs/research/` (both
a data doc and a method doc), delegated to DocScribe per the repo's caveman-style docs rule.

## 4. Prompts that worked

- **The goal prompt (explore + tuning intent).** Framing the work as "build the prompt, but
  *measure* it against real specs with a judge" was the highest-leverage move. It made the AI
  build a fitness function instead of guessing at prompt quality. A future operator should
  say explicitly: *"Tune this via a blind-generate → judge A/B loop against N ground-truth
  examples; report coverage before shipping."*
- **High-leverage one-word unlocks.** `run`, `keep going`, `yes`, `a` — each authorized the
  next autonomous wave. These work *because* the AI had already laid out a numbered plan and
  a duplication gate; the human was approving a well-scoped next step, not delegating blind.
- **"Is it possible to test that with a smaller / faster [model]?"** — turned a shipped skill
  into a measured model-loss curve. Reusable pattern: after any prompt-tuning win, ask for the
  *cheap-model degradation test* to find the cost/quality floor.
- **"Is it possible to test with larger and more complex scenarios?"** — the scale stress test.
  Rewrite of a weak "does it still work?" into a decisive experiment.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to write the skill immediately | Keeping it in explore/tuning mode ("build the harness first") | State "prove it with a judge loop before materializing the skill" in the goal |
| Write scratch specs under `openspec/` | (discovered mid-run) relocate to gitignored repo-root | Saved a **project memory**: never write draft specs under `openspec/` — it pollutes `kb_search` |
| Over-split requirements (9 gen vs 1 real) | v2 prompt: "group into 3–8 requirements" | Ship the grouping rule in the generator prompt |
| Spec only the file it was shown | v2: "follow the contract across file boundaries" | Cross-boundary exploration is the #1 coverage lever — make it a hard rule |
| Treat current-code accuracy as "hallucination" vs a stale spec | "describe CURRENT code; code is the oracle" | Auditor grounds against **code, not the old spec** |
| Cheap models break OpenSpec format (tables, `**Scenario:**`, numbered reqs) | Add an explicit format directive | Format **hard-gate** + `openspec validate` promote gate |
| Risk duplicating existing specs at scale | Conservative discovery reads existing specs, returns only gaps | Keep the gate; manually drop near-duplicates the gate misses |

## 6. Skills, tools & memory created — and why they're effective

- **Skill: `reverse-spec-from-code`** (`.pi/skills/reverse-spec-from-code/` — SKILL.md +
  discovery/generator/auditor prompts). Captures a discover → generate → audit → revise →
  promote pipeline that reverse-engineers code into OpenSpec `spec.md`. **Effective because**
  it (a) runs blind generators in parallel per capability, (b) grounds every spec against the
  *code* as oracle (not a stale spec), and (c) gates promotion on both audit-pass and
  `openspec validate`. Invoke it to backfill missing capability specs so `kb_search` gets
  code-grounded coverage. Its generator prompt is *tuned*, not guessed (66.8% → 97.2%).

- **Project memory saved:** *`kb_search` indexes everything under `openspec/`. Draft/scratch
  OpenSpec specs must NOT be written under `openspec/` or they pollute `kb_search` with
  duplicate spec chunks — use a gitignored repo-root scratch dir.* **Effective because** it's
  a non-obvious environment gotcha that silently corrupts search results; the memory prevents
  every future spec-generation run from repeating it.

- **Subagent pattern (the real reusable asset):** a **generator/judge A/B loop** where the
  judge is a *separate, constant measurement instrument* (`@research`) and the only variable
  is the generator prompt (or model). This turns prompt engineering into a metric-driven
  optimization. Reuse it for any prompt you want to *prove* rather than hope works.

## 7. Pitfalls & dead ends

- **Scratch under `openspec/` pollutes `kb_search`.** The top hit resolved to the `.reverse-gen/`
  scratch path, not the promoted spec. Fix: gitignored repo-root scratch dir (`.reverse-spec-scratch/`).
- **Over-clustering in discovery.** Early discovery split one file into 5 overlapping
  capabilities (would spawn 5 redundant generators on the same source). Fix: "prefer
  file-distinct capabilities; don't fragment one file into many."
- **Cheap models silently break format.** Haiku emitted markdown tables / bold `**Scenario:**`
  / numbered requirements → 3/6 failed `openspec validate`. Comprehension was fine (~88%);
  *format* was the casualty. Fix: explicit format directive recovers flash to 6/6.
- **"Hallucination" that's actually accuracy.** When the real spec is stale, a generator
  describing current code looks like a hallucination. Always ground the auditor on **code**.
- **`openspec validate --specs <name>` ignored a positional arg** and validated a default set.
  Validate each new spec explicitly (throwaway `_rsfc-val-<cap>` id, then delete).
- **Parallel generators can hang / get terminated on the giant.** Process what landed, then
  re-run the rest in smaller isolated batches.
- **Coverage degrades with capability size** (~97% at 1–7 reqs → 50–85% at 20–53 reqs) and the
  file list, not the model, sets the ceiling. Decompose big capabilities rather than one blind
  pass at a monolith.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A target monorepo with existing OpenSpec specs (for ground truth + the duplication gate).
- Role aliases: `@research` (generator + judge quality), `@compact`/`@fast` (cheap-mode tests).
- A gitignored repo-root scratch dir (NOT under `openspec/`).

**Steps:**
1. [ ] Pick 6 real specs spanning single-file → cross-cutting; map each to source files.
2. [ ] Scaffold harness: generator prompt v1, judge prompt, scratch dirs.
3. [ ] Run N blind generators (`@research`) → N judges. Read the coverage scoreboard.
4. [ ] Diagnose the *systematic* failure; fix the prompt (cross-boundary exploration first).
5. [ ] Re-run; confirm coverage jump (target ≳95% req).
6. [ ] Materialize the skill: discover → generate → audit(oracle=code) → revise → promote,
       with a conservative duplication gate + `openspec validate` promote gate.
7. [ ] Live-validate on one spec-less package; confirm zero hallucinations.
8. [ ] Bulk-run in waves; promote only audit + validate passers.
9. [ ] Model-loss test: re-run the 6 on cheaper models, judge constant; add a format directive.
10. [ ] Move the experiment record into `docs/research/` (delegated, caveman style); commit.

**Final artifacts:**
- `.pi/skills/reverse-spec-from-code/` (SKILL.md + 3 prompts), registered in `.pi/skills/AGENTS.md`.
- 102 new `openspec/specs/` capability specs (corpus 399 → 501, +26%).
- `docs/research/reverse-spec-from-code.md` (data) + `-session.md` (method).
- Commits `e9c582433` (specs + skill), `b999373c7` (docs relocation).

---

_Generated from session `019f71e1-93a9-7687-8ad9-927d4ac918e6` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-18. Source extract: deterministic facts sheet (session-to-guideline)._
