## Context

See `proposal.md` — Why. The harness at `scripts/ab-context/` already exists and
works; `ab-test-plain-language-rule` left it with an invalid-run guard, N-arm
`analyze.mjs`, `OUT`/`TASKS_FILE` overrides, and a resumable judge.

The constraints that shape this design:

- `run.sh` is **strictly sequential** — wall clock is `runs × per-run latency`,
  with no parallelism to buy back.
- `run.sh` reads `./arms.json` by a hardcoded `require`; there is no override.
- `analyze.mjs` computes non-inferiority **per task×check cell only**. Nothing
  aggregates a tell across tasks, and there is no bootstrap anywhere.
- `extract.mjs` marks a run invalid **only** on zero assistant text.
- The host is chronically memory-pressured; measured per-run latency degraded
  from ~3 min to 20–40 min.

### Prior-data disclosure (read this before trusting the pre-registration)

**A 3-arm pilot already ran and its outputs are on disk.**
`scripts/ab-context/runs-plain-language/` holds A/B/C × 5 tasks × N=1, and
`rows-plain-language.jsonl` holds all three arms' per-tell rows. That pilot was
run on the **old** battery (`tasks-plain-language.jsonl`), not the hard battery
this change introduces, and it ended in a recorded null.

It still matters, and pretending otherwise would be dishonest:

- The pilot's control left exactly one tell below ceiling — `jargon_defined` at
  50%, everything else 100%.
- The "mechanical" endpoint priority order in D3 puts `jargon_defined` **first**.

So the order was written by someone who had already seen which tell had headroom.
The order is defensible on a priori grounds (it ranks tells by how much a reader
actually suffers from them), but that argument is unfalsifiable after the fact,
which is the whole reason pre-registration exists. Stating it plainly:

- **Postdates the pilot:** the endpoint priority order.
- **Does not depend on it:** the eligibility cut, the ABORT rule, the win
  thresholds, the guard structure, N, and the staging — these are what actually
  protect reachability, and they constrain the endpoint regardless of its rank.
- **Mitigation:** every stage writes to a **fresh `OUT` directory**; no
  prior-battery run is readable by, or poolable into, this experiment's
  aggregates.

The honest summary is that the priority order is *informed*, not blind, and the
reader should weigh it accordingly.

## Goals / Non-Goals

**Goals:**

- A decision rule that is **reachable in practice**, not merely on paper — the
  prior change died of arithmetic unreachability, and adversarial review found
  two further ways this design could have died of *statistical* unreachability.
- Every parameter fixed before any data is seen, with **no human judgment**
  anywhere in the path from measurement to verdict.
- Fail cheap: exits that fire before the expensive stage, not after.

**Non-Goals:**

- Not building a general statistics library. The bootstrap is one function over
  one data shape.
- Not making `run.sh` parallel. Concurrency would contend on the same degraded
  host and change per-run latency non-uniformly across arms — a confound on the
  measurement itself.
- Not fixing the judge's cost or speed. The judge is gated, not optimized.
- Not re-landing the prior change's harness fixes.

## Decisions

### D1 — Flash carries the verdict; opus only confirms

**Why:** The construct of interest is the readability of output the *human*
reads, which is opus. But 3 arms × 8 tasks × N=10 on opus is ~240 sequential
runs at 25–40 min — days of wall clock that will not finish. Flash is ~$0.08 and
minutes per run, which makes N=10 affordable, and **N is what buys the power the
decision rule needs**.

**Alternative rejected — opus throughout:** the honest version of that plan has
N≈1–2, and at that N the non-inferiority guards are pure noise. A well-powered
flash experiment plus a directional opus confirmation is strictly more
informative than an underpowered opus experiment.

**Trade-off accepted and recorded:** a flash null is weaker evidence than an opus
null. It must be reported as *"no effect detected on flash"*, never *"the rule
does not work"*.

### D2 — Evidence-of-harm, not proof-of-harmlessness, for the guard criteria

The primary endpoint carries the burden of proof (delta ≥ +20pp, CI on the
difference excluding zero). The guard criteria (other tells, identifiers, cost)
invert it: they fail **only when harm is demonstrated** — point estimate past the
margin **AND** significant.

**Why:** a bare point-estimate test at δ=0.10 is smaller than one standard error
at this N. Applied to 5 secondary tells it would spuriously fail ~60–75% of the
time per arm under a true no-difference — a rule that manufactures nulls, which
is the same failure family as the prior change. Guards exist to catch a real
regression (`no_hedging` 60%→20%), not to demand statistical proof of equality
that the design cannot power.

**Alternative rejected — formal TOST equivalence testing on every guard:**
correct in principle, but needs far more N than the budget allows, and would
reintroduce guaranteed nulls.

### D3 — The endpoint is chosen by a declared priority order, on a fixed task set

`jargon_defined` > `no_hedging` > `short_sentences` > `no_preamble` >
`answer_first` > `no_recap`; take the highest-priority tell whose control rate on
the **6 hard tasks** is ≤70% with CI upper bound ≤80%.

**Why mechanical:** any human choice made after seeing control data is a
researcher degree of freedom, and the plan's credibility rests on there being
none.

**Why the same task set for eligibility and pooling:** if eligibility were
computed over all 8 tasks, the two ~100% ceiling controls drag the pooled rate
down — a tell could read ≤70% overall while sitting at ~85% on the hard 6,
passing eligibility yet unable to reach +20pp. Eligibility and endpoint must be
measured on identical data or the reachability guarantee is void.

