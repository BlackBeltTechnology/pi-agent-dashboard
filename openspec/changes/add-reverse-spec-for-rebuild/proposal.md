## Why

`reverse-spec-from-code` produces kb-searchable behavioral specs, but deliberately strips the
information a team needs to **rebuild** the same business logic from scratch: data shapes,
business rules as rules, implicit behavior, provenance, confidence, and known unknowns. The gap
analysis (`docs/research/reverse-engineering-gap-analysis.md`, tranche 1) ranks these as the
cheapest, lowest-risk gaps to close — prompt/methodology work only — and the prerequisite for the
later characterize (golden vectors) and rebuild-check (blind rebuild) tranches.

## What Changes

- New engineering-discipline skill `reverse-spec-for-rebuild` in `packages/eng-disciplines`
  (code characterization for rebuild is a cross-cutting discipline, not an OpenSpec lifecycle
  step). Self-contained and portable: its own discovery prompt (kb tree when present, else
  manifests/entry points/directories), a built-in structural format check, and `openspec
  validate` as an extra gate only when the OpenSpec CLI and `openspec/` exist.
  `reverse-spec-from-code` stays in `openspec-workflow`, unchanged.
- Emits a **rebuild package** (not kb specs): per-capability behavioral specs plus cross-cutting
  `model.md` (entities), `rules.md` (`BR-NNN`, tagged explicit/implicit), `quirks.md`
  (`QUIRK-NNN`, suspected bugs kept faithful + flagged), `gaps.md` (`GAP-NNN`, registered
  unknowns), and `completeness.md` (entry-point coverage gate report).
- Every claim carries an inline provenance citation (`file:line`) and a confidence level
  (`confirmed` / `inferred` / `assumed`).
- Behavioral specs cover state machines, edge cases, and error handling via fixed checklists.
- Completeness gate: every discovered entry point (tools/commands, env vars, CLI flags, HTTP
  routes, WS/event message types, config keys, error codes) is mapped to a spec or registered gap.
- Scratch-first under `.reverse-spec-scratch/` (asks to add it to `.git/info/exclude` when not
  ignored); promotion to a user-chosen path on confirm; never inside a protected root
  (default `openspec/`, `docs/`, `packages/`, `.pi/`, overridable).
- Methodology adapted (rewritten, not copied) from greenfield (MIT); credited in the package `NOTICE`.
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
- `scenario-design-discipline`: the "ships inside the published eng-disciplines package"
  requirement pins the package's skill count at 9 (already stale at 10); it becomes
  count-agnostic so adding sibling skills no longer contradicts it.

## Impact

- New: `packages/eng-disciplines/.pi/skills/reverse-spec-for-rebuild/` (SKILL.md, prompts,
  references, `scripts/guard.mjs`, eval fixture); package vitest suite
  (`packages/eng-disciplines/vitest.config.ts`, `src/__tests__/`).
- Edited: `packages/eng-disciplines/package.json` (`pi.skills[]`, `files` excludes the eval
  fixture, `test` script, description), `NOTICE` (greenfield credit), `README.md`, `AGENTS.md`;
  root `vitest.config.ts` (project entry) and `biome.json` (exclude the eval fixture, which
  carries a deliberate planted defect).
- `packages/openspec-workflow/README.md`: one-line pointer from `reverse-spec-from-code` to the
  new skill for rebuild use-cases (no skill file changes).
- No runtime code, server, client, or extension changes. No migration; rollback = remove the skill
  directory, its `pi.skills[]` entry, the NOTICE paragraph and the vitest entries. `reverse-spec-from-code` untouched.

## Discipline Skills

- `scenario-design` — designing the seeded eval fixture: which explicit/implicit rules, state
  transitions, boundary values and the planted quirk the extractor must recover.
- `security-hardening` - target code is untrusted input read by subagents (prompt injection
  via comments/strings); prompts treat code as data, and promotion paths are resolved and
  confined (no writes inside protected roots).
- `review-code` - inline review of the prompt/skill change before commit.
- No performance, observability, or irreversible-step triggers: the skill never executes target
  code in this tranche and writes only to gitignored scratch until a confirmed promotion.
