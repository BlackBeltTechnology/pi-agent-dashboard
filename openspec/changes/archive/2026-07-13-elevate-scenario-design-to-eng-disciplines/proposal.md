## Why

`scenario-design` is a genuine, portable engineering discipline — ISTQB test-scenario design with an `input · trigger · observable` testability probe and a spec-gap clarification gate. It fills the one hole in the `@blackbelt-technology/pi-dashboard-eng-disciplines` package: that package ships `systematic-debugging` (root-cause a bug that already exists) but nothing for **designing tests before the bug exists**. Today the skill lives in the repo-only `.pi/skills/` tree and never publishes.

Two thin repo hooks are the only thing keeping it project-bound:
1. **Phase 4 level-routing table** hardcodes this repo's test levels (`unit / qa VM smoke / Playwright e2e`) and paths.
2. **Output path + compat line** hardcode `openspec/changes/<name>/test-plan.md` and `Requires openspec CLI`.

The portable core — the Triple, the ISTQB technique cheatsheet, the "scenario ≠ smoke" rule, the STOP-and-ask gate — is fully generic. Decoupling those two hooks lets the skill drop into the published eng-disciplines package unchanged in spirit.

## What Changes

- **Decouple Phase 4**: replace the fixed `unit / qa VM smoke / Playwright` table with a generic "route each scenario to *your* project's test levels" instruction; keep the routing *method* (scenario nature → level) but parameterize the level names/paths. Move the dashboard-specific table into an optional "Example: pi-agent-dashboard levels" callout so no portability is lost for this repo.
- **Decouple output**: make the `test-plan.md` target a parameter ("write to your change/spec's test-plan location"), not a hardcoded `openspec/changes/<name>/` path. Soften `compatibility` from "Requires openspec CLI" to "Optional: OpenSpec change spec as input".
- **Move the skill** `.pi/skills/scenario-design/` → `packages/eng-disciplines/.pi/skills/scenario-design/` (SKILL.md + any support files).
- **Wire eng-disciplines manifest**: add `.pi/skills/scenario-design` to `pi.skills[]` in `packages/eng-disciplines/package.json`; bump the package version; extend the `keywords`/`description` to mention test-design.
- **Docs**: add the skill's row to the eng-disciplines README skills table and to `packages/eng-disciplines/AGENTS.md` (DOX). NOTICE unchanged (skill is repo-authored MIT, `author: robson` — no third-party attribution needed).
- **Delete** the root `.pi/skills/scenario-design/` copy so exactly one source exists.
- **Non-goals**: no change to the scenario-design *method* or its guardrails; no change to how `implement`/`openspec-apply-change` consume a test-plan; no Electron bundling (eng-disciplines stays dev-only per its Scope section).

## Capabilities

### New Capabilities

- `scenario-design-discipline`: the test-scenario-design skill ships inside the published eng-disciplines package, NL-triggered, portable across projects; its test-level routing and output target are project-parameterized rather than dashboard-hardcoded; this repo retains an example callout preserving current behaviour.

### Modified Capabilities

(none)

## Impact

- **Moved**: `.pi/skills/scenario-design/` → `packages/eng-disciplines/.pi/skills/scenario-design/`.
- **Modified**: `packages/eng-disciplines/package.json` (`pi.skills[]` 8→9, version bump, keywords/description), its README + AGENTS.md/DOX.
- **eng-disciplines grows 8 → 9 skills**; ~1 more always-on skill description in dev pi sessions (~0.5 KB). Bodies load on demand.
- **Root skill count drops by one**; no runtime/dashboard-server impact (dev-only skill package).
- **Release**: eng-disciplines is already in the `release-cut` publish set, so the new skill ships on the next version bump automatically.

## Discipline Skills

- `doubt-driven-review` — the decouple edits an already-shipped skill's behaviour surface; before deleting the root copy verify the parameterized Phase 4 still reproduces this repo's exact routing via the example callout (irreversible-ish: other sessions rely on the skill's current output shape).