**Why the CI bound:** a *measured* 70% at this N has a 95% CI of roughly 51–84%.
Without the upper-bound condition, a truly-84% tell passes the cut and +20pp is
again unreachable against the true rate.

### D3b — Judge validation runs before any arm, not after

**Why:** the rule says a closed judge gate ⇒ null-only, never an adopt. The
design's own risk register expects the gate to stay closed on this host. Running
the experiment first would therefore spend ~240 flash runs and up to 54 opus runs
to reach an outcome that *by rule* cannot adopt — the "fail cheap" goal stated
two sections up, violated by the sequencing. Judge validation is 8 calls. It goes
first, and a gate that cannot open on a healthy host ends the change there with a
recorded null.

**Consequence, made explicit:** opus confirmation runs only when the gate is
open. A regex-only flash win does not buy opus time.

### D4 — The shakeout is control-only, and it is where the cheap exit lives

Stage 1 runs **arm A alone** via the new `ARMS_FILE`, and applies the ABORT rule:
no tell ≤70% ⇒ the battery created no headroom ⇒ record a null and stop, before
a single treatment run.

**Why control-only:** a 3-arm shakeout would hand the experimenter
treatment-vs-control deltas before the endpoint is "pre-registered". Declaring
the endpoint is set by priority order is a norm; not having the data is a
mechanism.

### D5 — Opus replication is directional, not inferential

Replication holds iff the opus primary-tell delta is positive and ≥ +10pp. No CI
requirement.

**Why:** at K=6 task clusters a bootstrap CI on a difference has a half-width of
roughly ±25–35pp. Demanding significance there would reject a genuine +20pp
replication most of the time — a null-after-win by construction, and the most
expensive possible way to produce one. Opus confirms direction and rough
magnitude; flash already carried the inference.

### D6 — Invalidity is recorded by the runner, not inferred from the transcript

`run.sh` captures `timeout`'s exit code (124) and writes a per-run status
sidecar; `extract.mjs` treats a non-zero runner status as invalid in addition to
its existing zero-text check.

**Why:** a killed or provider-errored run leaves a *truncated* transcript that
still contains assistant text. The existing zero-text guard cannot see it, and a
truncated answer would silently score the tells — quietly passing every negative
check, which is precisely the failure the zero-text guard was added for.

### D7 — Bootstrap specification

Paired by task (all arms run the same tasks), resampled at the **task-cluster**
level, 10 000 resamples, BCa intervals, invalid runs dropped before resampling.

**Why clusters:** task difficulty clusters strongly; run-level resampling treats
correlated runs as independent and produces CIs that are too narrow.
**Why paired:** every arm sees the identical task set, so pairing removes
between-task variance and is free power.

## Risks / Trade-offs

- **K=6 clusters is below the ≥20 the bootstrap literature wants** → mitigated by
  pairing and BCa, not eliminated. This is exactly why D5 avoids a CI test.
- **Flash null ≠ opus null** → reported in those words; the asymmetry is
  conservative (it can only under-claim).
- **Judge gate probably never opens on this host** → rule already handles it:
  regex-only ⇒ null-only, never an adopt.
- **Idle-host precondition may block indefinitely** → that is the intended
  behaviour. Blocking is honest; silently running on a degraded host produced
  the prior change's 600 s timeouts and unusable measurements.
- **`analyze.mjs` is being modified again** → the last modification to this file
  inverted a verdict (arm B's token delta, −0.3% → +24.6%) and was caught only by
  review. `review-code` on this file before any number from it is trusted is a
  hard task, not a nicety.
- **Author-written `answer_first` anchors on open-ended prompts** → arm-neutral
  (same model everywhere; only Rule 5 differs), so bias largely cancels; residual
  risk if a treatment rule systematically re-frames answers outside the anchors.

## Migration Plan

Not applicable — no deployed artifact, no data migration. Rollback is deleting
the worktrees and the run outputs. Root `AGENTS.md` is touched only on a win, and
that edit is a single revertable commit.

## Open Questions

Adversarial review found that the previous "none" here was false — several
verdict-changing parameters were genuinely unspecified. They have been resolved
into `proposal.md` rather than deferred: judge NI margin (0.5 points on the 1–5
axis), eligibility N and CI basis (stage 1 raised to N=10 so the eligibility CI
is computed at the same N as the endpoint), guard pooling set (all 8 tasks, vs
hard-6 for the primary), the cost test (same cluster bootstrap on the difference
of means), per-stage timeouts (flash 900 s / opus 3600 s), the minimum-valid-N
floor, and arm-axis multiplicity (Bonferroni, each arm at 97.5%).

Genuinely deferrable, and deferred:

- **BCa stability at K=6 clusters.** Some implementations are undefined or
  unstable at this cluster count. Fallback to the percentile interval if BCa
  fails to compute; the choice does not change the approach or the task
  breakdown, only the interval arithmetic, and it is decided at implementation
  against the actual resampling output.
- **Which transcripts feed judge validation, and how they are blinded.** Any 8
  arm-blinded transcripts serve; the selection does not alter the gate's meaning.
- **Mid-stage host degradation.** The health check is sampled at stage start. A
  degradation mid-stage is handled by the timeout + valid-N floor already
  specified; whether to add periodic re-sampling is an implementation detail.

One scope clarification, since the design claims "no human judgment between
measurement and verdict": the `doubt-driven-review` pass on the final verdict is
there to catch *errors* (as it did when it inverted arm B's token delta in the
prior change). It may not re-decide the outcome. If it finds the rule was
misapplied, the rule is re-applied correctly — it never selects a different rule.
