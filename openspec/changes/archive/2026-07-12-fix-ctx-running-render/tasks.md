## 1. Args-derived header chip

- [x] 1.1 Add `argsChip(toolName, args)` to `CtxToolRenderer.tsx` — returns emoji chips from `args`: batch `▦ N cmds` (`args.commands.length`), execute/execute_file `⚙ <language>`, search `🔍 N queries` (`args.queries.length`), fetch `🌐 <host>` (`hostOf(args.url ?? args.requests[0].url ?? args.source)`), index `🗂 <source|path>`; last-resort `toolName` for a genuinely unknown `ctx_*`.
- [x] 1.2 Swap `headerChip`'s `default: return toolName` to `return argsChip(toolName, args)`. All existing result-kind arms unchanged.

## 2. Running-state preview body

- [x] 2.1 Add `RunningPreview({ toolName, args })`: batch → `args.commands[]` as `• <label>  <command>` list; execute/execute_file → `<CodeBlock code={args.code} language={args.language}>`; search → `args.queries[]` bullet list; fetch → url link(s); default → plain `Running…`.
- [x] 2.2 Replace the `status === "running" && !result` block's bare `Running…` with `<RunningPreview toolName={toolName} args={args} />`. Keep it inside the existing `max-h-80` scroll region.

## 3. Tests

- [x] 3.1 Test: `ctx_batch_execute` running (`status="running"`, no result) renders chip `▦ 3 cmds` AND subtitle `ctx_batch_execute` — the two differ (regression guard for the duplication).
- [x] 3.2 Test: `ctx_batch_execute` running lists each `args.commands[].label`.
- [x] 3.3 Test: `ctx_execute` running with `args.language="javascript"` renders chip `⚙ javascript` and shows `args.code`.
- [x] 3.4 Test: `ctx_search` running renders chip `🔍 2 queries` and lists both `args.queries[]`.
- [x] 3.5 Test: result-state cards (batch/execute/search/fetch/index/error) still render unchanged — no regression from the `default`-arm swap.
- [x] 3.6 Browser E2E (`tests/e2e/ctx-running-render.spec.ts`): faux `ctx-batch-running` scenario + dropped `tool_execution_end` frame freezes a running `ctx_batch_execute`; expand the member step, assert args chip `▦ 2 cmds` (≠ tool-name subtitle) + RunningPreview command list. Ran green via `PW_CHANNEL=chrome PW_E2E_USE_RUNNING=1` against the Docker harness.

## 4. Validate

- [x] 4.1 `npm test` green (vitest, `CtxToolRenderer.test.tsx` + `parse-ctx-result.test.ts`).
- [x] 4.2 Automated by the browser E2E (task 3.6) — mid-run `ctx_batch_execute` card shows `▦ N cmds` chip (≠ tool-name subtitle) + command list, no duplicate. Verified via `PW_CHANNEL=chrome PW_E2E_USE_RUNNING=1` against the Docker harness.
- [x] 4.3 `openspec validate fix-ctx-running-render` passes.
