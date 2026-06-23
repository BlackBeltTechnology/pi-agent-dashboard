# Tasks — Research-doc home + skill-plugin

> Implementation already landed in the working tree; tasks are checked to reflect
> actual state and set the change up for verify/archive.

## 1. Consolidate docs into one home

- [x] 1.1 `git mv` all 9 docs from `docs/{plan,plans,research,architecture-notes}/` into `docs/research/` (flat) → verify: `ls docs/research/` shows 9 docs + README; git records renames.
- [x] 1.2 Remove the three now-empty dirs (`plan/`, `plans/`, `architecture-notes/`) → verify: none exist.

## 2. Index the home + record the convention

- [x] 2.1 Write `docs/research/README.md` — intro (what belongs vs design.md) + index table (title · summary · status) + "adding a document" steps, normal prose → verify: all in-table links resolve.
- [x] 2.2 Add one row to `docs/file-index.md` ▸ "Standalone topic docs" pointing at `docs/research/README.md` → verify: row present.
- [x] 2.3 Add one rule to `AGENTS.md` ▸ OpenSpec Conventions (rationale → design.md; evergreen → docs/research/ + reference from proposal.md) → verify: `grep docs/research/ AGENTS.md` matches.

## 3. Ship the research-doc-synthesis skill-plugin

- [x] 3.1 Create `packages/research-doc-skill/package.json` — scoped name, `version: 0.5.4` (lockstep), `pi.skills: [".pi/skills/research-doc-synthesis"]`, `files: [".pi/skills/", "README.md"]` → verify: `npm pkg get name --workspace=@blackbelt-technology/pi-dashboard-research-doc-skill` resolves.
- [x] 3.2 Write `.pi/skills/research-doc-synthesis/SKILL.md` — frontmatter (name, description) + when-to-use table + fan-out procedure + stable skeleton + pitfalls + verification → verify: frontmatter has name + description.
- [x] 3.3 Write `packages/research-doc-skill/README.md` (package overview) → verify: file exists.
- [x] 3.4 `npm install --package-lock-only` to register the workspace → verify: package-lock.json contains `pi-dashboard-research-doc-skill`.

## 4. References + housekeeping

- [x] 4.1 Fix the 2 live inbound refs to moved docs (`fix-electron-auto-update-pipeline/design.md`, `jj-plugin-server-driven-flows/tasks.md`) and the internal cross-ref in `command-palette-future.md` / `openspec-jj-bridge.md` self-ref → verify: no live non-archive, non-worktree refs to the old paths.
- [x] 4.2 Add a row for `packages/research-doc-skill/` to `docs/file-index-plugins.md` → verify: row present.

## 5. Verification

- [x] 5.1 `openspec validate add-research-doc-home-and-skill --strict` passes.
- [ ] 5.2 New session (or `npm run reload`) lists `research-doc-synthesis` in available skills.
- [ ] 5.3 (Optional) Run the skill once end-to-end to produce a real `docs/research/` doc, validating v1.
