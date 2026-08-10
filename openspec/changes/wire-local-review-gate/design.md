## Context

`ship-it` goes `harness green → ship-change`. The first entity that reads a diff
semantically is CodeRabbit, ~5 min after push, on a metered quota, at the point
where acting on a finding costs a force-push cycle. `review-code` already exists
and its own doctrine names the inner loop as its home — it is simply never
invoked.

Separately, three enforcers are written and wired to nothing: `i18n-lint.mjs`
and `i18n-parity.mjs` (npm script only), and `split-large-agents.mjs` (no caller
at all — the 30 KB `AGENTS_BYTE_CAP` it exists to fix is breached twice today).

Current gate surface: `quality:changed` = `biome check --changed
--error-on-warnings --write && tsc --noEmit && npm test`. That oracle is
syntactic + behavioural. It has no semantic reviewer and no repo-convention
checker.

Grounding constraint (from the proposal): the strongest known defect class is a
cross-package coupling enforced only by a code comment —
`packages/server/src/session/replay-compaction.ts:43` mirrors
`packages/client/src/lib/chat/event-reducer.ts`. No linter, SAST, or AST engine
reads that. A reviewer holding **diff + intent** does. This is why the gate is a
model, not a rule engine.

Answers settled with the user during artifact creation:

| Question | Decision |
|---|---|
| Discipline-Skills check gating? | **Gating**, and the `openspec-discipline-wiring` spec is modified **in this change** |
| Triviality escape for step 4.5? | **None** — every `ship-it` run is reviewed |
| Reviewer bound | **Hard numeric cap — review → fix → re-review, never a third round** |
| Reviewer engine | **`@review` role alias, REQUIRED** — unconfigured is a hard failure |

The gating decision reverses a proposal Non-Goal and an Open Question. It is
recorded here as an explicit, deliberate spec modification — not smuggled.

**A doubt-driven-review cycle (single-model + cross-model on `@propose-review-1`
/ `zai/glm-5.2`) overturned the last two rows and corrected the proposal's
factual base.** The findings that changed the design:

| Finding | Consequence |
|---|---|
| The step-4 bound stops only on a **no-change** cycle; a model can emit a fresh finding every round, so every cycle registers as progress and the bound never fires | D4 rewritten — hard numeric cap |
| No timeout on the reviewer call → a stalled provider hangs a headless run | D10 added |
| `kb dox lint` **already** implements `AGENTS_BYTE_CAP = 30000` | D8 rewritten — wire it, write nothing |
| `quality:changed` has **no** CI / `ship-it` / `ship-change` caller | D11 added — enforcers gate in `ship-it` |
| `i18n-parity.mjs` **exits 1 today** (stale path after a client reorg) | Repair precedes wiring |
| `i18n-lint.mjs` is advisory unless `--strict` | Wiring must pass `--strict` |
| Every enumerated count was wrong (41 scripts not 14; cap breached once not twice; 34/74 not 35/63; hex paths stale) | Counts re-derived; D6 detectors pinned |

## Goals / Non-Goals

**Goals:**

- A semantic review runs **before push**, fed the diff *and* the change's intent.
- A blocking finding re-enters an **existing** loop and an **existing** escape
  hatch, under a **bound that provably terminates with a model in the loop**.
- Owned-but-unplugged enforcers (`i18n:lint`, `i18n:parity`, `kb dox lint`) are
  **repaired where broken** and then wired somewhere that actually runs.
- Mechanically-checkable AGENTS.md conventions get one small enforcer script that
  follows the repo's established `scripts/*.mjs` pattern.
- A halt is **legible**: a headless run that stops for review reasons says why in
  a durable artifact.

**Non-Goals:**

- Replacing CodeRabbit — it stays the PR gate, demoted from primary reviewer to
  backstop.
- Running the CodeRabbit CLI locally.
- Adding ast-grep or any new rule engine (evaluated, rejected, recorded below).
- Backfilling the 34 proposals currently missing `## Discipline Skills`.
- Clearing the wider `kb dox lint` backlog (59 issues across 5 kinds). Only the
  byte-cap arm is gated here; see D8.
- Growing `check-conventions.mjs` beyond its four rules.

## Decisions

### D1 — The reviewer is a REQUIRED role-aliased model, spawned as a subagent

