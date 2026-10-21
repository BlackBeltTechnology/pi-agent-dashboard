# SKILL.md — ship-it index

Pull-only condensed map. Source: .pi/skills/ship-it/SKILL.md. Worktree implementation orchestrator for an OpenSpec change: apply → merge develop → harness → enforcers → CodeQL → review → ship-change.

Triggers: "ship it", "build and ship this change", "run ship-it", "implement + test + land in the worktree". Twin of `plan-proposal`.

## Preconditions
- Run inside `.worktrees/os-<change>`, branch `os/<change>`. Needs `docker`.

## Pure logic (vitest project)
- `scripts/manifest.ts`: `parseManifest`, `deferDecision`, `filesystemRealityCheck`.
- `scripts/no-weakening.ts`: `assertNoWeakening`.
- `scripts/review-gate.ts`: `reviewRoundDecision`, `parseReviewReply`, `resolveReviewer`, `classifyFindings`, `REVIEW_TIMEOUT_MS`.
- `scripts/fix-ledger.ts`: `validateFixLedger`; `review-state.ts`: `deriveReviewState`; `review-prompt.ts`: `buildReviewPrompt` + CLI.
- CodeQL ratchet: `scripts/codeql-local.mjs` (`docs/code-quality.md`).

## Step 1 — Orient / entry gate
- `openspec/changes/<change>/SHIP_IT_BLOCKED.md` exists → prior hand-back.
  - Headless (no `ask_user`) → exit non-zero.
  - Interactive → `ask_user` resume/abort. Resume: copy file to run dir, remove original.
- `openspec status --change <change> --json` = orientation only. Never trust `- [x]`.
- `automated` row satisfied only if test file exists AND passes in harness.

## Step 2 — Apply
- Non-`manual-only` tasks remain → `openspec-apply-change`.
- Inject harness-exemplar path per folded test task.

## Step 2.5 — Merge develop
- `git fetch origin develop && git merge --no-edit origin/develop` (remote ref; merge, not rebase).
- Conflict → `git merge --abort` + STOP. Trivial: AGENTS.md union-keep; `pnpm-lock.yaml` → `git checkout --theirs` + `pnpm install --lockfile-only`.

## Step 3 — Harness
- `trap cleanup EXIT` → `docker/test-down.sh`.
- `docker/test-up.sh -d --build`; port `jq -r '.dashboardPort' .pi-test-harness.json`. Never `:18000`.
- `PW_E2E_USE_RUNNING=1 npm run test:e2e`.
- `test-up.sh` refuses if `(n+1) × MEM_LIMIT >= MemTotal` (default `4g`). Override `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1`. Bound local run with `--global-timeout`.

## Step 4 — Red-test fix loop (ship-it owns it)
- Never re-invoke `apply` on checked task.
- No-change cycle → STOP → escape.
- Test edit: `assertNoWeakening` on `git diff -- <test-file>`; `ok:false` (added `.only`/`skip`, deleted assertion, strong→permissive matcher) → REJECT.

## Step 4.4 — Enforcers (worktree root, no model call)
- `node scripts/check-conventions.mjs --base origin/develop`
- `node scripts/check-plugin-boundary.mjs` (core/plugin import ratchet; NEW edge or STALE allowlist row fails)
- `node scripts/dox-byte-gate.mjs`
- `node scripts/i18n-lint.mjs --strict` (`--strict` required)
- `node scripts/i18n-parity.mjs`
- `node scripts/knip-config.mjs` (roots manifest entries; run first)
- `node scripts/knip-ratchet.mjs` (~8s)
- `node scripts/knip-ratchet.mjs --check-baseline-diff origin/develop` (ceiling not raised; rejects deleted class)
- `node scripts/codeql-local.mjs --check-baseline-diff origin/develop` (static)
- `--base` mandatory. Non-zero → fix loop; 4.5 skipped. Not in `quality:changed`.

