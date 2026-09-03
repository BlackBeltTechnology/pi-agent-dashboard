---
name: software-cost-estimator
description: Estimate developer cost and effort for a set of use cases, functional and non-functional requirements on a given technology stack. Produces an architecture plan, a role-resolved man-hour estimate with P50/P85/P95 ranges, a side-by-side comparison of four delivery modes (human only, human + AI, AI-steered human-supervised, agentic HITL), and a business case with NPV/ROI/payback/TCO and a must-should-could scope ladder. Use when the user asks "how much would this cost to build", "estimate this project", "how many man-days", "make an offer/quote", "what would it cost with AI vs without", "build a business case for this feature", or wants to size a backlog, an RFP response, or a change request.
---

# Software Cost Estimator

Turn requirements into a defensible number — with the workings shown.

**Division of labour that makes this trustworthy:** you do the judgment (decompose
use cases, count transactions, rate factors, route NFRs, classify AI-suitability).
A deterministic TypeScript engine does the arithmetic (UCP, COCOMO scale, role split,
Monte Carlo, NPV). Never compute these by hand — you will be wrong, and the client
cannot audit a number you invented.

## Non-negotiable rules

1. **Never emit a single number.** Always P50/P85/P95 plus the cone-of-uncertainty band.
   Fund to P85. Quote P50 only alongside its range.
2. **Estimate ≠ target ≠ commitment.** Say which one you are producing.
3. **Never show AI savings without the review and rework lines.** DORA 2025 found AI
   adoption raised instability even as throughput recovered. A comparison that hides
   this is a sales document.
4. **Route each NFR to exactly one path** — derived scope *or* multiplier. Both is
   double counting; the engine warns, but you should not create the situation.
5. **Print the assumption register** with every estimate. Every constant is cited or
   marked UNCALIBRATED in `src/engine/defaults.ts`.
6. **Prefer a reference class over a textbook constant.**
7. **Quote the cost basis you actually pay.** Metered token cost is theoretical when capacity
   is bought on a subscription. Report subscription leverage (meter-equivalent ÷ seat cost) as
   *leverage*, never as a saving passed to the client. Under a subscription, schedule is a cost
   driver and quota exhaustion is a **schedule** risk, not a cost overrun. Check
   `assets/calibration/reference-classes.md` before accepting the default 20 h/UCP.

## Workflow

### 1. Gather

Ask only for what materially changes the number. If the user has a spec, read it and
propose the decomposition rather than interrogating them.

Minimum viable input: a list of use cases, the actors, and the stack.
Everything else has a documented default.

Ask when missing and material:
- **Phase** — how firm are the requirements? Sets the cone. (`initial-concept` → 4× band.)
- **Codebase** — greenfield / brownfield / legacy. Legacy inverts the AI benefit.
- **Compliance** — GDPR, GMP, medical, financial. Usually large derived scope.
- **Team seniority mix and rate card** — or accept `assets/rates.default.yaml`.

### 2. Architecture plan

Before sizing, derive the architecture from the stack + NFRs. Write
`architecture-plan.md` from `assets/templates/architecture-plan.md`. It must contain an
**NFR → component trace matrix**, because that matrix is what produces the derived
scope in the next step. See `references/nfr-catalog.md`.

### 3. Build the input file

Copy `assets/example-quality-hub.yaml` and adapt. Key judgments you make:

- **`transactions`** per use case — the number of stimulus/response steps across the
  success scenario and its alternates. This drives the Karner weight band
  (≤3 simple = 5, 4–7 average = 10, >7 complex = 15). Getting this consistent matters
  far more than getting it "right"; see `references/sizing-methods.md`.
- **`ai_class`** per use case — see `references/ai-delivery-modes.md`. This is the
  single most consequential classification in the file.
- **NFR routing** — `references/nfr-catalog.md` has the decision rule per ISO 25010
  attribute.
- **UCP factors** — 13 technical (T1–T13) and 8 environmental (E1–E8), each 0–5.
  Omitted factors default to 3 (neutral) and raise a warning.

### 4. Run

```bash
cd "$(dirname "$(node -e "console.log(require.resolve('@blackbelt-technology/pi-dashboard-cost-estimator/package.json'))")")"
node bin/estimate.mjs <input.yaml> --out <dir>
```

Writes `estimate-report.md`, `delivery-mode-comparison.md`, `business-case.md` and
`estimate.xlsx`. Add `--json` for the full result object, `--rates <file>` to override
the rate card.

### 5. Sanity-check before showing anyone

- Does the implied h/UCP match a reference class? If the engine is using 20 and your
  team ships in 13, you are quoting 54% high.
- Does the schedule warning fire? Compressing below ~75% of the COCOMO nominal
  schedule is where projects historically break.
- Is `human_with_ai` saving ~5–15%? That matches real-world telemetry (Jellyfish ~8%).
  If it shows 40%+, your `ai_class` mix is too optimistic.
- Is any mode showing AI making things *slower*? For legacy work that is correct,
  not a bug — say so out loud.

