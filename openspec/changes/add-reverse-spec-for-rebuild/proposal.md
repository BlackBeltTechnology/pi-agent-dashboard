## Why

`reverse-spec-from-code` produces kb-searchable behavioral specs, but deliberately strips the
information a team needs to **rebuild** the same business logic from scratch: data shapes,
business rules as rules, implicit behavior, provenance, confidence, and known unknowns. The gap
analysis (`docs/research/reverse-engineering-gap-analysis.md`, tranche 1) ranks these as the
cheapest, lowest-risk gaps to close — prompt/methodology work only — and the prerequisite for the
later characterize (golden vectors) and rebuild-check (blind rebuild) tranches.

## What Changes

- New sibling skill `reverse-spec-for-rebuild` in `packages/openspec-workflow`, reusing
  `reverse-spec-from-code`'s discovery prompt and `openspec validate` gate by reference.
- Emits a **rebuild package** (not kb specs): per-capability behavioral specs plus cross-cutting
  `model.md` (entities), `rules.md` (`BR-NNN`, tagged explicit/implicit), `quirks.md`
  (`QUIRK-NNN`, suspected bugs kept faithful + flagged), `gaps.md` (`GAP-NNN`, registered
  unknowns), and `completeness.md` (entry-point coverage gate report).
- Every claim carries an inline provenance citation (`file:line`) and a confidence level
  (`confirmed` / `inferred` / `assumed`).
- Behavioral specs cover state machines, edge cases, and error handling via fixed checklists.
- Completeness gate: every discovered entry point (tools/commands, env vars, CLI flags, HTTP
  routes, WS/event message types, config keys, error codes) is mapped to a spec or registered gap.
- Scratch-first under gitignored `.reverse-spec-scratch/`; promotion to a user-chosen path on
  confirm; never under `openspec/`.
- Methodology adapted (rewritten, not copied) from greenfield (MIT); credited in a `NOTICE`.
- Seeded evaluation fixture (small module with planted explicit/implicit rules + a quirk) to
  measure rule recall/precision; excluded from the published package.
- Out of scope (later tranches): executing the original, golden vectors, hidden duals, blind
  rebuild, sanitization for clean-room use.

## Capabilities

### New Capabilities
- `reverse-spec-for-rebuild`: skill contract for extracting a rebuild package (behavior specs,
  domain model, business-rule catalog, quirks, gaps, completeness report) with per-claim
  provenance and confidence from existing code.

### Modified Capabilities
<!-- none — reverse-spec-from-code behavior is unchanged; it is only referenced -->

## Impact

- New: `packages/openspec-workflow/.pi/skills/reverse-spec-for-rebuild/` (SKILL.md, prompts,
  references/templates, eval fixture), `packages/openspec-workflow/NOTICE`.
- Edited: `packages/openspec-workflow/package.json` (`pi.skills[]`, `files` adds `NOTICE` and
  excludes the eval fixture, description), `README.md`, `AGENTS.md`; root `biome.json` (exclude
  the eval fixture, which carries a deliberate planted defect).
- No runtime code, server, client, or extension changes. No migration; rollback = remove the skill
  directory and `pi.skills[]` entry. `reverse-spec-from-code` untouched.

## Discipline Skills

- `scenario-design` — designing the seeded eval fixture: which explicit/implicit rules, state
  transitions, boundary values and the planted quirk the extractor must recover.
- `security-hardening` - target code is untrusted input read by subagents (prompt injection
  via comments/strings); prompts treat code as data, and promotion paths are resolved and
  confined (no writes under `openspec/`).
- `review-code` - inline review of the prompt/skill change before commit.
- No performance, observability, or irreversible-step triggers: the skill never executes target
  code in this tranche and writes only to gitignored scratch until a confirmed promotion.
