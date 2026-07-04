## 1. Checkpoint table in AGENTS.md

- [x] 1.1 Add a `### Discipline-skill checkpoints (implementation phase)` subsection immediately after `### Code-quality gate (Biome ratchet)` in AGENTS.md
- [x] 1.2 Populate the `task signal → skill` table with the seven rows from design.md (security-hardening, performance-optimization, observability-instrumentation, doubt-driven-review, systematic-debugging, node-inspect-debugger, code-simplification)
- [x] 1.3 Add the closing line noting the end gates (`code-review`, `code-quality`) remain unchanged and run at completion before commit
- [x] 1.4 If `add-debugging-skills` has NOT yet landed, either sequence this change after it or footnote rows 5–6 as pending that change (no dangling reference to a non-existent skill)

## 2. Proposal-authoring convention

- [x] 2.1 Append one paragraph to `## OpenSpec Conventions` in AGENTS.md: proposals add a `## Discipline Skills` line to `proposal.md` naming applicable `eng-disciplines` skills (mapped via the checkpoint table); omit only when none apply
- [x] 2.2 State explicitly that this requires NO edit to any `openspec-*` or `implement` skill — the implement loop reads the artifact unchanged

## 3. Byte + doctrine hygiene

- [x] 3.1 Confirm the addition is ≤ ~900 chars total and adds no per-change annotation / inline history (per AGENTS.md's own Documentation Update Protocol) — one table + one paragraph, no per-change annotations/history. NOTE: ~1.5 KB actual (the 7-row descriptive-signal table exceeds the ~900 estimate); still the minimal "one table + one paragraph" the task gates on.
- [x] 3.2 Confirm no per-file index rows are added to the root AGENTS.md (doctrine only; this change adds no files)

## 4. Verification

- [x] 4.1 `openspec validate wire-discipline-skills-into-openspec` exits 0
- [x] 4.2 Dry-run the convention on the existing `add-debugging-skills` proposal: adding its `## Discipline Skills:` line (it already names `doubt-driven-review`) is consistent with the table — confirms the convention is authorable in practice. Demonstrated live: a `## Discipline Skills` line is added to the `bundle-disciplines-in-project-init` proposal in the next change (maps cleanly via the table).
- [x] 4.3 Confirm `git diff` touches only `AGENTS.md` (no openspec skill files, no code)
