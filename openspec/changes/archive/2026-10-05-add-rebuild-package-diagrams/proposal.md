## Why

`reverse-spec-for-rebuild` produces a text-only rebuild package (`model.md`, `rules.md`,
`capabilities/*/spec.md`). On a real run (Plantifier v2.11.1: 109 entities, 18 capabilities,
837 rules) the reader has no visual entry point: relationships hide in free-text
`Relationships:` lines and use cases hide in WHEN/THEN scenarios. Stakeholders asked for an
ER diagram of the entities and for the use cases drawn as business (BPMN) processes.

## What Changes

- New skill `rebuild-package-diagrams` in `packages/eng-disciplines`:
  - ER: deterministic `model.md` parser → agent curates domain entities + cardinality in
    `er.json` (each relation carries evidence from the package) → deterministic Mermaid
    `erDiagram` render that refuses unknown entities/fields and unevidenced relations;
    inferred cardinality is drawn dashed.
  - BPMN: agent selects actor-triggered multi-step use cases from capability specs, maps
    scenarios to semantics-only BPMN, every flow node documented with package refs
    (`BR-`/`QUIRK-`/`GAP-` ids or `spec:<cap>#<Requirement>`); a deterministic trace check
    refuses dangling refs; layout/validation/viewing delegate to the `bpmn-package-explorer`
    skill when installed.
- `scripts/diagrams.mjs` (Node ≥20, no deps): `extract-model`, `render-er`, `check-trace`.
- Package wiring: `pi.skills[]`, README row, AGENTS.md rows, keywords.

## Capabilities

### New Capabilities
- `rebuild-package-diagrams`: ER + BPMN views over a reverse-spec rebuild package, every
  drawn element traceable to the package.

### Modified Capabilities
- None.

## Impact

- New files under `packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/` and
  `packages/eng-disciplines/src/__tests__/diagrams.test.ts`; `package.json`, README, AGENTS.md.
- No runtime code, no new dependency. Rollback = remove the skill dir and its `pi.skills` entry.
- Optional runtime peers: `mmdc` (PNG render), `bpmn-package-explorer` skill (BPMN layout/view).

## Discipline Skills

- `review-code` — inline review of the script and skill text before commit.
- No security, performance or observability triggers: local file-in/file-out script, no
  untrusted network input, no endpoint.
