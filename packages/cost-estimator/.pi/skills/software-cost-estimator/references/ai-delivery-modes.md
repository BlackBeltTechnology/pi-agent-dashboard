# AI vs human delivery: the evidence, and how the model uses it

## The finding that governs everything

**The AI effect is bimodal, and the split is predictable.** Randomised trials disagree
with each other not because one is wrong, but because they measured different regimes.

| Study | Setting | Result |
|---|---|---|
| **METR RCT (2025)**, 16 experienced OSS devs, 246 tasks | Their **own mature repositories**, ~5 years of prior context each | **19% slower** with AI — while believing they were 20% faster |
| **Demirer et al.**, 3 field RCTs, 4,867 developers (Microsoft, Accenture, Fortune 100) | Enterprise, ordinary work | **+26.08% completed tasks** (SE 10.3%); **less experienced developers had higher adoption and greater gains** |
| **GitHub controlled lab study** | Scoped, isolated task | up to **55% faster** |
| **Jellyfish**, 146k Jira tickets, 145 companies, 6,500 engineers | Real-world telemetry | real gains ≈ **8%** |
| **DORA 2025**, ~5,000 professionals | Industry-wide | ~90% adoption; AI is an **amplifier**; throughput recovered but **instability/rework rose** |
| **GenAI SLR + 65-dev survey (2026)** | Task level | >70% of developers at least **halve** time on **boilerplate and documentation** |
| **JetBrains State of Developer Ecosystem 2025** | Survey | Delegated: boilerplate, search, language translation, docs. **Retained: debugging, application logic design** |

Read the gradient: the more novel the code and the less context the human already holds,
the more AI helps. The more the work is a subtle change inside a large system the
developer knows intimately, the more AI costs. Lab conditions sit at one end, METR at
the other, and every real project is a weighted mixture.

## How the model encodes it

```
effort_ai(item) = effort_human(item)
                × speedup(ai_class)
                × codebase_modifier
                × seniority_modifier
                + review_overhead
                + rework_uplift
```

### Speedup by `ai_class` — multipliers on human-only hours

| Class | Optimistic | Likely | Pessimistic | What belongs here |
|---|---:|---:|---:|---|
| `boilerplate` | 0.35 | **0.50** | 0.70 | Scaffolding, DTOs, config, migrations, CRUD screens from a schema |
| `crud` | 0.50 | **0.65** | 0.85 | Standard create/read/update/delete with validation and a UI |
| `integration` | 0.70 | **0.85** | 1.00 | Third-party APIs, protocols, undocumented or flaky external systems |
| `algorithmic` | 0.75 | **0.90** | 1.05 | Domain logic, optimisation, concurrency, state machines |
| `legacy-change` | 0.90 | **1.10** | 1.30 | Changes inside a large mature codebase — **the METR regime** |
| `ux-heavy` | 0.75 | **0.90** | 1.05 | Design-led interaction work, accessibility, bespoke visual design |
| `docs` | 0.30 | **0.45** | 0.65 | Documentation, specs, runbooks, release notes |
| `ops` | 0.60 | **0.80** | 1.00 | Infrastructure, CI/CD, observability wiring |

`×1.00` means no change. Above 1.00 means AI makes it **slower**. That is not a modelling
error — it is the single most robust finding in the 2025 literature, and refusing to
represent it is how estimates become marketing.

### Environment modifiers

| Codebase | × | Rationale |
|---|---:|---|
| greenfield | 0.92 | No existing context to fight; AI's strongest setting |
| brownfield | 1.00 | Neutral baseline |
| legacy | 1.12 | METR conditions across the board |

| Seniority | × | Rationale |
|---|---:|---|
| junior | 0.90 | Demirer: less experienced developers gained most |
| mid | 1.00 | Baseline |
| senior | 1.08 | Highest expertise = smallest marginal gain, largest correction cost |

These magnitudes are **UNCALIBRATED**; the *direction* is well evidenced, the size is not.

### Review and rework — the lines that must never be deleted

| Mode | Review | Rework |
|---|---:|---:|
| `human_only` | 0% | 0% |
| `human_with_ai` | 8% | 5% |
| `ai_steered_human_supervised` | 18% | 10% |
| `agentic_hitl` | 28% | 15% |

DORA 2025's central finding is that AI **amplifies** whatever the organisation already
is: strong teams get better, weak teams get their problems magnified, and instability
rose across the board. Savings that ignore rework are not savings, they are deferred cost.

## The four modes

### `human_only`
Baseline. No AI licence, no token spend, no review or rework uplift.

