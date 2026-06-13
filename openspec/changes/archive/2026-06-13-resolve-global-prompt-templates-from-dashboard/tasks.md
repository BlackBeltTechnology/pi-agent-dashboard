## 1. Global prompt template resolution

- [x] 1.1 Add failing test in `packages/extension/src/__tests__/prompt-expander.test.ts`: `pi.getCommands()` returns `{ name, source: "prompt", path }` for a real on-disk template; `resolveTemplate`/`expandPromptTemplateFromDisk` resolves and expands it. → verify: test fails before impl.
- [x] 1.2 In `packages/extension/src/prompt-expander.ts` Step 3, add a parallel `source: "prompt"` probe alongside the `source: "skill"` probe, sharing the candidate-name loop and existing path field. → verify: 1.1 passes.
- [x] 1.3 Confirm skill resolution + original-form-first precedence tests still pass. → verify: `npm test -- prompt-expander` green.

## 2. hasDispatchCommand in-operator fallback

- [x] 2.1 Add failing test in `packages/extension/src/__tests__/extension-slash-command-detection.test.ts`: `hasDispatchCommand` returns `true` for a getter-backed/Proxy `dispatchCommand` function; still `false` for absent / non-function / null / undefined. → verify: getter case fails before impl.
- [x] 2.2 In `packages/extension/src/bridge-context.ts`, add `in`-operator fallback with guarded `typeof` on resolved value. → verify: 2.1 passes.

## 3. Verify

- [x] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|✗' /tmp/pi-test.log` → no failures.
- [x] 3.2 `npm run reload:check` (type-check + reload bridge) → clean.
- [x] 3.3 Manual: invoke `/session-summary` from dashboard on a session with the template installed at `~/.pi/agent/prompts/` → expands instead of going to LLM as raw text.
