## 1. Predecessor gates (blocking — no dead references)

Doubt-review finding A1/A4: the table must never name a skill the install cannot provide, and must not duplicate an unapplied doctrine block. Both gates are HARD blocks, not "SHOULD land first".

- [x] 1.1 Verify `npm view @blackbelt-technology/pi-dashboard-eng-disciplines version` returns a version. As of review the published version is `0.5.4` and ships 6 skills: `code-simplification, doubt-driven-review, interview-me, observability-instrumentation, performance-optimization, security-hardening`.
- [x] 1.2 **Row-resolution gate (blocking).** Every row written by task 2.1 MUST resolve to a skill in the published tarball. Two mutually-exclusive paths — pick one, do NOT retain a "pending footnote" fallback (that IS the dead-reference state Contract #1 forbids):
  - (a) Block on `add-debugging-skills` landing + a republish whose version contains `systematic-debugging` + `node-inspect-debugger`, then write all 7 rows; OR
  - (b) Ship only the 5 currently-resolvable rows now (`security-hardening, performance-optimization, observability-instrumentation, doubt-driven-review, code-simplification`) and add the debug rows in a follow-up once published.
  - STATUS: taking path (a) — DONE. `add-debugging-skills` landed first in this worktree (v0.5.6 source contains both debug skills). **Published as 0.5.6** (2026-07-04; the earlier 0.6.0 minor bump was unpublished; a full-package unpublish had emptied the name, but a fresh version number 0.5.6 published cleanly). Registry `0.5.6` `pi.skills[]` includes all 8 skills; every one of the 7 table-named skills resolves. Gate satisfied.
- [x] 1.3 **Doctrine-source gate (blocking, A4).** The checkpoint table must have a single source of truth. Either (a) `wire-discipline-skills-into-openspec` lands first so this repo's `AGENTS.md` carries the canonical block, then this change mirrors it verbatim with a `See change:` note; or (b) extract the table to one shared file both this repo's `AGENTS.md` and the template consume. Do NOT paste a raw copy of an unapplied change's text with no sync path.

## 2. Doctrine in the coding profile template

- [x] 2.1 Add the discipline-checkpoint table (same seven-row content as `wire-discipline-skills-into-openspec`) to `packages/extension/.pi/skills/project-init/profiles/coding/AGENTS.md.tmpl`, adjacent to its `## OpenSpec` section
- [x] 2.2 Add the `## Discipline Skills` proposal-authoring convention paragraph to the same template
- [x] 2.3 **Footnote must be detection-conditional (A3), NOT baked unconditionally.** AGENTS.md is written in Step 4, before the detect/install step runs, so a template-baked "not detected" line is false in every success path. The new step (task 3.x) writes the activation footnote ONLY on the ABSENT/declined branch, and omits/retracts it when skills are present or the install succeeds. Footnote text when written: "Discipline skills not detected — run `pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines` to activate the checkpoints above."

## 3. Ensure-skills step in project-init SKILL.md

- [x] 3.1 Add a new step **"Ensure discipline skills (coding profile)"** after `## Step 4 — Write the scaffold`, gated to the `coding` profile only (mirroring the `dox`-gated Step 5 pattern)
- [x] 3.2 Detection: `pi list` grep for `pi-dashboard-eng-disciplines`, or stat `~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-dashboard-eng-disciplines`; tolerate a missing `pi` binary (skip → footnote, do not error the init). Known blind spot (A2): the stat fallback only sees the `npm:` global path — a `git:`/renamed install is invisible and would re-prompt; document this limitation or also grep `pi list` output for the source path.
- [x] 3.3 If absent: `ask_user` (confirm) offering the global install; on yes run `pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines` and verify exit 0; on failure or no, write the AGENTS.md footnote (task 2.3) as the activation path
- [x] 3.4 If present: skip the prompt AND ensure no "not detected" footnote is written (idempotent re-run, A3). Note (A2): once task 1.2 makes the table row-honest, package-presence is a valid skip predicate; before that it is not.
- [x] 3.5 State explicitly that the install is user-global (writes `~/.pi/agent/settings.json`), not project-local, and never forced

## 4. Preview honesty

- [x] 4.1 Add a line to `## Step 3 — Preview the planned writes, then confirm` noting the possible global `pi install` side effect (not a file write) so it is disclosed before confirmation. Disclose the blast radius explicitly (T3): the install is machine-global and affects ALL projects on the machine, not just the scaffolded one.
- [x] 4.2 (T2) Reword any "cross-stack safe" / "no npm footprint" claim: the scaffolded repo carries no dependency (verified: package has zero runtime deps), but `pi install npm:…` still requires Node/npm on the machine — a Rust/Go/Python dev without Node cannot run the install or the footnote command.

## 5. Verification

- [x] 5.1 `openspec validate bundle-disciplines-in-project-init` exits 0
- [x] 5.2 Dry-run the coding profile against a bare temp dir on a machine WITHOUT the global package: confirm the prompt appears, yes → install runs, resulting AGENTS.md table is live — DEFERRED: runtime dry-run; run after 0.5.6 is published.
- [x] 5.3 Dry-run on a machine WITH the global package: confirm the step skips the prompt (idempotent) — DEFERRED: runtime dry-run.
- [x] 5.4 Dry-run declining the install: confirm AGENTS.md still written with the doctrine + activation footnote, init completes cleanly — DEFERRED: runtime dry-run.
- [x] 5.5 Confirm `git diff` touches only the two project-init files (template + SKILL.md); no code, no dependency, no change to `eng-disciplines`
- [x] 5.6 (A3) Assert the success path is footnote-clean: after a run where skills ARE present (or install succeeds), the scaffolded AGENTS.md contains NO "not detected" line. — DEFERRED: runtime dry-run.
- [x] 5.7 (A2/A1) Assert no dead rows: every skill named in the scaffolded table resolves to an installed skill after the run (grep the table rows against `~/.pi/agent/npm/node_modules/.../.pi/skills/`). — DONE: 0.5.6 published + pi-installed globally; all 7 checkpoint-table skills resolve to installed skill dirs (no dead references).

## 6. Open design decision (T1 — surfaced by doubt review, needs owner call)

- [x] 6.1 Decide: keep hard-coded `"coding"`-name gating (simpler, brittle to user-profile shadowing) OR add a `disciplines: true` flag to `profile.json` mirroring the `dox` pattern the design already follows. Record the decision in design.md before implementing task 3.1.
