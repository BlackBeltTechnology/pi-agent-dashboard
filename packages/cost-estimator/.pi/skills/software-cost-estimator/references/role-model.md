# Role model

## The principle

The role split is a **distribution of one effort estimate**, never a second independent
estimate. That is what keeps the numbers reconcilable: change the scope and every role
line moves together, and the sum always equals the total.

Estimating each role separately produces a number that cannot be defended, because
nobody can say which role absorbed the scope change.

## Default distribution

| Role | Share | What it covers |
|---|---:|---|
| Product Owner / BA | 7% | Requirements elaboration, acceptance criteria, backlog grooming, client Q&A |
| Architect | 6% | Architecture decisions, ADRs, technical spikes, design review |
| UX / UI Designer | 7% | Flows, wireframes, visual design, design system, accessibility design |
| Frontend Developer | 17% | UI implementation, state, client-side validation |
| Backend Developer | 22% | Domain logic, APIs, persistence, jobs |
| Data / Integration Engineer | 9% | Third-party integrations, ETL, message queues, data mapping |
| QA / Test Automation | 16% | Test design, automation, exploratory testing, regression, UAT support |
| DevOps / SRE | 6% | CI/CD, environments, deployment, observability |
| Security Engineer | 2% | Threat modelling, review, remediation coordination |
| Tech Lead | 3% | Code review, technical coordination, unblocking |
| Project Manager | 5% | Planning, reporting, client comms, risk management |

**Grounding.** The dev/non-dev split lands at roughly 60/40, which matches the local
offer corpus closely: a completed WMS project spent 301 of 479 MD (62.8%) on build
modules and 178 MD (37.2%) on testing, project management and deployment/training —
with QA at 15.2% and PM at 10% of the total. A separate SME project ran QA at 17% of
total. Externally this is consistent with ISBSG role-effort-ratio guidance and
McConnell's activity breakdown (ch. 21).

## Size tilt

Above 4,000 hours the engine tilts the split toward coordination: +2% PM, +2% QA,
+1% Architect, taken proportionally from Frontend and Backend. Bigger projects spend
proportionally more on communication and verification — this is the same phenomenon the
COCOMO scale exponent captures on the effort side.

Empirical work (Bibi et al.; the large Wang & Zhang dataset) shows phase and role
distribution moves with project size and domain. **The table is a prior, not a truth.**
Override it via `team.role_ratios` whenever you know better.

## Which roles are "build"

The delivery-mode model compresses only build effort. These roles are treated as build:

`Frontend Developer`, `Backend Developer`, `Data / Integration Engineer`, `Architect`,
`DevOps / SRE` — about 60% of total effort.

Everything else — Product Owner/BA, UX, QA, Security, Tech Lead, PM — is the ~40% that
does **not** shrink because a model writes the code. Manual accessibility testing, client
iteration, compliance evidence, security sign-off and project management are human work
regardless of how the code gets typed.

This single split is why "AI writes code 10× faster" turns into a single-digit project
saving. If someone disputes your AI-savings number, this table is the argument.

## Overriding

```yaml
team:
  role_ratios:
    Backend Developer: 0.30
    Frontend Developer: 0.20
    QA / Test Automation: 0.20
    Project Manager: 0.10
    Architect: 0.10
    DevOps / SRE: 0.10
  seniority_mix:
    senior: 0.5
    mid: 0.3
    junior: 0.2
  hours_per_day: 8
  fte: 4
```

Ratios are normalised automatically, so they need not sum to 1. Supplying
`role_ratios` disables the size tilt — you are asserting you know the split.

**Roles you name must exist in the rate card**, or their cost is zero and the engine
warns. Check the warning list; a silent zero is how a quote loses money.

## Seniority mix

The mix does two things: it blends the day rate per role, and it modifies the AI
speedup (juniors gained most in the field experiments). Default is
40% senior / 40% mid / 20% junior.

A mix that is too senior is expensive twice over: higher rates, and a smaller marginal
AI benefit.

## Roles people forget to include

- **Security review and remediation** on anything handling personal or financial data
- **DevOps** for environments — dev/test/staging/prod is four times the setup, not one
- **Support handover and documentation** before go-live
- **Hypercare** in the weeks after go-live
- **Client-side effort** — if the client must test, validate or author content, say so
  explicitly in the assumptions; it is not free, it is just not yours

## Sources

- ISBSG, *Planning Projects: Role Effort Ratios*
- McConnell, *Software Estimation: Demystifying the Black Art*, ch. 21
- Bibi et al., *An investigation of effort distribution among development phases*
- Local offer corpus: completed WMS project module and role split; SME quality-platform QA share
