## Discipline Skills: doubt-driven-review

## Why

`wire-discipline-skills-into-openspec` teaches *this* repo to invoke the `eng-disciplines` skills during openspec implementation. But every *new* project scaffolded by the `project-init` skill starts blank: its `coding` profile writes an `AGENTS.md` with a `## OpenSpec` section and TDD/simplicity doctrine, yet nothing about the discipline checkpoints, and the `eng-disciplines` skills are not present at all. So the wiring benefits one repo and no one else.

The `eng-disciplines` package is a published, runtime-free pi package (`@blackbelt-technology/pi-dashboard-eng-disciplines`, `publishConfig: public`). Pi already supports user-global packages via `pi install npm:…` written to `~/.pi/agent/settings.json`, which makes a package's skills available in **every** project. That is the clean delivery path for a stack-agnostic profile (`coding` supports Node/Rust/Go/Python/Java) — global install, not per-project vendoring, so there are no skill copies to drift and no npm dependency forced onto a non-Node repo.

This change makes `project-init`'s `coding` profile:

1. **Seed the doctrine** — write the discipline-checkpoint table + the `## Discipline Skills` proposal convention into the scaffolded `AGENTS.md` (mirroring what `wire-discipline-skills-into-openspec` adds to this repo).
2. **Ensure the skills exist** — detect whether `eng-disciplines` is installed globally; if not, offer (via `ask_user`) to `pi install` it user-globally so the checkpoint table is not a set of dead references. Declining degrades gracefully: the doctrine still lands with a one-line "activate later" note.

## What Changes

- Add a discipline-checkpoint table + `## Discipline Skills` proposal convention to `packages/extension/.pi/skills/project-init/profiles/coding/AGENTS.md.tmpl`, adjacent to its existing `## OpenSpec` section.
- Add a new step to `packages/extension/.pi/skills/project-init/SKILL.md` — **"Ensure discipline skills (coding profile)"** — that runs after the scaffold write:
  - Detect: `pi list` (or presence under `~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-dashboard-eng-disciplines`).
  - If absent: `ask_user` (confirm) to install; on yes run `pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines` (user-global); on no, proceed and rely on the AGENTS.md "activate later" note.
  - Gate the step to the `coding` profile only (skip for `docs` / OpenSpec-off profiles).
- Preview the potential install in Step 3 ("Preview the planned writes, then confirm") so the user sees it before anything runs.
- **Non-goals**: no vendoring of skill files into scaffolded projects (Option B rejected — see design.md); no change to the `docs` profile; no forced install (always opt-in via `ask_user`); no change to `eng-disciplines` skill bodies; no new capability added to the profile *schema* beyond the profile-scoped step (the step is described in SKILL.md prose, consistent with how existing profile-specific steps like the DOX seed are gated).

## Prerequisite

`pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines` only succeeds if the package is published to npm. This change MUST verify publication (`npm view @blackbelt-technology/pi-dashboard-eng-disciplines version`) before the profile references the install command; if unpublished, publication is a blocking predecessor task. The two debugging skills from `add-debugging-skills` should be included in that published version so the checkpoint table's `systematic-debugging` / `node-inspect-debugger` rows resolve.

## Capabilities

### New Capabilities

- `project-init-discipline-bundle`: the `coding` profile scaffolds the discipline-checkpoint doctrine into new projects and ensures the `eng-disciplines` skills are available by detecting a global install and offering to `pi install` it when missing, degrading gracefully on decline — so a freshly-initialized project can invoke the disciplines during openspec implementation with no manual setup.

### Modified Capabilities

(none)

## Impact

- **Modified**: `project-init/profiles/coding/AGENTS.md.tmpl` (doctrine block), `project-init/SKILL.md` (one new gated step + a Step 3 preview line).
- **Runtime**: at init time, one `ask_user` prompt + at most one `pi install` invocation when the user consents and the package is absent. Idempotent — re-running init on a machine that already has the global install skips straight through.
- **Cross-stack safe**: global install carries no dependency into the scaffolded repo; a Rust/Go/Python project gets the skills without an npm footprint.
- **Graceful degradation**: declining the install still writes the doctrine; the table footnotes `pi install …` to activate — collapses to a harmless doctrine-only state rather than dead references.
- **Depends on**: `add-debugging-skills` (adds two of the seven referenced skills) and `wire-discipline-skills-into-openspec` (the doctrine block this profile mirrors). Both SHOULD land first, and the published `eng-disciplines` version SHOULD include the two new skills.
