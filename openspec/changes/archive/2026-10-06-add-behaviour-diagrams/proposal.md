## Why

A rebuild team needs the dynamic side of the legacy system as well as its structure: which components talk to each other for a user action (sequence / collaboration), how stateful entities move between their states (state machines), and what concrete data looks like (object diagrams). The package already holds the inputs (UI-model actions and effects, architecture elements, `model.md` fields with allowed values, ER relations) but no gated behaviour models.

## What Changes

- New gated records in a rebuild package, each element cited and linked to BR/QUIRK/GAP/spec refs:
  - `diagrams/sequences/<id>.json` — participants (actor, screen/dialog, architecture element) and messages with `alt`/`opt`/`loop`/`par` fragments; collaboration (communication) diagram projected from it.
  - `diagrams/state-machines/<id>.json` — states of one entity field (values checked against `model.md` allowed values), transitions with trigger, guard, effects, refs, cite; exactly one initial state; every state reachable.
  - `diagrams/objects/<id>.json` — object instances of ER entities with field values and links, each link matching an ER relation and its multiplicity.
- `diagrams.mjs` commands: `check-sequences`, `check-states`, `check-objects` (`--app` checks cite line ranges), `sequence-from-ui <pkg> <SCR>#<ACT> <out>` (deterministic draft from the UI model; lifelines by architecture component cites), `objects-synth <pkg> <Entity> <out>` (synthetic instances from ER + model), `objects-from-db <pkg> <job.json> <out>` (instances from a JSON database snapshot; joins gated against ER relations; every value masked unless listed in `keep`), `behaviour <pkg> <outDir>` (Mermaid `.mmd` per diagram + SCXML per state machine).
- `build-site` embeds and gates all three; `PKG/_local/objects/` (real data) only with `--local`. Catalog: Behaviour button, sequence + collaboration page, state-machine page (SCXML download), object-diagram page, backlinks from rules/quirks/gaps, entities, use cases and screen actions. `render.sh` runs the gates and the export; `LOCAL=1` adds `--local`.
- `reverse-spec-for-rebuild`: prompts `sequence-generator.md` (deepen a draft past the data-layer boundary) and `state-machine-generator.md`, one subagent per record, accepted only when the gate passes.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: behaviour diagrams (sequence, collaboration, state machine, object).
- `reverse-spec-for-rebuild`: behaviour-model generator prompts and phase.

## Impact

- New `scripts/behaviour.mjs`; `diagrams.mjs`, `site.mjs`, `arch.mjs` (export resolver/cite helpers), `templates/catalog.{js,css}`, `render.sh`, SKILL.md files, tests. No dependency. Packages without these records build unchanged. Rollback = revert.
- Privacy: real-data object diagrams are masked by default and stay out of the shared catalog unless `--local`.

## Discipline Skills

- `security-hardening` — database snapshots are customer data: default-mask, local-only output, no values in error messages.
- `review-code` — inline review.
