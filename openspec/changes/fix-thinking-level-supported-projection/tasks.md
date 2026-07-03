# Tasks

## 1. Correct the bridge projection

- [x] 1.1 In `packages/extension/src/provider-register.ts`, add a local
      `deriveSupportedThinkingLevels(reasoning, thinkingLevelMap)` helper that
      mirrors pi's `getSupportedThinkingLevels` rule verbatim. (Inlined, not
      imported: pi-ai's shipped `.d.ts` re-exports via `.ts` extensions the repo
      tsconfig cannot follow — no import path resolves the symbol at type-check.)
- [x] 1.2 In `toModelInfo`, replace the `Object.entries(map).filter(v !== null)`
      block with `deriveSupportedThinkingLevels(...)`. Keep the field optional:
      emit `supportedThinkingLevels` only when the model carries enough metadata
      for a meaningful result (reasoning flag present or a `thinkingLevelMap`);
      omit otherwise so the client fallback (all six levels) still applies for
      pre-0.72 models. → verify: unit test below. [x]

## 2. Tests

- [x] 2.1 Update `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts`:
  - sparse reasoning map `{ reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } }`
    → `["off","minimal","low","medium","high","xhigh"]` (Opus case).
  - dense map `{ reasoning: true, thinkingLevelMap: { medium: "medium", high: "high", xhigh: null } }`
    → `["off","minimal","low","medium","high"]` (xhigh disabled).
  - non-reasoning `{ reasoning: false }` → `["off"]`.
  - no map + reasoning true `{ reasoning: true }` → `["off","minimal","low","medium","high"]`
    (xhigh excluded — pi requires an explicit `thinkingLevelMap` entry for xhigh).
  - `→ verify: npm test` for the file passes. [x]

## 3. Spec + gates

- [x] 3.1 `openspec validate fix-thinking-level-supported-projection --strict` passes.
- [~] 3.2 `npm run quality:changed` (biome + tsc + tests). Oracle exits 1 due to
      PRE-EXISTING repo breakage only: 7 `tsc` errors in `packages/image-fit-extension`
      (jimp, present on clean HEAD) + biome `--error-on-warnings` flags pre-existing
      `any` in `provider-register.ts` (44 diagnostics before AND after this edit —
      0 new). This change is clean in isolation: `tsc` clean for the touched file,
      +2 tests passing / 0 regressions. Not caused by this change.
- [~] 3.3 `npm run reload` sent to 15 connected sessions (re-emits `models_list`).
      Live-UI confirmation that the Opus dropdown shows all six levels and `high`
      is selectable is pending a manual/isolated-ui check.

## 4. Review gates (before commit)

- [x] 4.1 Code-review gate (advisory, worktree-safe, never blocks):
      `npx tsx .pi/skills/implement/scripts/review-changes.ts` on the uncommitted
      diff. Fix any Critical/Warning findings, then re-run. `SKIP_CR_REVIEW=1`
      only if CodeRabbit is rate-limited/unavailable. -> verify: exits 0.
      (CodeRabbit ran: 0 Critical/Warning, exit 0.)
- [~] 4.2 Code-quality gate: `npm run quality:changed`. Same as 3.2 — oracle blocked
      by pre-existing jimp `tsc` errors + pre-existing `any` warnings; 0 new issues
      from this change. No Tier A `error` introduced by this change.
- [~] 4.3 Bridge-only change -> reload path. `npm run reload:check` aborts on the
      pre-existing jimp `tsc` errors, so plain `npm run reload` was used instead
      (sent to 15 sessions). Type-check verified clean for the touched file
      independently. No server restart / `npm run build` needed.
- [x] 4.4 Commit with a message referencing this change id
      (`fix-thinking-level-supported-projection`). Do NOT run `full-rebuild.ts`
      -- this is not a deploy step.
