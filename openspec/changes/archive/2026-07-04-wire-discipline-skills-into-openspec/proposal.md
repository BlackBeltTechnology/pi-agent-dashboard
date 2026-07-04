## Why

The `eng-disciplines` skills (`security-hardening`, `performance-optimization`, `observability-instrumentation`, `doubt-driven-review`, `code-simplification`, and — once `add-debugging-skills` lands — `systematic-debugging`, `node-inspect-debugger`) auto-trigger on natural-language phrases. But the openspec implementation loop (`openspec-apply-change` → `implement`) may never *utter* those phrases, so the situational disciplines stay dormant through a whole change. Only the end-of-loop gates (`code-review`, `code-quality`) are wired into AGENTS.md today; the *mid-loop* disciplines are not.

We want the disciplines to fire at the right moments during openspec implementation **without editing any openspec skill**. The lever already exists: `openspec-apply`/`implement` reads the proposal artifacts (`proposal.md`, `tasks.md`) into its working context. If a proposal *names* the applicable discipline skills, those names enter the implement loop's context and the agent invokes them. AGENTS.md governs how proposals are authored, so the entire wiring lives in doctrine + the proposal artifact schema — the openspec skills keep reading artifacts unchanged.

Two reinforcing, AGENTS.md-only levers:

- **Checkpoint table** (always-on doctrine): a compact `task signal → skill` map so the mapping is in view during any implementation, openspec or ad-hoc.
- **Proposal-authoring convention** (artifact carrier): every proposal declares a `## Discipline Skills` line; the implement loop reads it and the skill names seed invocation. This is the "integrated into openspec proposals without touching openspec itself" mechanism.

## What Changes

- Add a `### Discipline-skill checkpoints (implementation phase)` subsection to `AGENTS.md`, adjacent to the existing Code-review / Code-quality gate subsections, containing a `task signal → skill` table covering the seven `eng-disciplines` skills and noting that the end gates (`code-review`, `code-quality`) remain as-is.
- Append one paragraph to `AGENTS.md` `## OpenSpec Conventions`: when authoring a proposal, add a `## Discipline Skills` line to `proposal.md` naming the skills its tasks will trigger (mapped via the checkpoint table); omit only when none apply.
- **No openspec skill files are modified** (`.pi/skills/openspec-*`, `implement` untouched). No code. No new dependency.
- **Non-goals**: no changes to the `eng-disciplines` skill bodies; no enforcement tooling / lint that fails a build when the `## Discipline Skills` line is missing (advisory convention only, matching how the CodeRabbit gate warns-and-continues); no retroactive edit of already-archived proposals.

## Dependency

The checkpoint table's last two rows reference `systematic-debugging` and `node-inspect-debugger`, which are added by the `add-debugging-skills` change. This change SHOULD land after `add-debugging-skills`, or those two rows are added in the same landing. The other five rows reference already-shipped `eng-disciplines` skills and stand alone.

## Capabilities

### New Capabilities

- `openspec-discipline-wiring`: AGENTS.md carries a task-signal→discipline-skill checkpoint table for the implementation phase, and a proposal-authoring convention that makes proposals declare their applicable discipline skills so the openspec implement loop invokes them — achieved without modifying any openspec skill.

### Modified Capabilities

(none)

## Impact

- **Modified**: `AGENTS.md` only (~900 chars added to always-on context: one table + one paragraph).
- **Context cost**: the table is exactly the "cross-cutting rule every agent needs every turn" that AGENTS.md's own Documentation Update Protocol names as the rare legitimate reason to add doctrine here. It converts six-to-seven dormant skills into reliably-invoked ones during implementation; the byte cost is justified by that conversion.
- **No openspec coupling**: `openspec-apply`, `implement`, and the `openspec-*` skills read artifacts unchanged; only the proposal artifact schema gains an optional declared section.
- **Advisory, not gating**: a missing `## Discipline Skills` line never blocks; consistent with the warn-and-continue posture of the existing review gate.