`review-code` is engine-agnostic by design and explicitly forbids the inner loop
spending the cloud quota the PR gate needs. The gate resolves the **`@review`**
role and spawns an **isolated subagent** on it via the `Agent` tool — the same
mechanism `doubt-driven-review` uses for `@propose-review-N`, and the only path
that resolves a role ref through the parent's live registry.

**`@review` is required. An unconfigured role is a hard failure**, not a
fallback. The original design fell back to the session default model; the review
showed why that is hollow: `@review` is configured on no machine today, so the
fallback would be the *only* path — and the fallback model **is the author
model**, making the checkpoint self-review wearing a reviewer's hat. A gate whose
default behaviour is self-review is decoration. Hard-failing surfaces the missing
configuration once, loudly, instead of degrading every run silently forever.

The error MUST name the fix (`update_roles` / dashboard Roles panel) and suggest
seeding `@review` from an existing `@propose-review-N` entry.

**Required must not mean broken-on-arrival.** Round 2 caught that no task seeded
the role anywhere, so every existing user's first `ship-it` after this change
would hard-fail on a role they have never heard of. The change therefore also
ships an onboarding path: `@review` is documented in setup, and the first
hard-fail emits a bootstrap prompt offering to assign the role interactively (the
same `list_models` → `ask_user` → `update_roles` flow `doubt-driven-review` uses
to bootstrap `@propose-review-N`). In a non-interactive run the hard fail stands,
with the error naming the command.

The prompt fires on **every interactive hard-fail**, with no persisted
"already-asked" state. Persistence would buy nothing: accepting the prompt
configures the role, which removes the hard-fail that triggers it, so the prompt
is self-extinguishing. It recurs only while the user keeps declining — which is
the correct behaviour, not a nag.

**Invocation is pinned, not implied.** "Invoke `review-code`" alone would mean
the *current agent* runs the procedure in its own context — self-review again,
with no role resolution anywhere. The contract is: an `Agent` spawn, `model:
"@review"`, carrying `review-code`'s rubric as its prompt.

*Alternatives:* CodeRabbit CLI locally (rejected — burns the PR gate's quota,
contradicts `review-code`); fall back to the session default (rejected — becomes
the only path, and equals self-review); reuse `@propose-review-N` directly
(rejected — that series is doubt-review's planning-phase reviewer; a distinct
`@review` lets the two be tuned independently, at the cost of one more role to
seed).

### D2 — Step 4.5 sits between the harness gate and `ship-change`

Placement is forced: the reviewer must read the **integrated, green** tree. Step
2.5 merges `origin/develop`, step 3 proves the merged tree green. Reviewing
earlier reviews a tree that does not ship; reviewing later means reviewing after
push, which is what CodeRabbit already does.

### D3 — No triviality escape

`review-code` excludes one-line/mechanical changes as overhead > benefit, but any
cheap triviality test (diff size, touched paths) is a **heuristic that can be
gamed by exactly the diff you most want reviewed** — a one-line change to
`replay-compaction.ts` is the motivating defect class. Uniform review is
predictable, headless-safe, and needs no threshold to tune. Cost accepted: every
`ship-it` run gets one model call slower.

*Alternative:* diff-size threshold (rejected — the motivating defect is small).

### D4 — Severity routing under a HARD NUMERIC CAP of two review rounds

`issue(blocking)` findings become work items in `ship-it`'s existing step-4 fix
loop. Every other severity (`suggestion`, `nit`, `praise`, `question`) is
reported and does not block.

**The review is bounded by an explicit count, not by step 4's progress rule:**

1. **Round 1** — review the diff. No blocking findings → proceed to `ship-change`.
2. **Fix** — blocking findings re-enter the step-4 fix loop.
3. **Round 2** — re-review the updated diff. Clean → proceed.
4. **Still blocking after round 2 → STOP.** Escape hatch, `SHIP_IT_BLOCKED.md`.
   **There is never a third round.**

This reverses the original decision to share step 4's bound. The doubt-review
showed that bound is **unsound with a model in the loop**: step 4 terminates only
on a cycle that produces *no worktree change* — a valid stop condition for a
deterministic oracle (a test goes green and stays green), but not for a
stochastic one. A reviewer can emit a *fresh* blocking finding every round, or
re-raise the same one reworded, and each resulting fix changes the worktree, so
every cycle registers as "progress" and the no-progress rule never fires. The run
would loop indefinitely, re-running the docker harness each time. A fixed count
is the only bound a non-deterministic reviewer cannot defeat.

