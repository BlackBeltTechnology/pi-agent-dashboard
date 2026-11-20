## 1. Tests first (`packages/server/src/__tests__/directory-service-readiness.test.ts`)

- [ ] 1.1 Add failing case: only `<cwd>/.agents/skills/openspec-explore/` exists → `hasOpenSpecSkills: true`, readiness not `missing-skills`
- [ ] 1.2 Add failing case: worktree whose main checkout has only `.agents/skills/openspec-explore/` → `hasOpenSpecSkills: true`
- [ ] 1.3 Add case: neither location present → `STALE` / `missing-skills`; legacy `.pi/skills` only still → `true` (regression guard)
- [ ] 1.3b Add case: null config root + `<cwd>/.agents/skills/openspec-explore/` → `false` (mirror E20 at `directory-service-readiness.test.ts:371`; second probe must also respect the refusal)
- [ ] 1.4 Run the file; confirm 1.1/1.2 fail

## 2. Implementation

- [ ] 2.1 `packages/server/src/directory-service.ts` `hasOpenSpecSkillsFor`: stat `.pi/skills/openspec-explore` then `.agents/skills/openspec-explore` under the config root (short-circuit); keep `null`-root refusal
- [ ] 2.2 Update doc comments: `directory-service.ts` (`hasOpenSpecSkillsFor`), `packages/server/src/openspec/readiness.ts:40`, `packages/shared/src/types.ts:1414`
- [ ] 2.3 Re-run the readiness tests; all green

## 3. Docs and spec

- [ ] 3.1 Sync `packages/server/src/openspec/AGENTS.md` row text if it names `.pi/skills` only (grep first)
- [ ] 3.2 Delegate to DocScribe (caveman style): `docs/architecture.md` `hasOpenSpecSkills` paragraph (~3104: both layouts, committed-shared rationale, null root → `false` not cwd fallback) and `docs/faq.md` `missing-skills` bullet (~3377: skills at `.pi/skills/` or `.agents/skills/`; Update still writes `.pi/skills/` via `--tools pi`)
- [ ] 3.3 `openspec validate fix-openspec-readiness-shared-skills --strict`

## 4. Verify

- [ ] 4.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`; grep summary
- [ ] 4.2 `npx tsx .pi/skills/implement/scripts/restart-server.ts` (server change)
- [ ] 4.3 Manual (after the 4.2 restart, on a fresh poll — not a carried payload): project with only `.agents/skills/openspec-explore/` shows the OpenSpec board, no "skills missing" pill
- [ ] 4.4 Run `review-code` before commit
