# Business case

## What a business case has to answer

Not "what will it cost" — that is the estimate. A business case answers:
**should we spend this money, and how would we know if we were wrong?**

Two failure modes kill business cases. Either there is no financial model, so a reader
has nothing to evaluate but adjectives. Or the model exists but is so optimistic a
finance partner can dismantle it in three questions. The structure below fixes both.

## Structure

1. **Problem** — what is broken now, quantified. "Operators fill 240 paper forms a
   month; QA spends 3 days per batch reconciling them."
2. **Options** — including do-nothing and buy-instead-of-build. A business case with one
   option is a proposal, not a case.
3. **Recommendation** — with the reason the other options lose.
4. **Cost** — build (from the estimate, at P85), run, and TCO over the horizon.
5. **Benefit** — quantified, confidence-weighted, with the mechanism named.
6. **Financials** — NPV, ROI, payback, and the cash-flow table.
7. **Sensitivity** — which assumption, if wrong, flips the decision.
8. **Risks** — with owners and mitigations.
9. **Scope ladder** — must / should / could, with the cost of each tier.

The engine computes 4, 6, 7 and 9 from the estimate input. You write 1, 2, 3, 5 and 8.

## Quantifying benefit without lying

Every benefit needs a **mechanism** and a **confidence weight**. The engine multiplies
`annual_value × confidence`, so state confidence explicitly rather than quietly
discounting the value.

| Benefit type | Mechanism to state | Typical confidence |
|---|---:|---:|
| Labour saved | Hours × loaded rate, and **what those people now do instead** | 0.6–0.8 |
| Error/rework reduction | Current defect rate × cost per defect × expected reduction | 0.5–0.7 |
| Revenue enabled | Conversion or capacity change, with the baseline | 0.3–0.6 |
| Compliance / risk avoidance | Probability × impact of the penalty avoided | 0.4–0.7 |
| Cost avoidance | The specific spend that will not happen | 0.7–0.9 |

**The hardest question a CFO asks about labour savings: does headcount actually fall, or
do those hours get absorbed?** If they get absorbed, it is a capacity benefit, not a cash
benefit — and it does not belong in an NPV without saying so.

Benefits that ramp should use `start_year` rather than being averaged across the horizon.

## The financials

```yaml
business:
  discount_rate: 0.12      # cost of capital; ask finance, do not guess
  horizon_years: 3         # 3 for line-of-business software, 5 for platforms
  benefits:
    - name: QA reconciliation labour
      annual_value: 68000
      confidence: 0.8
    - name: Reduced batch rejection
      annual_value: 45000
      confidence: 0.6
      start_year: 2
  run_costs:
    - name: Hosting and backup
      annual_value: 6000
    - name: Support retainer
      annual_value: 18000
```

- **NPV** — the decision metric. Positive at the stated discount rate, or do not build it.
- **ROI** — `(total benefit − TCO) / TCO`. Easy to communicate, easy to game; never
  present it without NPV.
- **Payback** — how long until cumulative net benefit covers the build. Sponsors care
  about this more than NPV, whatever finance says.
- **TCO** — build + run × horizon. The number vendors omit.

**Fund the build at P85, not P50.** A business case built on a P50 estimate is a 50%
chance of a budget overrun on day one.

## Sensitivity — the section that earns trust

The engine runs one-at-a-time sensitivity on the three drivers that actually move NPV:
build cost ±30%, annual benefit ±40%, run cost ±50%.

Read it for the **flip point**: which single assumption, moved to its downside, makes NPV
negative? Name it in the narrative. "This case survives a 30% cost overrun but not a 40%
benefit shortfall — so the thing to validate before committing is the benefit
assumption, not the estimate."

That sentence is worth more than the whole spreadsheet.

## Scope ladder — "what tasks are needed, and with how much effort"

```yaml
  scope_tiers:
    - tier: must
      use_cases: [UC-01, UC-02, UC-03, UC-04, UC-05]
    - tier: should
      use_cases: [UC-06, UC-07, UC-10]
    - tier: could
      use_cases: [UC-08, UC-09]
```

Produces tier cost and cumulative cost, so a sponsor can buy the tier they can afford
instead of negotiating the whole thing down.

Rules that keep the ladder honest:
- **must** = the business case does not work without it. If a benefit line depends on a
  use case, that use case is a must.
- **should** = materially improves the benefit or the adoption.
- **could** = real value, first to be cut.
- Every use case appears in exactly one tier.
- NFR-derived scope belongs to the tier of the use cases it protects — compliance and
  security scope is almost always **must**, and cutting it is a decision someone must
  sign for, not a saving.

## Agentic and AI-heavy cases need extra care

Practitioner analyses find agentic AI business cases **systematically 40–60% understated**.
The usual error is comparing an agent's price to a salary and stopping. What gets missed:

- Run cost is **continuous and variable**, and retries dominate its variance
- Orchestration, observability, sandboxing, secret management
- Human review capacity — the new bottleneck, and it cannot be bought quickly
- Failure recovery and the governance process around it
- A productivity dip during rollout, before any gain

Present agentic run cost as a **range**, never a price.

## Sources

- DOD IT Business Case Analysis template (structure)
- Enterprise software TCO/benefits-case practice
- EY and BCG analyses of agentic AI token cost and FinOps
- McConnell on estimate vs target vs commitment
