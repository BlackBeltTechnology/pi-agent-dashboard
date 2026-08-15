# @blackbelt-technology/pi-dashboard-cost-estimator

Estimate software cost and effort from use cases, functional and non-functional
requirements, and a technology stack — then calibrate the model against what actually
happened, using real pi session telemetry.

Ships three things:

1. **A skill** (`.pi/skills/software-cost-estimator`) — the workflow, references and rules
   the agent follows when producing an estimate.
2. **A zero-dependency engine** (`src/engine/`) — the arithmetic, so the numbers are
   reproducible and auditable rather than model-generated.
3. **A dashboard plugin** (`src/client/`, `src/server/`) — measured steering hours, agent
   cost and subscription leverage per project.

## Why the split matters

The LLM does **judgment**: decomposing use cases, counting transactions, rating TCF/ECF
factors, routing NFRs, classifying which work AI is actually good at.

The engine does **arithmetic**: UCP → COCOMO II scale → role distribution → four delivery
modes → Monte Carlo → NPV.

That separation is what makes an estimate defensible to a client. Every number has a
derivation someone can check.

## Quick start

```bash
# estimate
node bin/estimate.mjs input.yaml --out ./out

# calibrate scope productivity from a delivered project
node bin/calibrate.mjs input.yaml --actual-days 479 --exclude-contingency

# calibrate agent cost + steering time from real session telemetry
node bin/calibrate-sessions.mjs --plans
node bin/calibrate-sessions.mjs --plan anthropic-max-20x --seats 2
node bin/calibrate-sessions.mjs --project my-repo --actual-days 120
```

Outputs: `estimate-report.md`, `delivery-mode-comparison.md`, `business-case.md`,
`estimate.xlsx`.

## The four delivery modes

| Mode | Who writes the code |
|---|---|
| `human_only` | People, no assistance |
| `human_with_ai` | People with inline assistance |
| `ai_steered_human_supervised` | Agents, steered and reviewed by a person |
| `agentic_hitl` | Agents, with human-in-the-loop oversight at an intensity level |

AI compresses **build effort only** (~60% of a project). PM, client iteration, compliance,
manual QA and security sign-off do not shrink because a model writes the code. That single
constraint is why "AI is 10× faster" collapses into single-digit project savings.

## Cost basis: subscription vs metered

Session logs record a **metered API-price computation**. Most teams do not pay that — they
buy flat seat plans. The two bases have different *shapes*:

| | Metered | Subscription |
|---|---|---|
| Cost scales with | work volume | seats × calendar months |
| Marginal cost of more agent use | linear | zero, until quota |
| Overrun risk lands on | cost | schedule (throttling) |

So under a subscription, **schedule is a cost driver** and quota exhaustion is a schedule
risk, not a cost overrun. Set `ai.cost_basis: subscription` and list your seat plans.

Leverage (meter-equivalent ÷ seat cost) is reported as *leverage* — never as a saving
passed to a client. It is on-demand value the flat plan captured, not a discount.

## Dependency split (load-bearing)

| Layer | Dependencies |
|---|---|
| `src/engine/` | **none** — hand-rolled YAML parser, Monte Carlo, XLSX writer |
| `src/telemetry/` | `pi-dashboard-shared`, `pi-dashboard-session-distiller` |

The engine must run in any project with no dashboard installed. Only the telemetry adapter
touches the session store, and it reads through the dashboard's own readers so a
session-schema change lands in one place. **If engine code imports from `telemetry/`,
portability is gone.**

## Dashboard plugin

| Slot | Component | Purpose |
|---|---|---|
| `command-route` | `CostView` | `cost` command → steering hours, meter-equivalent, actual subscription cost, leverage, per-project table |
| `settings-section` | `CostSettings` | Seat plan, seat count, break threshold |

Server route: `GET /api/cost-estimator/telemetry` (read-only, 60s cache).

No `content-view` claim. `forSession()` keeps every predicate-less claim, so an
unpredicated `content-view` claim replaces `ChatView` for every session, always,
with no chrome to dismiss it. `CostView` is a global report — the `cost`
command-route is its entry point.

## Tests

```bash
npx vitest run packages/cost-estimator    # from the monorepo root
```

43 tests covering the published formulas (Karner's worked example, COCOMO II.2000
constants, Beta-PERT), the NFR double-counting guard, the correlated-risk shape, the
subscription cost basis, and the gap-capping rule.

## License

MIT
