# Tasks — CodeRabbit implementation-phase review gate

> Implementation landed in-session; completed items checked. Remaining items are
> docs/tests follow-ups and the deferred hook.

## 1. code-review skill enhancement

- [x] 1.1 Enhance `.pi/skills/code-review/SKILL.md` → v0.2.0: severity triage + nit cap, `--agent` NDJSON parsing, dev-loop fix cycle, diff-scoping table (real v0.5.2 flags), usage-limits section → verify: skill loads; flags match `coderabbit review --help`.

## 2. review-changes.ts (the gate)

- [x] 2.1 Add `.pi/skills/implement/scripts/review-changes.ts` — runs `coderabbit review --agent -t uncommitted`, parses findings, severity summary; advisory (exits 0); honours `--no-review` / `SKIP_CR_REVIEW=1` + passthrough flags → verify: `tsc --strict --noEmit` clean.
- [x] 2.2 Verify skip paths and finding-parser → verify: `SKIP_CR_REVIEW=1` and `--no-review` exit 0 with skip message; parser buckets a sample NDJSON correctly (garbage lines ignored, severity matched).
- [x] 2.3 Extract pure parser to `parse-findings.ts` (`parseFindings` + `splitFindings`); add `scripts/__tests__/review-changes-parser.test.mjs` → verify: `vitest run` green (5 tests) covering event-filtering, malformed-line skip, empty input, severity bucketing.

## 3. Keep full-rebuild deploy-only

- [x] 3.1 Revert review logic from `.pi/skills/implement/scripts/full-rebuild.ts`; header note points to `review-changes.ts` → verify: `tsc` clean; script still build→restart→reload only.

## 4. Wire into implement skill + AGENTS.md

- [x] 4.1 Add "Review gate — before commit (server-independent)" section to `.pi/skills/implement/SKILL.md`; clarify full-rebuild is deploy-only → verify: section references `review-changes.ts` and the `code-review` skill.
- [x] 4.2 Add "Code-review gate (implementation phase)" subsection to `AGENTS.md` under Build & Restart Workflow → verify: deploy-vs-review distinction present; warn-and-continue documented.

## 5. Docs

- [x] 5.1 Add file-index rows for `review-changes.ts`, `parse-findings.ts`, the test, updated `full-rebuild.ts` + `code-review` skill in `docs/file-index-skills-misc.md`, caveman style, alphabetical → verify: rows present; delegated to docs subagent per Documentation Update Protocol.

## 6. Deferred (out of scope v1)

- [~] 6.1 **DEFERRED (out of scope v1):** pi commit-time hook that fires `review-changes.ts` even when not run manually → verify: hook runs on commit; advisory only. Tracked for a future change; not blocking this ship.
