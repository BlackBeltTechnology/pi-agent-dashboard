# Tasks

## 1. Baseline binding

- [ ] 1.1 Test first (`scripts/__tests__/codeql-local-cli.test.mjs`): hand-edit baseline after a run → `--accept`/`--prune` exit 2, baseline unchanged; two accepts after one run still pass; `last-run.json` without `baselineHash` passes (the three spec scenarios).
- [ ] 1.2 `scripts/codeql-local.mjs`: record `baselineHash` in `last-run.json`, check it in `requireFreshRun`, re-record it atomically after prune/accept writes (design D1).
- [ ] 1.3 Update `scripts/codeql-local.mjs.AGENTS.md` row text.

## 2. Local/CI gap

- [ ] 2.1 Reproduce the 29-result gap on one commit and run the D2 variations; record each variation's count in `evidence/local-vs-ci.md` (test-plan: manual-only).
- [ ] 2.2 `ask_user`: align local with CI (a) or keep stricter and document (b); apply the chosen outcome (config change or docs only).
- [ ] 2.3 Via DocScribe: `docs/code-quality.md` states the measured local/CI relationship and the decision.

## 3. Validate

- [ ] 3.1 `openspec validate harden-codeql-ratchet-followups --strict` passes.
- [ ] 3.2 `npm test` green.
