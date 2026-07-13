## Why

`CtxToolRenderer` describes a `ctx_*` tool call only from its **result** text
(`parseCtxResult`). While a call is still running there is no result, so:

1. `parseCtxResult(toolName, "", false)` returns `{ kind: "raw" }`, and
   `headerChip`'s `default:` arm returns `toolName`. The header row then renders
   two spans that both resolve to the tool name — the chip **duplicates** the
   subtitle (`ctx_batch_execute · ctx_batch_execute`).
2. The body shows a bare `Running…`, discarding the `args` already in hand —
   the batch's commands, the execute code, the search queries, the fetch url.

A 17-second `ctx_batch_execute` therefore renders as an opaque, self-duplicating
card even though `args.commands[]` fully describes what is running. The same gap
hits every `ctx_*` tool mid-run, not just batch.

The parser is correctly result-only; the defect lives entirely in the
renderer's header + running-state body, which never fall back to `args`.

## What Changes

- Add an `argsChip(toolName, args)` helper in `CtxToolRenderer` producing the
  same emoji vocabulary as the result chips, sourced from `args`
  (`▦ N cmds`, `⚙ <lang>`, `🔍 N queries`, `🌐 <host>`, `🗂 <source>`). Use it
  as the `headerChip` fallback in place of `default: return toolName`, so the
  chip never collides with the subtitle during running or raw-fallback states.
- Replace the bare `Running…` with a per-tool `RunningPreview` body: batch lists
  `args.commands[]` (`• <label>  <command>`), execute shows `args.code` in the
  existing `CodeBlock`, search lists `args.queries[]`, fetch shows the url; any
  other tool keeps a plain `Running…`.
- The batch command list is height-capped inside the existing `max-h-80`
  scroll region (no separate cap logic).

Non-goals: the result-state parsing/layout (already correct and untouched);
`parse-ctx-result.ts` (stays result-only); `lib/tool-summary.ts` (keeps owning
the collapsed step title — a small, deliberate duplication of the "count the
commands" logic, kept local so the expanded chip matches the result-state emoji
vocabulary).

## Impact

- `packages/client/src/components/tool-renderers/CtxToolRenderer.tsx` —
  `argsChip()`, `RunningPreview`, one-line `headerChip` default swap, running
  block wiring.
- `openspec/specs/tool-renderers/spec.md` — CtxToolRenderer requirement gains
  running-state + args-chip scenarios; the Raw fallback scenario switches from a
  tool-name header to the args-derived chip.
- Tests: `CtxToolRenderer.test.tsx` currently exercises only result-state cards;
  add running-state cases (chip ≠ subtitle; batch running lists command labels;
  execute running shows code).

Design + approved mockup: `openspec/changes/fix-ctx-running-render/mockup/index.html`.

## Discipline Skills

None. UI-only, no auth/untrusted-input/perf/observability surface; standard
TDD + code-review + code-quality end gates apply.