## Step 4.4b — CodeQL ratchet (no model call)
- `npm run codeql -- --json`: exit 0 pass/skipped · 1 new alerts · 2 error.
- `CODEQL SKIPPED: <cause>` → record, closing check, continue.
- `staleEntries` → `node scripts/codeql-local.mjs --prune`; `git add codeql-baseline.json`.
- New alerts headless → `SHIP_IT_BLOCKED.md`; exit non-zero.
- New alerts interactive → `ask_user` per alert (>5 → one batch): fix / `accepted-risk: …` / `false-positive: …` / `operator-authz` (ONLY for `js/path-injection`, `js/command-line-injection`, `js/shell-command-constructed-from-input`).
- Accept: `node scripts/codeql-local.mjs --accept <ruleId> <file> <lineHash> --reason "<reason>"`; `git add codeql-baseline.json`. Accepts before fixes.
- Exit 2 → interactive retry/abort; headless block.
- Closing check: `--check-baseline-diff origin/develop` (`--no-growth` headless). Violation → revert/abort or block.
- Never hand-edit `codeql-baseline.json`; only `--prune` / `--accept`.

## Step 4.5 — Local review (unconditional)
- Run dir: `$(git rev-parse --git-dir)/ship-it/<change>/<run-id>/`; `RUN=$(CLI --new-run --change <change>)`; CLI = `npx tsx .pi/skills/ship-it/scripts/review-prompt.ts`.
- Files: `review-r<N>.md`, `.attempt-<k>.md`, `fix-ledger-r<N>.json`, `ledger-failures.log`, `approvals.log`.
- 1. `resolveReviewer`: `@review` REQUIRED. No fallback to session default (self-review).
- 2. `CLI --state "$RUN"` → `round`, `approvedExtraRounds`, `malformedRetries`, `ledgerFailures` → `reviewRoundDecision`.
- 3. Commit before each round: `git commit -- <paths>` (explicit paths).
- 4. Prompt: round 1 `CLI --change <c> --round 1`; round N≥2 adds `--prior`, `--ledger`, `--since <sha>`. Pass stdout verbatim. Diff `git diff origin/develop...HEAD`.
- 5. Spawn `Agent` with `model: "@review"`, `subagent_type: "CodeReviewer"`. Never CodeRabbit CLI here.
- 6. Timeout `REVIEW_TIMEOUT_MS` = 300s → checkpoint failure.
- 7. `parseReviewReply`: well-formed → `review-r<N>.md`; malformed → `.attempt-<k>.md`; retry once; second = halt.
- 8. Only `issue(blocking)` `B<n>` re-enters fix loop.
- 9. Per `B` id: reproducing test (or ≥20-char untestable reason) → smallest fix → sibling sweep → re-read hunk → harness + 4.4.
- 10. `fix-ledger-r<N>.json`: `{id, test:{path}|{untestable}, siblings:{searched, sites}, fixedIn}`; no status/verdict. `CLI --validate-ledger --prior ... --ledger ...`.
- 11. `reviewRoundDecision`: cap 2 rounds. `review` → next; `proceed` → 6; `ask` (interactive, cap) → `ask_user` one more round / hand back (`approvals.log`); `escape` → 5.
- 12. `assertNoWeakening` on review fixes; unsatisfiable → escape.

## Step 5 — Escape hatch
- Triggers: `apply` design issue; fix bound exhausted; review `escape`; headless 4.4b stop.
- Leave worktree intact; write `openspec/changes/<change>/SHIP_IT_BLOCKED.md`; exit non-zero. Never headlessly rewrite proposal/design.

## Step 6 — ship-change inline
- Defer (`deferDecision`): `test-plan.md` exists → leftover `- [ ]` deferrable only if `manual-only`. No `test-plan.md` → keyword defer.
- Hold at `ship-change` step 8.5: archive committed + specs synced. Failed → STOP.
- `test-down.sh` BEFORE `ship-change` step 10 (worktree removal).
- Then: archive → commit → PR → CI → CodeRabbit → gate → squash-merge → remove worktree.

## `ask_user` brief
- `message` ≥ 240 chars (`questions.minBriefChars`): task, why asking, per-option outcome.

## Guardrails
- Filesystem reality over checkbox. ship-it owns fix loop. No test weakening. Enforcers before reviewer. CodeQL gates 4.5. Review unconditional, `@review` required. Two-round cap; +1 per human approval only. Prompt generated. Merge develop before harness. No merge/branch delete/worktree removal before archive+sync. Teardown before worktree removal. Never `:18000`. Drive ship-change inline.
