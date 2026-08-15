# Sizing methods

## Why UCP is the primary method here

The input this skill receives is use cases, actors, requirements and a stack. That is
exactly UCP's native input. Function Points need logical files and transaction types;
COSMIC needs data movements per functional process; COCOMO needs a size in FP or SLOC
that you do not have yet. UCP is the only method that consumes the artefact you are
actually handed at quoting time.

Published comparative reviews put UCP at the best of the classical trio
(MMRE ≈ 39%, versus ≈ 90% for FPA), with COCOMO in between. Note what MMRE ≈ 39% means:
**a typical estimate is wrong by about 40%.** That is the state of the art. It is why
this skill refuses to emit a point number without a range.

## The formulas the engine implements

```
UUCW = Σ use-case weights
         ≤3 transactions  → simple  →  5
        4–7 transactions  → average → 10
         >7 transactions  → complex → 15

UAW  = Σ actor weights
        API / well-defined programmatic interface  → 1
        protocol or database interface (TCP, HTTP, FTP, DB) → 2
        human actor through a GUI                  → 3

TCF  = 0.6 + 0.01 × Σ(weightᵢ × ratingᵢ)     13 technical factors, rating 0–5
ECF  = 1.4 − 0.03 × Σ(weightⱼ × ratingⱼ)      8 environmental factors, rating 0–5

UCP  = (UUCW + UAW) × TCF × ECF
Effort = UCP × hours-per-UCP
```

Karner's original constant is **20 h/UCP**; practice ranges 15–30. Use a reference class.

### Technical factors (T1–T13) and their weights

| # | Factor | Weight |
|---|---|---:|
| T1 | Distributed system | 2.0 |
| T2 | Response time / throughput objectives | 1.0 |
| T3 | End-user efficiency | 1.0 |
| T4 | Complex internal processing | 1.0 |
| T5 | Reusable code | 1.0 |
| T6 | Easy to install | 0.5 |
| T7 | Easy to use | 0.5 |
| T8 | Portable | 2.0 |
| T9 | Easy to change | 1.0 |
| T10 | Concurrent | 1.0 |
| T11 | Special security objectives | 1.0 |
| T12 | Direct access for third parties | 1.0 |
| T13 | Special user training facilities | 1.0 |

Rate 0 = irrelevant, 5 = essential. All-3 ratings give TCF ≈ 1.02, i.e. neutral.

### Environmental factors (E1–E8) and their weights

| # | Factor | Weight |
|---|---|---:|
| E1 | Familiarity with the development process | 1.5 |
| E2 | Application experience | 0.5 |
| E3 | Object-oriented / paradigm experience | 1.0 |
| E4 | Lead analyst capability | 0.5 |
| E5 | Motivation | 1.0 |
| E6 | Stable requirements | 2.0 |
| E7 | Part-time staff | −1.0 |
| E8 | Difficult programming language | −1.0 |

Note the sign flip on E7 and E8: for those two, a **high** rating makes the project
*harder*, so it reduces ECF's subtrahend and raises effort. Rate E7 by how much
part-time staffing there is, and E8 by how difficult the language is.

## Counting transactions — the judgment that matters most

A "transaction" is one stimulus/response round trip between an actor and the system: an
atomic step that either completes or rolls back. Count them across the main success
scenario **and** the alternate/exception flows.

Consistency beats precision. If you count generously on one use case and stingily on
the next, the relative sizing is wrong and no calibration can fix it. Pick a convention
and hold it across the whole input file:

- A form submission with validation and a persisted result = 1 transaction.
- A multi-step wizard = 1 transaction per step that hits the server.
- "System sends a notification" = 1 transaction.
- A read-only list view with filtering = 1 transaction.
- An exception path that requires distinct handling logic = 1 transaction.

Do **not** count internal method calls, database round trips, or UI state changes that
never reach the server.

## Diseconomy of scale — why UCP alone is optimistic

UCP is linear: 2× the use cases gives 2× the effort. Real projects do not behave that
way. COCOMO II encodes this in an exponent:

```
E = B + 0.01 × Σ scale factors        B = 0.91
PM = A × Size^E × Π(effort multipliers)   A = 2.94
TDEV = C × PM^(D + 0.2 × (E − B))     C = 3.67, D = 0.28
```
(COCOMO II.2000 Model Definition Manual, USC.)

Since E > 1 for essentially every real project, doubling scope more than doubles effort.
The engine applies this as `(UCP / reference_UCP)^(E − 1)`, so at the reference size the
adjustment is exactly 1.0 and your calibrated h/UCP keeps its meaning.

### The five scale factors

| Factor | Meaning | Rate it `high`/`very-high` when… |
|---|---|---|
| PREC | Precedentedness | you have built this kind of system before |
| FLEX | Development flexibility | the client will negotiate on requirements |
| RESL | Risk resolution | architecture risks are already retired |
| TEAM | Team cohesion | the team has worked together before |
| PMAT | Process maturity | the delivery process is established and measured |

Each rating from `very-low` to `extra-high` lowers the exponent. A novel domain with an
unproven process (`PREC: low`, `PMAT: low`) can push E above 1.10 — a 30% penalty on a
large project relative to a well-precedented one.

## Cross-checks worth running

**COSMIC (ISO 19761)** — size = count of data movements (Entry, Exit, Read, Write) across
functional processes. Best when use cases are written as flows, and it scales cleanly to
APIs and services where UCP's "actor" concept gets strained. Divergence of more than
~25% between UCP and COSMIC sizing is a signal that the use cases are written at
inconsistent granularity — fix the input, not the model.

**IFPUG FP + SNAP** — SNAP is the only standardized *non-functional* size unit; if you
already have an FP count, SNAP is a more rigorous alternative to this skill's residual
NFR multiplier.

**Expert judgment / planning poker** — use as a challenge to the model output, never as
the model input. When the team's bottom-up number and the model diverge by more than
30%, the disagreement itself is the useful artefact: find which use case they disagree
about.

## Sources

- Karner, *Resource Estimation for Objectory Projects* (via the Use Case Points literature)
- Cohn, *Estimating With Use Case Points*, Mountain Goat Software
- COCOMO II.2000 Model Definition Manual, USC Center for Systems and Software Engineering
- ISO/IEC 19761 (COSMIC); ISO/IEC 20926 (IFPUG FP)
- McConnell, *Software Estimation: Demystifying the Black Art*
