## Context

`scenario-design` currently lives at `.pi/skills/scenario-design/` (repo-only, never published). `@blackbelt-technology/pi-dashboard-eng-disciplines` is a published MIT package of portable, NL-triggered engineering disciplines, deliberately orthogonal to the openspec pipeline. Its README lists 8 skills and explicitly excludes anything tied to this repo's paths/tools. The move adds a 9th — the package's missing **test-design** discipline (it has `systematic-debugging` for root-causing an existing bug, but nothing for designing tests up front).

Two repo hooks block a clean drop-in:
1. Phase 4's level table hardcodes `unit / qa VM smoke / Playwright e2e` + repo paths.
2. The output path (`openspec/changes/<name>/test-plan.md`) and `compatibility: Requires openspec CLI` assume OpenSpec.

## Decision 1 — Parameterize, don't delete, the routing method

The scenario-nature → test-level mapping *method* is the skill's value and is portable. Only the level *names/paths* are repo-specific.

**Decision:** rewrite Phase 4 to route to "your project's test levels", and demote the concrete `unit / qa VM smoke / Playwright` table to an explicitly-marked "Example: pi-agent-dashboard levels" callout.

### Considered alternatives
- **Strip the table entirely** — rejected; this repo loses its exact routing (the AGENTS.md rendered-UI/qa-smoke rule) and future dashboard sessions get weaker guidance.
- **Keep the table, add a "generic projects: adapt this" note** — rejected; the dashboard levels would read as the default and mislead other projects.

## Decision 2 — Soften OpenSpec coupling to "optional input", keep the artifact shape

The skill's output is a `test-plan.md` catalog. OpenSpec is one *source* of the spec it reads and one *place* to write the plan, not a hard dependency.

**Decision:** the output location becomes a parameter the skill asks about; `compatibility` changes to "Optional: OpenSpec change spec as input". The catalog schema (per-scenario Triple + level tag) is unchanged.

### Considered alternatives
- **Fork a generic + an openspec variant** — rejected; two skills to maintain for one method. Parameterization covers both.

## Decision 3 — Move, don't symlink; exactly one source

**Decision:** physically move the skill dir into `packages/eng-disciplines/.pi/skills/scenario-design/` and delete the root copy, matching the `switch-extension-source` "exactly one source per package" invariant. Update `pi.skills[]`, version bump, README skills table, and `packages/eng-disciplines/AGENTS.md` DOX row. NOTICE is untouched — the skill is repo-authored (`author: robson`, MIT), no third-party attribution.

## Risks

- **Behaviour drift for this repo**: if the example callout doesn't reproduce the old routing exactly, dashboard test plans could route rendered-UI scenarios away from Playwright. Mitigate with `doubt-driven-review` before deleting the root copy; diff the old vs. new routing on a known change.
- **eng-disciplines scope creep**: the package is dev-only (not Electron-bundled). This move keeps that — no bundling change.
