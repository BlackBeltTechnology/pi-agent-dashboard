## Why

`ab-test-plain-language-rule` returned a **metric-design null**: the control arm
passed 5 of 6 plain-language tells at 100%, so its decision rule ("strictly up on
≥4 of 6 tells") was arithmetically unreachable and no arm could ever win. The
cause was diagnosed in that change's own `results.md`: the battery was four
closed questions with known answers, and the tells it hunts — preamble, hedging,
buried answers — barely occur there. The question "does an explicit
plain-language Rule 5 improve output?" is still unanswered, and the prior change
produced what is needed to answer it: a working 3-arm harness, a diagnosis of why
the first attempt could not, and a list of the specific fixes required.

## What Changes

### The experiment design

- **New battery** (`scripts/ab-context/tasks-plain-language-hard.jsonl`) built
  from six prompt classes chosen to create headroom on the saturated tells:
  open-ended design questions, genuinely ambiguous asks, bad-news delivery,
  low-confidence/unverifiable territory, long multi-file synthesis, plus a small
  set of **closed-question ceiling controls** retained from the old battery. The
  controls are load-bearing: they prove the new battery created headroom
  specifically rather than just becoming harder for every arm.
- **Checks must not presuppose a known answer.** The old battery's checks lean on
  an expected answer token (e.g. `answer_first` matching `restart` in the first
  400 chars). Open-ended and ambiguous prompts have no such token, so each new
  task carries a per-task `answer_first` anchor derived from *that* task's
  acceptable answers. A class whose checks cannot be written without a known
  answer is cut from the battery rather than quietly reverted to a closed
  question.

### The decision rule (pre-registered, fixed before treatment data is seen)

- **One primary endpoint, chosen mechanically.** Exactly **one** tell is the
  primary endpoint. A win requires that tell to improve; every other tell is
  secondary and descriptive and may never by itself justify an adopt. This
  removes the multiplicity path in which several eligible tells × 2 arms give
  noise repeated chances to look like a win.
- **Eligibility: control pass-rate ≤ 60%, measured on the same 6 hard-class
  tasks the endpoint is pooled over**, with the 95% CI upper bound ≤ 70%. The
  cut is 60 and not 70 because the win test is `≥ +20pp AND CI excludes zero`,
  and the difference CI half-width at this N is roughly ±14–19pp. A tell whose
  *true* control rate is ~80% therefore cannot clear both halves of the test
  except at a near-perfect treatment rate — an eligible-but-unwinnable band, the
  same defect as the original 70–90% band one level down. The reachability
  arithmetic must be done for the primary criterion, not only for the guards. Not
  "unsaturated" (<90%). Two traps are being closed at once:
  - A tell whose control rate sits in 70–90% is *eligible-looking but
    unwinnable*: the win threshold is +20pp and the max achievable delta is
    100 − p.
  - If eligibility were computed over all 8 tasks, the two ~100% ceiling
    controls would drag the pooled rate down — a tell could read ≤70% overall
    while sitting at ~85% on the hard 6, passing eligibility yet still unable to
    reach +20pp. **Eligibility and the endpoint must be computed on the same
    task set.**
  The CI bound matters because a *measured* 70% at this N has a 95% CI of roughly
  51–84%; without it, a truly-84% tell passes the cut and the reachability
  guarantee fails against the true rate.
- **ABORT rule (hard).** If **no** tell scores ≤70% on the control arm, the
  battery failed to create headroom. Record a null and **stop before any
  treatment run**. This is the cheap, honest exit and it fires before the
  expensive half of the experiment.
- **Endpoint chosen by a priority order declared now**, not by judgment after
  seeing data: `jargon_defined` > `no_hedging` > `short_sentences` >
  `no_preamble` > `answer_first` > `no_recap`. The primary endpoint is the
  **highest-priority eligible tell**. No human picks it, so there is nothing to
  leak into.
- **The shakeout is CONTROL-ONLY.** It runs arm A alone (via the new
  `ARMS_FILE`). If it ran all three arms, the experimenter would hold
  treatment-vs-control deltas *before* "pre-registering" the endpoint — a norm
  is not a mechanism. Treatment arms are not run until the endpoint is fixed and
  written down.
- **Full rule.** An arm wins iff **all** hold:
  1. **Primary:** on the pre-registered primary tell, pass-rate delta ≥ +20pp,
     with a bootstrap 95% CI **on the difference** excluding zero (not
     non-overlap of two marginal CIs, which is ~p<0.01 and inflates nulls).
     Resampling unit is the **task cluster**, not the individual run — task
     difficulty clusters, so run-level CIs are too narrow.
  2. **No evidenced regression** on any other tell — saturated or not. A
     criterion fails **only when harm is demonstrated**: point-estimate drop
     > δ = 0.10 **AND** the bootstrap 95% CI on the difference excludes zero.
     Extending the guard to secondary tells closes the hole where an arm ships
     while `no_hedging` collapses 60%→20% — but the burden must be *evidence of
     harm*, not *proof of harmlessness*. A bare point-estimate test at δ = 0.10
     is smaller than one standard error at this N, so under a true
     no-difference each of 5 secondary tells would spuriously fail ~15–25% of the
     time and at least one would fail ~60–75% of the time per arm — manufacturing
     nulls by construction. That is the same "reachable on paper, null in
     practice" failure class this change exists to prevent, and it is exactly the
     argument already conceded for the cost gate.
  3. **Identifier retention:** `keeps_identifiers` guarded by the same
     evidenced-regression test. A "simpler" answer that drops technical
     identifiers is a regression, not a win. Each task declares its required
     identifier set **up front**, so the check exists on the hard tasks and not
     only on the retained controls.
  4. **Cost:** fails only when mean output tokens per valid run exceed control by
     **>5% AND** the difference is significant at 95%. The +5% margin alone is
     also about one standard error, so a bare threshold test would fail ~15–20%
     of the time under true equality.
  5. **Judge (only when the gate is open):** "understandable" axis non-inferior.
     Without this the judge gate was incoherent — it could block an adopt while
     contributing nothing to the rule.
- **Two treatment arms are tested, so each is tested at 97.5%** (Bonferroni over
  B and C). Testing both at 95% against a shared control gives ~7–10% family-wise
  chance of a false win under the global null — the multiplicity argument was
  applied to the tell axis and must apply to the arm axis too.
- **Tell applicability is declared per task class.** A tell is not scored on a
  class where it is construct-invalid. Specifically `no_hedging` is **not scored
  on the low-confidence/unverifiable class**: honest calibration on a genuinely
  uncertain question *should* hedge, so there the regex rewards suppressing a
  true uncertainty signal. Scoring it would reward worse behaviour.
- **Parameters fixed now:** eligibility ≤60% (CI upper ≤70%);
  NI margin δ = 0.10 on rate criteria and **0.5 points** on the judge's 1–5
  "understandable" axis; guard criteria are pooled over **all 8 tasks** (a
  treatment that damages only the ceiling controls must not be invisible), while
  the *primary endpoint* is pooled over the 6 hard tasks only;
  cost margin +5% tested by the same cluster bootstrap on the difference of
  means; primary threshold +20pp; **battery = 8 tasks** (6 hard-class tasks + 2
  ceiling controls); **N = 10** for both flash stages (the shakeout too, so the
  eligibility CI is computed at the same N that the endpoint is), N = 3 for opus
  confirmation. **Per-stage timeouts:** flash 900 s, opus 3600 s. **Minimum
  valid-N floor:** a cell with <80% valid runs is re-run once, and a cell still
  under the floor invalidates the stage rather than silently under-powering it —
  timeouts preferentially kill the *longest* answers, which would inflate the
  control's tell-rates and deflate its token mean, biasing the cost guard in the
  treatment's favour. N was raised from 5 because noise, not cost, is the binding
  constraint: at $0.08/run the extra runs cost ~$10 total and shrink the
  difference SE by √2, which directly buys back the power criterion 2 needs.
  **Bootstrap is fully specified:** paired by task (all arms share the same
  tasks), resampled at the task-cluster level, 10 000 resamples, BCa intervals,
  invalid runs dropped before resampling. The primary endpoint is pooled over the **6
  hard-class tasks only** — the ceiling controls sit at ~100% and would cap the
  pooled delta. Controls are used solely for the headroom-specificity check. If
  both B and C win, the **scoped** arm (C) is adopted — narrower rule, same
  result, pre-registered tie-break.

### Staging and preconditions

- **Flash is the verdict model; opus only confirms a win.** `run.sh` is strictly
  sequential, so the originally-planned 3 arms × 8 tasks × N = 5 on opus is ~120
  serialized runs at 25–40 min each — 2.5–5.5 days wall clock. That is not a
  plan that finishes. Staging instead:
  0. **Judge validation first — 8 calls, before any arm runs.** Sequencing it
     here is forced by the rule: with the gate closed the verdict is null-only,
     so running 240 flash runs and up to 54 opus runs *first* would spend the
     entire budget on an outcome that cannot adopt. If the gate cannot be opened
     on a healthy host, **stop and record a null there** — 8 cheap calls is the
     cheapest exit in the whole plan, and "fail cheap" requires it to come first.
  1. **Control-only shakeout + endpoint fixing** on flash, arm A, N = 10. Apply
     the ABORT rule here. Second-cheapest exit.
  2. **Full verdict on flash**, all 3 arms, N = 10 (~240 runs at ~$0.08 — ~$20,
     and ~12 h sequential at an idle-host rate of ~3 min/run). The shakeout's
     control runs are **not** reused; the verdict stage re-runs arm A so every
     arm is measured under identical conditions.
  3. **Opus confirmation only if flash produces a win** *and the judge gate is
     open* — a regex-only flash win cannot become an adopt, so spending 22–36 h of
     sequential opus on it would be pure waste., and only on the primary
     tell: 3 arms × 6 hard tasks × N = 3, paired by task. **Replication is
     pre-registered now**, because this is the final and most expensive gate and
     leaving it to post-hoc judgment would reintroduce exactly the leak the
     endpoint-priority order eliminates:
     > *Replication holds iff the primary-tell delta on opus is **positive and
     > ≥ +10pp**.*
     Deliberately **no CI-exclusion requirement** here. At K = 6 task clusters a
     bootstrap CI on the difference has a half-width of roughly ±25–35pp, so
     demanding significance would reject a genuine +20pp replication most of the
     time — a null-after-win by construction. Opus's job is to confirm direction
     and rough magnitude on the model the human reads, not to re-run the
     inference that flash already powered.
  Battery size, N, and staging are fixed **now**, before any data — shrinking the
  battery after seeing control rates would be a researcher degree of freedom.
- **Idle-host precondition (hard), with a measurable threshold.** "Healthy" is
  defined, not asserted: **swap used < 4 GB and 1-minute load average < 4**,
  sampled immediately before a stage starts. This gates **every** stage — the
  flash stages included, since the ~12 h estimate assumes ~3 min/run and the
  degraded host measured ~20–25 min/run for flash. The prior run measured 25–40 min
  runs and repeated 600 s judge timeouts at 17/18 GB swap. If the host does not
  reach the threshold, the change **blocks and says so** rather than silently
  degrading to a regex-only verdict.
- **Judge hard-gate retained, with a registered path to open it.** Validation
  standard fixed now: **8 hand-labeled transcripts**, labeled by the human before
  the judge sees them, agreement counted as within ±1 on the 1–5 scale for **≥6
  of 8**. `JUDGE_TIMEOUT` is raised from its 420 s default (measured calls
  exceeded 600 s). If the gate opens, criterion 5 applies. If it never opens, the
  verdict is regex-only and can support a **null only** — never an adopt, because
  `results.md` established that regex adherence cannot detect an answer that
  matches every pattern and still buries the point.

### Harness work this change must do (not "consumes only")

- `analyze.mjs` has **no implementation of the amended rule**: it reports
  non-inferiority per task×check cell and nothing aggregates per-tell across
  tasks or computes "strictly up". Add per-tell aggregation, bootstrap CIs, and a
  single explicit rule verdict. Without this, the existing cell table could be
  mistaken for the verdict.
- `run.sh` hardcodes `require("./arms.json")` with no override. Add an
  **`ARMS_FILE`** env var. The prior change clobbered `arms.json` and restored
  it, which mis-restored once; a second experiment must not repeat that.
- `run.sh` defaults `TIMEOUT=900` against measured ~40 min opus runs — every
  opus confirmation run would be killed. Set the timeout explicitly per stage,
  **and capture `timeout`'s exit code 124**, which `run.sh` currently discards.
  A killed run leaves a truncated transcript that still contains some assistant
  text, so `extract.mjs`'s zero-text guard does not catch it and the truncation
  would silently score the tells. The same applies to a **mid-run provider error
  leaving partial text** — neither timeout nor empty — so invalidity must be
  recorded by the runner, not inferred from the transcript alone.
- Already landed by the prior change and merely consumed here: the invalid-run
  guard in `extract.mjs`, invalid-run exclusion from efficiency means and `na`
  for empty cells in `analyze.mjs`, and `OUT`/`TASKS_FILE` in `run.sh`.
- **BREAKING: none.** No product code, no runtime behaviour, no public API.

## Capabilities

### New Capabilities

None. This is a measurement/tooling change: it adds an experiment battery, the
harness support to score it, and runs it. No dashboard behaviour changes.

### Modified Capabilities

None. `skip_specs: true` is set in `.openspec.yaml`, matching the precedent set
by `ab-test-plain-language-rule`.

## Impact

- `scripts/ab-context/` — new battery file, new arms map, and **real harness
  changes** (`analyze.mjs` rule evaluation, `run.sh` `ARMS_FILE` + timeout
  handling). Run outputs are gitignored.
- Root `AGENTS.md` — **only if an arm wins** under the full four-part rule. A
  null or negative result changes nothing and must not be rationalised away.
- Three git worktrees under `.worktrees/`, deleted at cleanup.
- **Cost/runtime.** Flash carries the verdict precisely because opus at this
  scale does not finish: ~120 flash runs at ~$0.08 is ~$10 and hours, versus
  ~$62 and multiple days on opus. Opus is spent only to confirm a win that
  already exists (≤54 runs), so the expensive model is never paid for a null.
  The ABORT rule exits before the treatment half if the battery created no
  headroom at all.
- No CI, no dependencies, no user-facing surface.

## Recorded Residual Risks

Surfaced by adversarial review and accepted rather than fixed — recorded so the
verdict is read with them in view:

- **Cluster bootstrap at K = 6 is marginal.** Standard guidance wants ≥20
  clusters; percentile intervals undercover at this size. Mitigated by pairing
  and BCa, not eliminated. This is why opus replication uses a directional
  threshold rather than a CI test.
- **A flash null is weaker evidence than an opus null.** The construct of
  interest is readability of the output the human reads (opus). Flash carries the
  verdict for tractability, and instruction-following differs by model, so
  "no effect on flash" does not establish "no effect on opus". The direction is
  conservative — it can only under-claim — but a flash null should be reported as
  *"no effect detected on flash"*, never as *"the rule does not work"*.
- **Judge validation at ≥6 of 8 within ±1 is a weak bar.** On a 1–5 scale, ±1
  spans 3 of 5 points, so chance agreement is already ~60%. The realistic
  expected case on this host is that the gate never opens and the verdict is
  regex-only — which by rule means null-only.
- **`answer_first` anchors for open-ended prompts are author-written.** They are
  arm-neutral (the same model runs every arm; only Rule 5 differs), so authorship
  bias largely cancels. Residual risk remains if a treatment rule systematically
  re-frames answers outside the anchor list.

## Discipline Skills

- **`doubt-driven-review`** — on this proposal and on `design.md` before any arm
  runs, and again on the final verdict before any root `AGENTS.md` edit. The
  prior change's verdict was wrong on first writing; an adversarial pass is the
  control that caught it.
- **`review-code`** — on the battery file and on every harness change *before* a
  number derived from them is trusted. In the prior change this is what caught
  `analyze.mjs` averaging over invalid runs and inverting arm B's token delta
  from −0.3% to +24.6%. This change modifies `analyze.mjs` again, so the same
  exposure applies.
- **`scenario-design`** — supplies `test-plan.md`; its automated rows drive the
  verification tasks.
- **`systematic-debugging`** — if a run produces zero assistant text, a truncated
  transcript, or a provider error mid-experiment (the `google/*` 404 class),
  root-cause it before re-running rather than retrying blind.