Step 4's progress bound still governs **red tests**, unchanged. The two bounds
coexist; whichever trips first escalates to the same step-5 escape hatch.

**`assertNoWeakening` still applies to every test edit — with one escalation
valve.** A *correct* blocking finding can legitimately be "this test asserts the
wrong behaviour", whose only honest fix is deleting or rewriting the assertion —
exactly what `assertNoWeakening` rejects. That is an unsatisfiable finding, and
looping on it is the failure mode this decision exists to prevent. Resolution:
the guardrail is **never** relaxed automatically; the conflict is treated as a
design issue and routed to the escape hatch, naming both the finding and the
guardrail that blocks it, so a human adjudicates.

### D5 — A review-driven halt writes `SHIP_IT_BLOCKED.md`

Reusing step 5 verbatim. The file names the blocking findings and what was
attempted. This is the observability requirement: an unattended run that stops
for a non-test reason must leave a human-findable reason. No new artifact, no new
exit path.

### D6 — One script, four rules, each with a PINNED detector

Every count is a function of its detector, so the **detector**, not the count, is
the specification. All figures measured on this branch and MUST be re-derived at
implementation time.

| Rule | Detector | Today | Posture |
|---|---|---|---|
| Mermaid, not ASCII box-drawing | Box-drawing char **inside a fenced block**, **excluding** directory-tree rows (`├──` / `└──` / leading `│`) | **4** | gating |
| Browser scenarios are Playwright specs | A `qa/tests/*.sh` driving **rendered browser UI**. WS/HTTP/health assertions and display-server launches are NOT violations | **0** | gating (regression guard) |
| Root `AGENTS.md` has no per-file index | A markdown table of file-purpose **rows** in the root file. A prose section that merely names Key Files and points elsewhere is compliant | clean | gating (regression guard) |
| Proposals carry `## Discipline Skills` | Heading present in a **touched** `proposal.md` (D7) | **34/74** missing | **gating** (D7) |

The first two detectors were the review's sharpest catch. A naive "any
box-drawing character" rule flags 7 files — including `README.md` and
`docs/electron-session.md`, whose `├──` rows are legitimate **directory trees**,
not diagrams. Under the narrow detector the count is exactly 4. Likewise the
proposal originally asserted 3 shell browser tests; there are **0** — the three
suspicious files assert WebSocket and API behaviour, and their per-OS VM home is
exactly what a move to Playwright would destroy. Shipping that rule on its
original false premise would have mandated three actively harmful migrations.

The root-index detector must likewise not flag the *current* root `AGENTS.md`,
whose `## Key Files` section contains only a pointer.

Four rules is the ceiling. Growth pressure on this script is a signal to write a
different script, not to add a framework.

### D7 — The Discipline-Skills rule becomes gating, and the spec is modified here

A 56% violation rate is evidence the advisory convention does not work. Making
the check gating **contradicts** `openspec-discipline-wiring`'s requirement *"The
convention is advisory, not gating."* Per the user decision, that requirement is
modified in this change rather than deferred, so the spec and the enforcer never
disagree.

Scoping guard, to keep the blast radius honest: the rule gates **proposals
touched by the current change**, not the 74-proposal backlog. Backfilling the 34
existing offenders remains a Non-Goal, so the gate must not fail a run for a file
that run did not author.

**"Touched" must be defined precisely, or the guard is decorative.** The review
found two ways a loose definition re-admits the whole backlog:

