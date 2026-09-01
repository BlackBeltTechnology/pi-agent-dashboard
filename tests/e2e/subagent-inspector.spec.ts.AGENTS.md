# subagent-inspector.spec.ts — index

L3 spec (change: add-flow-plugin-e2e-tests). Drives `[[faux:subagent-spawn]]` — parent emits an `Agent` tool… → see `subagent-inspector.spec.ts.AGENTS.md` Also carries F3 (a completed subagent still renders after a page reload — the replay re-folds the COLLAPSED buffer) and P2 (collapse fires on a real sustained subagent run, asserted via `/api/health` `storeTrim.collapsedUpdates`; port comes from `baseURL`, never a hardcoded `:18000`). See change: collapse-superseded-tool-execution-updates.
