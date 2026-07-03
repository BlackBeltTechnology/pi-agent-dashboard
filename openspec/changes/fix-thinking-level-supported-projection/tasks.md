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

- [ ] 2.1 Update `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts`:
  - sparse reasoning map `{ reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } }`
    → `["off","minimal","low","medium","high","xhigh"]` (Opus case).
  - dense map `{ reasoning: true, thinkingLevelMap: { medium: "medium", high: "high", xhigh: null } }`
    → `["off","minimal","low","medium","high"]` (xhigh disabled).
  - non-reasoning `{ reasoning: false }` → `["off"]`.
  - no map + reasoning true `{ reasoning: true }` → `["off","minimal","low","medium","high"]`
    (xhigh excluded — pi requires an explicit `thinkingLevelMap` entry for xhigh).
  - `→ verify: npm test` for the file passes. [x]

## 3. Spec + gates

- [ ] 3.1 `openspec validate fix-thinking-level-supported-projection --strict` passes.
- [ ] 3.2 `npm run quality:changed` (biome + tsc + tests) exits clean.
- [ ] 3.3 `npm run reload` to re-emit `models_list` from connected sessions;
      confirm Opus dropdown shows all six levels and `high` is selectable
      (isolated-ui-verification or live check).

## 4. Review gates (before commit)

- [ ] 4.1 Code-review gate (advisory, worktree-safe, never blocks):
      `npx tsx .pi/skills/implement/scripts/review-changes.ts` on the uncommitted
      diff. Fix any Critical/Warning findings, then re-run. `SKIP_CR_REVIEW=1`
      only if CodeRabbit is rate-limited/unavailable. -> verify: exits 0.
- [ ] 4.2 Code-quality gate: `npm run quality:changed` (biome `--changed` +
      `tsc --noEmit` + `npm test`) -- single oracle, must exit clean. Tier A
      `error` hard-gates CI. -> verify: exit 0.
- [ ] 4.3 Bridge-only change -> reload path, not full rebuild: `npm run reload:check`
      (type-check + reload). No server restart or `npm run build` needed; the
      edit is confined to `packages/extension/src/`. -> verify: sessions reconnect
      and push corrected `models_list`.
- [ ] 4.4 Commit with a message referencing this change id
      (`fix-thinking-level-supported-projection`). Do NOT run `full-rebuild.ts`
      -- this is not a deploy step.