### 6. Deliver

Render the Markdown to client-facing DOCX/PDF with the `document-converter` skill when
asked. Keep the `.xlsx` attached: a client who can poke the assumptions trusts the
number far more than one who cannot.

### 7. Calibrate — do this after every completed project

Two calibrators, and you should run both.

**Scope productivity** — solves hours-per-UCP from a delivered project:
```bash
node bin/calibrate.mjs <input.yaml> --actual-days <N> --exclude-contingency
```

**Agent cost and steering time** — measured from real pi session telemetry:
```bash
node bin/calibrate-sessions.mjs
node bin/calibrate-sessions.mjs --project <substr> --actual-days <N>
```

The session calibrator reads `~/.pi/agent/sessions/**` and measures what the model would
otherwise guess: active steering hours (inter-record gaps, capped at 15 min so a break is
not billed as work), real token mix, and actual billed cost. Passing `--actual-days` for a
project solves the **AI-steered overhead multiplier** directly — delivered man-days ÷
measured steering-days. That is the number that turns an AI-assisted quote from a guess
into a measurement.

Set `ai.cost_per_steering_hour` from its output. A measured rate replaces the ACEM token
reconstruction entirely, because it already contains every retry, revision and
context-growth effect.

**But the meter is theoretical if the team pays a subscription.** Set
`ai.cost_basis: subscription` and list the seat plans; cost then scales with seats × calendar
months rather than work volume. Pass `--plan` / `--seats` to the calibrator to get the actual
cash cost and the leverage ratio:

```bash
node bin/calibrate-sessions.mjs --plans
node bin/calibrate-sessions.mjs --plan anthropic-max-20x --seats 2
```

Add results to `assets/calibration/reference-classes.md`. This is the only mechanism that
makes the next estimate better than this one.

## The four delivery modes

| Mode | Who writes the code | What you are paying for |
|---|---|---|
| `human_only` | Humans | Baseline. No AI cost, no review/rework uplift. |
| `human_with_ai` | Humans, AI assists inline | Modest build compression + review + rework. Real-world ≈ 5–15%. |
| `ai_steered_human_supervised` | Agent writes, human specifies and reviews | Steering hours × a locally measured overhead multiplier (1.8× base). |
| `agentic_hitl` | Autonomous agents | ACEM: tokens + HITL oversight + infrastructure. Constants UNCALIBRATED. |

**AI compresses build effort only.** Project management, client iteration, compliance,
manual QA and security sign-off do not shrink because a model writes the code. This is
why headline "AI is 10× faster" claims collapse into single-digit project savings.

Full evidence table and the per-class speedup bounds: `references/ai-delivery-modes.md`.

## Reference files

Read these on demand — do not preload them.

| File | Read it when |
|---|---|
| `references/sizing-methods.md` | Counting transactions, rating factors, or choosing UCP vs COSMIC vs FP |
| `references/nfr-catalog.md` | Routing an NFR, or expanding one into derived scope |
| `references/ai-delivery-modes.md` | Classifying `ai_class`, or defending an AI-vs-human number |
| `references/role-model.md` | Changing the role split, or explaining who does what |
| `references/rates.md` | Setting or overriding the rate card |
| `references/business-case.md` | Building the NPV/ROI/scope-ladder narrative |
| `assets/calibration/reference-classes.md` | Before accepting any default productivity constant, and for the measured session telemetry |

## Templates

`assets/templates/` holds `architecture-plan.md` and `offer-summary.md`. The estimate,
mode-comparison and business-case documents are generated by the engine, not templated.

## Tests

```bash
npx vitest run packages/cost-estimator      # from the monorepo root
```

43 tests. They pin the published formulas (Karner's worked example, COCOMO II.2000
constants, Beta-PERT mean), the double-counting guard, the correlated-risk shape, the
subscription cost basis (seats × months, utilisation apportionment, leverage never banked
as a saving), the gap-capping rule, and the behavioural claims that matter: that
AI-assisted savings stay in a credible band, and that AI comes out **more expensive** for a
senior developer changing legacy code. Run them after touching `src/engine/` or
`src/telemetry/`.

## Runtime

Node 22.6+. The `bin/*.mjs` launchers shell out to `tsx`, which is what resolves the
repo-convention `.js` specifiers to `.ts` sources.

**The dependency split is deliberate and load-bearing:**

| Layer | Dependencies | Why |
|---|---|---|
| `src/engine/` | **none** | The YAML parser, Beta-PERT Monte Carlo and XLSX writer are all hand-rolled. An estimator whose numbers depend on a supply chain is not auditable, and the engine must run in any project with no dashboard installed. |
| `src/telemetry/` | `pi-dashboard-shared`, `pi-dashboard-session-distiller` | Reads the session store through the dashboard's own readers rather than re-parsing it, so a session-schema change lands in one place instead of silently rotting the calibration. |

Keep that seam. If engine code ever imports from `telemetry/`, portability is gone.