### `human_with_ai`
Developers keep the keyboard; AI assists inline. Build effort compresses by the
class-weighted speedup; **non-build effort does not change at all**. Then review and
rework are added back.

Expect a **5–15% total project saving**. That is not disappointing — it is what
Jellyfish measured across 146k real tickets. If your model shows 40%, your `ai_class`
mix is fantasy.

### `ai_steered_human_supervised`
The agent writes the change; the human specifies, steers and reviews. Modelled on a
**locally measured** delivery record rather than a vendor claim:

```
steering_hours = build_hours × speedup × agent_leverage(0.75)
total_hours    = steering_hours × steering_overhead
```

The overhead multiplier — **1.5× light / 1.8× base / 2.25× heavy compliance** — was
derived from 465 hours of measured active steering time (inter-message gaps, capped at
15 minutes so breaks do not count as work) that produced a complete product. It covers
everything that never happens inside the agent: manual accessibility testing, security
validation, hosting/DPA/DR/SLA work, client iteration, PM, content authoring, deployment.

Because that multiplier is measured end to end, review is **embedded in it** and is
reported but not added a second time.

Note what this model does honestly: for `legacy-change` work the speedup is 1.10, so
steering hours barely fall while the overhead multiplier still applies — and the mode
comes out **more expensive** than human-only. That is the correct answer.

### `agentic_hitl`
Autonomous agents, human-in-the-loop oversight. Costed with **ACEM** (arXiv 2608.02582),
which decomposes agentic cost into three additive dimensions:

- **LLM cost** — tokens across agent actions, scaled by
  **RF** (Revision Factor: retries and rejected output) ×
  **CF** (Context Factor: token growth as context accumulates)
- **HITL cost** — human oversight, classified by the four-level **HIS**
  (HITL Intensity Score)
- **Infrastructure cost** — orchestration, tooling, observability

ACEM maps UCP/Story Points/Function Points → token consumption, which is why this skill
can price it from the same sizing data.

ACEM ships its constants symbolic — deliberately uncalibrated pending real project data.
**This skill has since measured them** from 542 local pi sessions (737.5 active steering
hours, $7,676 billed) via `src/bin/calibrate-sessions.ts`:

| Parameter | ACEM illustrative | **Measured locally** | Verdict |
|---|---:|---:|---|
| Context Factor | 1.25 | **5.10** | understated 4.1× |
| Revision Factor | 1.40 | **1.05** (lower bound) | overstated; floor held at 1.25 |
| Output share of tokens | 25% | **0.38%** | overstated 66× |
| Cache-read share | — | **95.5%** | this is the actual bill |
| Cost per agent-hour | — | **$10.41** | new |

**The headline correction: agentic cost is context re-reading, not generation.** 95.5% of
every token billed was a cache read. Pricing agentic work as a 25/75 output/input split —
which generic token-cost guidance does — prices the wrong thing by two orders of magnitude.

## The meter is theoretical when you pay a subscription

Everything above is **meter-equivalent**: what a pay-as-you-go API would have charged. Most
teams do not pay that. They buy flat seat plans, and then the cost has a different *shape*:

| | Metered | Subscription |
|---|---|---|
| Cost scales with | work volume | **seats × calendar months** |
| Marginal cost of more agent use | linear | **zero, until quota** |
| Risk of overrun | cost | **schedule** (throttling) |
| Longer schedule, same work | no change | **costs more** |

Three consequences the estimator must respect:

1. **Schedule becomes a cost driver.** A project that slips two months costs two more months
   of seats even though the work is unchanged. Under metering it would not.
2. **The incentive inverts.** Agent usage is free at the margin until quota, so the right move
   is to push agent utilisation *up*, not ration it.
3. **Quota exhaustion is a schedule risk, not a cost overrun.** Subscription cost is capped by
   design; what you lose when you exceed quota is throughput.

### Seat plans (USD per seat per month, verified 2026-08)

| Plan | Price | Source |
|---|---:|---|
| Claude Pro | $20 | claude.com/pricing |
| Claude Max 5× | $100 | claude.com/pricing |
| Claude Max 20× | $200 | claude.com/pricing |
| ChatGPT Plus | $20 | openai.com/chatgpt/pricing |
| ChatGPT Pro 5× | $100 | openai.com/chatgpt/pricing |
| ChatGPT Pro 20× | $200 | openai.com/chatgpt/pricing |
| GLM Coding Lite | $18 | z.ai/subscribe |
| GLM Coding Pro | $72 | z.ai/subscribe |
| GLM Coding Max | $160 | z.ai/subscribe |