1. **Diff base.** The check SHALL diff against **`origin/develop`** — the same
   remote ref `ship-it` step 2.5 merges. Using local `develop` (which is what
   `biome --changed` uses, per `biome.json`'s `defaultBranch`) would drift
   whenever the local branch lags, producing a different touched-set than the
   tree the reviewer sees.
2. **Renames are not authorship.** A move shows up as a diff entry, so a naive
   "touched" test would fail the gate on a proposal the change merely relocated
   — converting the Non-Goal into mandatory backfill. The check SHALL therefore
   ignore **pure renames** (`--diff-filter=R` with no content change) and gate
   only added (`A`) or content-modified (`M`) proposals.

   *Correction from round 2:* the original rationale cited `ship-change`'s
   archival move as the triggering case. That is temporally wrong — archival runs
   at step 6+, well after the 4.4 gate, so it can never trip this check. The
   guard is still required, but for author-initiated moves (reorganising or
   renaming a change directory within a single run), not for archival.

**Invocation contract.** `ship-it` SHALL invoke the check with an explicit base:
`node scripts/check-conventions.mjs --base origin/develop`. Without `--base`,
there is no touched set, so the Discipline-Skills rule reports without gating
while the other three tree-absolute rules run normally. The mode is selected by
the flag, never inferred.

### D8 — Gate the byte arm of `kb dox lint`; write no new cap checker

`packages/kb/src/dox.ts:58` already defines `AGENTS_BYTE_CAP = 30000`, and
`doxLint` already emits an `over-threshold` issue with `arm: "bytes"` for every
file over it. The root `AGENTS.md` documents this. **The enforcer exists; it is
simply unwired** — precisely the class of problem this change is about.

The original design proposed a `--check` mode on `scripts/split-large-agents.mjs`.
The doubt-review caught that this violates this design's own DRY rule ("No second
script SHALL recompute the cap") and that its justification was false:
`split-large-agents.mjs` computes a **per-row character** cap
(`INLINE_CAP = 200`), not a **per-file byte** cap. `--check` would have been
net-new logic grafted onto a row-splitter, duplicating a correct implementation
30 lines away — the same drift that left `i18n-parity.mjs` broken.

`split-large-agents.mjs` is therefore **untouched** by this change. It remains the
`--write` remediation tool for a violation `kb dox lint` reports.

**But `kb dox lint` cannot be wired as-is.** Round 2 of the doubt-review caught
the over-correction: `packages/kb/src/cli.ts:173` exits 1 when **any** issue is
present, across all seven kinds (`stale`, `orphan`, `missing`,
`missing-companion`, `broken-pointer`, `broken-ref`, `over-threshold`), and there
is no `--only` / `--kind` filter. Measured on this branch, `kb dox lint` reports
**59** issues: 30 `missing`, 19 `missing-companion`, 5 `over-threshold`, 4
`broken-ref`, 1 `orphan`. Exactly **one** is the byte-cap breach this change is
about. Wiring the command directly would adopt a 59-issue backlog as a blocking
gate and could never land green.

The gate therefore consumes **`kb dox lint --json`** and fails only on
`over-threshold` issues with `arm: "bytes"`. This still writes no cap logic — the
threshold, the walk, and the classification all remain `dox.ts`'s — so D8's DRY
rule holds: the wrapper *filters* an existing verdict, it does not *recompute*
one.

*Deferred, better:* add a first-class `--gate <kind>[:<arm>]` flag to `kb dox
lint` so the filter lives with the linter rather than in a caller. Out of scope
here because it widens the change into a published package for ergonomics only.

*Alternative:* clear all 59 issues so the unfiltered command can gate (rejected —
an unbounded backfill wearing this change's name).

### D12 — The review bound is a pure decision helper, not prose

`ship-it`'s existing pure decision logic lives in
**`.pi/skills/ship-it/scripts/`** — `manifest.ts` (`parseManifest`,
`deferDecision`, `filesystemRealityCheck`) and `no-weakening.ts`
(`assertNoWeakening`). The skill consults them; it does not re-implement their
rules in prose.

*Two corrections found while implementing, both worth recording because they are
the change's own pathology:*

1. The path is **skill-relative**, not repo-root `scripts/`. The earlier draft of
   this decision copied `scripts/manifest.ts` verbatim from `ship-it`'s own
   preamble, which states it that way — the same stale-path error class as
   `i18n-parity.mjs`, inherited from a doc rather than from the tree.
2. Those helpers are **not unit-tested**. `vitest.config.ts` lists only
   `packages/*` and `scripts/` as projects, so nothing under `.pi/skills/` is
   ever collected. Zero tests reference `assertNoWeakening`, `parseManifest`,
   `deferDecision`, or `filesystemRealityCheck` — including the no-weakening
   guardrail that `ship-it` step 4 relies on every cycle.

So the precedent is real in *placement* but hollow in *coverage*: three decision
helpers exist that gate nothing verifiable — precisely the pathology this change
exists to fix, one directory further in.

The two-round cap SHALL therefore be a pure
`reviewRoundDecision(state) → review | fix | escape` helper in
**`.pi/skills/ship-it/scripts/`**, beside its siblings, **and
`.pi/skills/ship-it` SHALL be added to `vitest.config.ts`'s project list** so the
helper's tests actually execute. That wiring retro-covers `manifest.ts` and
`no-weakening.ts` as well.

*Alternative:* place the helper in repo-root `scripts/` because that dir is
already a vitest project (rejected — splits `ship-it`'s decision logic across two
directories to dodge a one-line config fix, and leaves the existing two helpers
uncovered). Scenario design surfaced why this is not optional — the cap is the
headline safety property of this change (it is what makes a model-in-the-loop
`ship-it` terminate), and expressed only as Markdown it is **unverifiable by any
test**. A guarantee that cannot fail a test is a guarantee that will silently
rot, exactly as `i18n-parity.mjs` did.

*Alternative:* leave the cap as skill prose (rejected — makes E1–E3 and X6
`manual-only` and ships the change's central invariant untested).

### D10 — The reviewer call is deadline-bounded

A bounded number of rounds does not bound *wall-clock* time: one unreachable or
stalled provider hangs a headless `ship-it` indefinitely. The checkpoint SHALL
apply a timeout of **300 seconds** to each reviewer invocation — comfortably
above a real review of a real diff, far below a hung-provider stall. A timeout is **not** a blocking
finding and **not** a silent pass — it is reported as a checkpoint failure and
resolved like the unconfigured-role case (D1), so a headless run terminates with
a legible reason rather than hanging.

### D11 — The enforcers gate in `ship-it` (step 4.4), not in `quality:changed`

`quality:changed` has **no automated caller**: not `.github/workflows/`, not
`ship-it`, not `ship-change` — only the `code-quality` skill's interactive dev
loop. Wiring "gating" checks there would have produced a gate that gates nothing,
while the original design claimed the checks become "enforced rather than
manual".

The enforcers therefore run as **`ship-it` step 4.4**, immediately before the
semantic review (4.5): deterministic checks first, cheapest failure first, and no
model call spent on a tree that already fails a mechanical rule.

Ordering within `ship-it`: `3. harness green` → `4.4 enforcers` → `4.5 review`
→ `6. ship-change`. A 4.4 failure routes to the step-4 fix loop like any other
red gate.

*Alternative:* also wire into CI (deferred — `ship-it` is the path every change
takes, and CI duplication can follow once the checks have proven stable).

### D9 — ast-grep evaluated and rejected (recorded so it is not re-litigated)

Measured against this repo: every code-shaped convention is either already obeyed
(0 real `client → server` imports — the 4 matches are comments) or legitimately
"violated" by design: of **678** raw hex literals in the client, **451 (66%)**
live in `lib/theme/themes.ts` (378), `index.css` (47), and
`lib/theme/monaco-theme.ts` (26) — the token-definition files where hex belongs.
The rules that *are* violated are markdown- and filesystem-shaped, which an AST
engine cannot read. A new dependency buying zero true positives is not bought.

These figures were re-derived during doubt-review: the original cited 604/447 at
`lib/themes.ts` and `lib/monaco-theme.ts`, paths that **no longer exist** (the
client reorg moved them under `lib/theme/`). The ratio, and therefore the
conclusion, survived re-derivation; the paths did not.

## Risks / Trade-offs

- **A false `issue(blocking)` stalls an unattended run.** → Bounded by the D4
  two-round cap (not by step 4's progress rule, which a stochastic reviewer
  defeats) and terminated by step 5's escape hatch; the halt is legible in
  `SHIP_IT_BLOCKED.md`. This is the change's primary risk, accepted explicitly.
- **Every `ship-it` run is slower** (D3, no triviality escape). → Accepted; one
  model call against a bounded diff, versus a ~5-minute CodeRabbit round trip
  paid after a push.
- **Two review rounds may be too few** for a change with genuinely layered
  defects. → Accepted: the remaining findings are reported in
  `SHIP_IT_BLOCKED.md` and CodeRabbit still backstops at the PR. A bound a
  reviewer cannot defeat is worth more than a bound tuned for the rare case.
- **`@review` unconfigured hard-fails `ship-it`** on a fresh machine (D1). →
  Accepted deliberately over the silent-self-review alternative; the error names
  the one-command fix and it is a one-time setup cost.
- **Gating the Discipline-Skills rule can fail runs on untouched legacy
  proposals.** → Mitigated by D7's scoping guard: only proposals the change
  touches are gated.
- **The reviewer weakens a test to clear its own finding.** → `assertNoWeakening`
  runs unchanged on every test-file diff in the fix loop.
- **A *correct* finding is unsatisfiable under `assertNoWeakening`** ("this test
  asserts the wrong behaviour"). → Routed to the escape hatch naming both the
  finding and the blocking guardrail, for human adjudication (D4). Never
  auto-relaxed.
- **A stalled provider hangs a headless run.** → Deadline per reviewer call
  (D10); a timeout terminates the checkpoint with a legible reason.
- **The wired enforcers are themselves broken or stale.** `i18n-parity.mjs` exits
  1 today; this proposal's own ast-grep evidence cited paths deleted by a client
  reorg. → Repair precedes wiring, and every count is re-derived at
  implementation time rather than quoted.
- **Newly-wired enforcers red-flag pre-existing violations** — measured on this
  branch: **4** ASCII diagrams, **1** over-cap `AGENTS.md`, **0** shell browser
  tests, and (if gated unfiltered) **59** `kb dox lint` issues. → The first two
  are cleared in this change; the shell rule needs no work; the dox backlog is
  excluded by gating only the byte arm (D8). Wire a check and clear its
  violations in the same change, or the gate lands permanently red.

## Migration Plan

1. **Repair before wiring.** Fix **both** of `i18n-parity.mjs`'s stale paths — it
   reads `lib/i18n.tsx` **and** `lib/i18n-hu.ts`, both of which moved under
   `lib/i18n/` — so it exits 0; confirm `i18n-lint.mjs --strict` is clean or
   clear its hits.
2. **Clear the mechanical violations** the new rules will flag: the 4 ASCII
   diagrams, the 1 over-cap `AGENTS.md`. (No shell-browser migrations — there are
   0 real violations.)
3. **Land `check-conventions.mjs`** with its four pinned detectors, verified both
   to flag the real violations and to leave the legitimate directory-tree files
   and the current root `AGENTS.md` alone.
4. **Wire step 4.4** into `ship-it`: `check-conventions.mjs --base
   origin/develop`, the byte-arm dox gate, `i18n:lint --strict`, `i18n:parity`.
5. **Seed `@review`** in setup docs + the one-time bootstrap prompt (D1), so the
   required role has an onboarding path before it is enforced.
5. **Add step 4.5** with the D1 engine contract, the D4 two-round cap, and the
   D10 deadline; update `ship-it`'s guardrails and composed-skills list.
6. **Modify `openspec-discipline-wiring`** — both the "advisory, not gating"
   requirement and its "omit when none apply" sibling (D7).

Rollback: each wiring point is a discrete skill/script edit, individually
revertible. Reverting steps 4.4 + 4.5 restores the current
`harness green → ship-change` path exactly.

## Open Questions

None blocking. The proposal's four open questions were settled with the user, and
a doubt-review cycle reversed two of those answers on evidence (see the Context
table and D4/D1).

Deliberately deferred:

- Backfilling the 34 proposals missing `## Discipline Skills` — out of scope,
  covered by D7's touched-files scoping.
- Wiring the enforcers into CI as well as `ship-it` (D11) — revisit once the
  checks have proven stable on the `ship-it` path.
- A first-class `--gate <kind>[:<arm>]` flag on `kb dox lint` (D8), replacing this
  change's JSON-filtering wrapper.
- The remaining 58 `kb dox lint` issues (30 `missing`, 19 `missing-companion`, 4
  `broken-ref`, 1 `orphan`, 4 non-byte `over-threshold`). Gating them is
  desirable and out of scope here.
- **The red-test fix loop has the same non-termination shape as the review loop
  did.** Round 2 observed that the fix author is the same non-deterministic model
  on both paths, so a wrong-but-worktree-changing fix can also register as
  "progress" indefinitely. This change bounds the *review* path because that is
  the path it introduces; hardening step 4's own bound is a separate change and is
  named here so the asymmetry is deliberate, not overlooked.
- The client reorg left stale path references in at least two unwired consumers
  (`i18n-parity.mjs`, this proposal's own ast-grep figures). A repo-wide sweep for
  other stale `lib/i18n.tsx` / `lib/themes.ts` references is **not** in scope here
  and warrants its own change.
