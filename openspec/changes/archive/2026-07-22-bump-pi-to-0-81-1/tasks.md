## 1. Bump the source-of-truth pins (move together)

- [x] 1.1 `packages/server/package.json` dependency `@earendil-works/pi-coding-agent` → `^0.81.1`
- [x] 1.2 `docker/Dockerfile` global install → `@earendil-works/pi-coding-agent@0.81.1`
- [x] 1.3 `scripts/verify-release-deps.mjs` pi rule `minVersion` → `0.81.1` (+ refreshed evidence note)
- [x] 1.4 `packages/server/package.json` `piCompatibility.recommended` `0.78.0 → 0.81.1` (track upstream); `minimum` stays `0.78.0` (broad floor)

## 2. Re-resolve the lockfile

- [x] 2.1 `pnpm install` → `pnpm-lock.yaml` resolves server pi to 0.81.1
- [x] 2.2 `pnpm-workspace.yaml` gains `minimumReleaseAgeExclude` entries for the fresh 0.81.x pi packages

## 3. Scan upstream range 0.80.10 → 0.81.1

- [x] 3.1 Confirm no `Breaking Changes` entries in the range
- [x] 3.2 New 0.81.0 Qwen Token Plan providers auto-surface via derived catalogue (`provider-register.ts`) — no bridge change
- [x] 3.3 Confirm pi `engines.node` unchanged (`>=22.19.0`) — no Electron bundled-Node change

## 4. Spec + docs

- [x] 4.1 Update `docker/AGENTS.md` pi pin row → `@0.81.1`
- [x] 4.2 Add `## [Unreleased]` CHANGELOG entry
- [x] 4.3 Delta `pi-core-version-check`: `recommended` tracks pinned runtime, `minimum` stays broad

## 5. Verify

- [x] 5.1 `node scripts/verify-release-deps.mjs` exits 0 (6 rules pass)
- [x] 5.2 Full suite green (1122 files / 11065 tests, 0 failures)
- [x] 5.3 Key suites pass: version-skew, agent-settled, provider-register, bundled-node-meets-pi-floor (latter reads `minimum` only — unaffected)
- [x] 5.4 `packages/server/node_modules` pi = 0.81.1; global pi = 0.81.1
- [x] 5.5 Real-spawn smoke: headless pi 0.81.1 loads the working-tree bridge — clean load, no pi-ai symbol break
