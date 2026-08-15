# Reference classes — calibrated hours per UCP

Reference-class forecasting is the largest single accuracy win available in software
estimation: anchor the new estimate on the outcomes of similar completed projects
instead of on the inside view of the new one.

**Never quote from Karner's 20 h/UCP when a reference class exists.** Pick the closest
class below, or add a new row after every completed project.

| Class | Stack / context | Scope | UCP | Actual effort | **h/UCP** | Model error at 20 h/UCP |
|---|---|---|---|---|---:|---:|
| `wms-reference` | Low-code Java (Judo) + React + Flutter, robotics + ERP integration, greenfield, experienced team | 24 use cases, 6 actors, 5 build modules | 267.4 | 479 MD (3,832 h) base, all roles, before 15% contingency | **12.97** | +54% |

## How to read this

The WMS row says: for **this class of work** — a low-code backend, an experienced team,
a greenfield integration-heavy system — the team delivers a use case point in about
**13 hours**, not Karner's 20. Using the textbook constant would have over-quoted the
project by more than half.

That is not a defect in UCP. It is the whole point: UCP measures *size*, and size only
becomes effort through a productivity constant that belongs to a specific team,
stack and domain. The constant is the thing you must own.

## Adding a class after a project completes

1. Write the delivered scope as an estimator input (use cases + actors + factors),
   describing what was **actually built**, not what was originally quoted.
2. Decide what the actual hours cover. Include the same roles the model distributes
   (dev, QA, PM, design, deployment) or the comparison is meaningless.
3. Run:
   ```
   node scripts/calibrate.ts <input.yaml> --actual-days <N> --exclude-contingency
   ```
4. Add a row here with the implied h/UCP and a one-line description of the class.
5. Set `calibration.hours_per_ucp` on the next estimate of that class.

## Expected spread

Published practice puts h/UCP between 15 and 30, with Karner's original at 20.
Values below ~13 usually mean a high-leverage stack (low-code, heavy framework reuse,
open-source components dropped in as configuration rather than build). Values above ~30
usually mean regulated work, a hostile legacy environment, or scope counted too coarsely.

Anything outside 10–45 is more likely a scope-mismatch between the model input and the
actual hours than a real productivity signal. Check before adopting it.

## Measured from session telemetry

Produced by `scripts/calibrate-sessions.ts` over the local pi session store.
This is measurement, not literature — it beats every published constant for this team.

**Sample:** 542 substantive sessions · 737.5 active steering hours (92.2 steering-days) · $7,676 billed.
**Method:** sum inter-record gaps, capping any gap over 15 minutes (a gap is a break, not work).

| Parameter | Model default before | **Measured** | Verdict |
|---|---:|---:|---|
| Cost per active steering hour | — | **$10.41** | new; the most robust agent-cost driver |
| Cost per steering day (8 h) | — | **$83.27** | ~17% of an SME human day rate |
| ACEM Context Factor | 1.25 | **5.10** | default understated **4.1×** |
| ACEM Revision Factor | 1.40 | **1.05** (lower bound) | default overstated; floor held at 1.25 |
| Output share of tokens | 25% | **0.38%** | default overstated **66×** |
| Cache-read share of tokens | — | **95.5%** | this is where the money actually goes |
| Tool error rate | — | 0.9% | |
| Human correction rate | — | 3.7% of human turns | |
| Assistant turns per human turn | — | **12.9 : 1** | the real leverage ratio |
| Tool calls per steering hour | — | 90.1 | |
| Output tokens per steering hour | — | 48,692 | |

### What these findings actually mean

**Context re-reading is the agentic cost structure, not generation.** 95.5% of all tokens
billed were cache reads. Modelling agentic cost as a 25/75 output/input split — as generic
token-cost guidance does — prices the wrong thing by two orders of magnitude. ACEM is right
to give the Context Factor its own term; it is simply much larger than the illustrative value.

**The Context Factor is real and measurable.** Long sessions (≥60 assistant turns) re-read
5.1× more context per turn than short ones (≤20). Long agent runs get progressively more
expensive per unit of work — which is an argument for scoping agent tasks tightly, and a cost
line that a naive per-task estimate misses entirely.

**Prefer the measured rate over the ACEM reconstruction.** `$10.41/agent-hour` already
contains every retry, revision and context effect. Reconstructing the same number from
RF × CF × token price compounds three uncertain constants to reach a figure you can simply
measure. The engine uses the measured rate when `ai.cost_per_steering_hour` is set, and falls
back to ACEM only when it is not.

**The Revision Factor here is a lower bound.** It counts tool errors and explicit human
corrections. It cannot see tokens the agent silently redid on its own, so the true value is
higher. The default is held at 1.25, above the 1.05 measured floor.

### Method validation

The same measurement re-run on the project that produced the original steering figures returns
424 h against the 465 h recorded earlier — same order, different snapshot date and gap policy.
The method reproduces its own prior result, which is the minimum bar for trusting it.

### Solving the overhead multiplier

This is the highest-value use of the tool. Given a project's delivered man-days:

```
node scripts/calibrate-sessions.ts --project <substr> --actual-days <N>
```

```
overhead multiplier = delivered man-days ÷ measured steering-days
```

That single number converts an AI-assisted quote from a guess into a measurement. Anything
below ~1.2× is implausible and usually means the delivered man-days do not cover the same
roles (PM, QA, compliance, client iteration) as the steering time.

## Local delivery-mode anchors

| Anchor | Value | Source |
|---|---|---|
| Man-day | 8 productive hours | WMS offer assumption |
| Contingency | 15% | WMS and Digitalk offers |
| Working days per month | 20 | WMS timeline assumption |
| Confidence bands | ±10% standard CRUD, ±20% integrations, ±30% novel | WMS estimation methodology |
| AI-steering overhead multiplier | 1.5× light / **1.8× base** / 2.25× heavy compliance | Digitalk model, derived from 465 h measured active steering time |
| Steering-hour tiers | M = 4–8 h, L = 10–18 h, XL = 20–30 h | Digitalk, tiered from measured session data |
| OSS "configure not build" leverage | −20–30% on the build half; overhead does **not** shrink | Digitalk |
| Blended day rate, enterprise/international | 600 EUR | WMS offer |
| Blended day rate, SME/Hungary | 423 EUR | Sunbloom offer |