### Subscription leverage

```
leverage = meter-equivalent cost ÷ subscription cost
```

**Measured locally: 6.4×** — $7,683 of meter-equivalent consumption on $1,200 of Claude Max
20× over 6 active months. Effective cost **$1.63 per steering hour against $10.41 metered**.

**Report leverage; never bank it as a saving.** It is not a discount the client receives — it
is on-demand value the flat plan captured. Presenting it as a saving is the fastest way to
lose an estimate's credibility under scrutiny.

Check the sign. If measured volume is low, a $200 plan is *dearer* than metering and the
engine says so.

### Do not charge the seat twice

When the subscription is the cost basis, the per-developer tool licence line is **not** charged
additionally — a Claude Max seat *is* the licence. This is the same single-path discipline the
NFR router enforces: one cost, one route.

### Routed models are not metered at all

2.7% of measured hours ran through a router on models reporting `$0.00`. Those hours are real
work with no meter reading, so any naive `$/h` is understated. The calibrator flags this share
explicitly rather than silently averaging it in.

**So prefer a measured rate over the reconstruction.** Set `ai.cost_per_steering_hour` and
the engine skips ACEM's token model entirely. A measured rate already contains every retry,
revision and context effect; reconstructing it from RF × CF × price compounds three
uncertain constants to reach a number you can simply measure.

Context Factor being 5.1× has a design consequence beyond cost: **long agent runs get
progressively more expensive per unit of work.** That is an argument for tightly scoped
agent tasks, and a cost line a naive per-task estimate misses completely.

HITL oversight is modelled as a share of human build hours by HIS level
(0.15 / 0.28 / 0.45 / 0.65), anchored on the local observation that roughly 38% of a
build was active steering time.

## Cost lines that get forgotten

- **Per-seat licences** — every human still touching AI tooling
- **Token spend** — variable, retry-driven, and the RF/CF compounding is where budgets die
- **Agent infrastructure** — orchestration, sandboxes, observability, secret management
- **Review capacity** — the new bottleneck; you cannot spend it into existence
- **Ramp** — a productivity dip during rollout before any gain appears

Practitioner analyses of agentic business cases find them **systematically 40–60%
understated**, almost always because they compare an agent's price to a salary and stop
there.

## How to classify `ai_class` in practice

Ask: *if a competent developer who has never seen this codebase were handed this ticket
with the spec, how much of it is mechanical?*

- Nearly all of it, and the shape is dictated by a schema or a framework → `boilerplate`
- Mostly mechanical but with real validation and edge cases → `crud`
- The hard part is someone else's system behaving badly → `integration`
- The hard part is getting the logic right → `algorithmic`
- The hard part is knowing what will break elsewhere → `legacy-change`
- The hard part is what it should look and feel like → `ux-heavy`

When genuinely torn, pick the **more pessimistic** class. Estimation errors are not
symmetric: the cost of under-quoting is a loss-making project, the cost of over-quoting
is a negotiation.

## Measuring your own

```bash
node bin/calibrate-sessions.mjs --plans
node bin/calibrate-sessions.mjs --plan anthropic-max-20x --seats 2
node bin/calibrate-sessions.mjs --project <substr> --actual-days <N>
```

Reads `~/.pi/agent/sessions/**`. Active steering time is the sum of inter-record gaps with
any gap over 15 minutes capped — a long gap is a break, not work. `--actual-days` solves the
overhead multiplier for that project: delivered man-days ÷ measured steering-days.
`--plan` / `--seat-monthly` / `--seats` add the actual cash cost and the leverage ratio;
without them the cost figures stay theoretical meter-equivalents and the tool says so.

What the measurement is and is not: it counts hours where a human was engaged with the
session. It is not billable-hours truth, and it does not capture work done outside the agent
— which is precisely why the overhead multiplier exists.

## Sources

- METR, *Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity* — arXiv 2507.09089
- Demirer et al., *The Effects of Generative AI on High-Skilled Work: Evidence from Three Field Experiments with Software Developers*
- DORA, *2025 State of AI-assisted Software Development* — dora.dev/ai
- Jellyfish, *We Analyzed 146,000 Jira Tickets for Copilot Users*
- *The State of Generative AI in Software Development* — arXiv 2603.16975
- JetBrains, *State of Developer Ecosystem 2025*
- El-Ramly et al., *ACEM: A Cost Estimation Model for Agentic Software Engineering* — arXiv 2608.02582
