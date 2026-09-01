# SKILL.md — index

Pull-only condensed map. Source: packages/openspec-workflow/.pi/skills/spec-coherence-check/SKILL.md. Trigger → sweep phase → severity/status → action.

## Meta
- Skill name — `spec-coherence-check`. Sweeps active OpenSpec proposals for staleness/conflicts/obsolescence vs codebase + archive.
- Trigger — proposals may be outdated, cross-proposal conflicts, before batch of implementations. Requires openspec CLI + git.
- Input — `--proposal <name>` = single mode; no args = full sweep.
- Output — gap-analysis report + `.pi/proposal-queue.json`; auto-fix trivial, guided conversation for complex.

## Phase 1: Sweep Report
- Step 1 gather — `openspec list --json`; `ls openspec/changes/archive/`. Date each proposal: git first-commit `git log --follow --diff-filter=A --format='%ai' -- "openspec/changes/<name>/proposal.md" | tail -1` → birthtime macOS `stat -f "%SB" -t "%Y-%m-%d"` / Linux `stat -c "%W"` → oldest archive date floor. Read artifacts that exist: proposal.md (always), design.md, tasks.md, specs/. Extract referenced files (`src/...`), capabilities, assumptions, Impact files.
- Step 2 file existence — `find src/ -path "*<filename>" -o -name "<filename>" 2>/dev/null`. Missing → severity `stale`, autoFixable true. Find move: `rg -l "<key-term>" src/ --type ts`.
- Step 3 archive impact — archives dated after proposal creation. File overlap → `stale` autoFixable; capability overlap; `BREAKING` marker → `broken` autoFixable false.
- Step 4 concept validity — verify "Currently X does Y" via `rg "<pattern>" src/ --type ts -l`; Non-Goal now implemented → invalidated. Fundamental break → `broken`; minor ref → `stale`.
- Step 5 obsolescence — `ls openspec/specs/ | grep "<kw>"`; `rg -l "<kw>" src/ --type ts`; `ls -la <planned-new-file>`. Feature exists → `obsolete`.
- Step 6 cross-proposal conflicts — skip in single mode. File-touch matrix; 2+ proposals same file. Additive → low; modify same area → medium; architectural clash → high. Suggest ordering/scope fix.
- Step 7 priority — Base 50. −20 ok, −15 trivial, −10 no conflicts, −10 no deps, −5 <5 files. +20 broken, +15 others depend, +10 fundamental, +5 conflicts. Complexity: trivial 1-2 files isolated / minor <5 files / major cross-cutting protocol / fundamental architecture. Dependency override A-after-B → A.priority > B. Obsolete → 999. Empty dir → status `empty`, priority 999. Sort ascending.
- Step 8 report — `## Coherence Sweep Report — <YYYY-MM-DD>`. Summary table Proposal|Status|Issues|Complexity|Priority|Created. Legend ✅ OK ⚠️ STALE 🔴 BROKEN 💀 OBSOLETE 📭 EMPTY. Conflicts table + suggested implementation order + detailed issues (flagged only; 10+ proposals → summary first).
- Step 9 queue file — write `.pi/proposal-queue.json`; read existing first, preserve user `notes` fields. Schema: references/proposal-queue-schema.md. Fields: lastChecked (ISO), lastSweepSummary, proposals, conflicts. Announce "Wrote `.pi/proposal-queue.json` with N proposals, M conflicts."

## Phase 2: Individual Triage
- AskUserQuestion — "Which proposals...?" Pick flagged names, 'all' in priority order, or 'none' stop.
- STALE auto-fix — show fix (Old/New) BEFORE applying; apply edit; `openspec validate <name>`; status → ok.
- BROKEN guided convo — present In your proposal / In reality / Caused by; options A simplify, B preserve intent, C defer (note "Deferred: ... — needs investigation"), D obsolete (all D → suggest archive). Scope change → offer openspec-ff-change regenerate. `openspec validate <name> --strict`; update JSON.
- OBSOLETE — evidence → confirm → `openspec archive <name> --skip-specs --yes`; remove from queue. Rejected → status ok/stale + note.
- CONFLICT — show both proposals + suggested resolution; AskUserQuestion ordering; update both entries: dependsOn, priorities, notes.

## Gotchas
- Untracked proposals — birthtime fallback; stat fails → oldest archive floor.
- Empty changes (e.g. electron-embedding) — status `empty`, priority 999, skip detection.
- Partial artifacts — detect only existing; missing optional design/tasks not issues.
- Archive dates — parse first 10 chars only (`YYYY-MM-DD-<name>`).
- False positives — prefer STALE < BROKEN < OBSOLETE; every issue cites evidence, never flag without.
- Large sweeps — process proposals sequentially.
- stat — macOS `-f "%SB"`, Linux `-c "%W"`.

## Guardrails
- Never modify artifacts without showing change first — auto-fixes included.
- Never auto-fix BROKEN — human judgment required; only STALE autoFixable true.
- Never archive without confirmation.
- Always run `openspec validate` after any artifact modification.
- Preserve user notes when rewriting `.pi/proposal-queue.json`.
- Ground all claims in evidence; no evidence → don't flag.
- Respect single-proposal mode — no other proposals, no conflict detection.
