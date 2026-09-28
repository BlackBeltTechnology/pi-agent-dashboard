# DOX — packages/client/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `history-load-harness.tsx` | `setupHistoryLoad(status)` composes real `useHistoryLoadState` + `useMessageHandler` (real `setSessionStates`); helpers `begin`, `advance`, `dispatch`, `phase`, `setStatus`, `markSpy`; `contentReplay(sid)`. See change: show-session-history-load-state. |
| `runConfigHarness.tsx` | `ModelConfigProvider` test harness. Exports `makeModels`, `makeRunConfig`, `RunConfigHarness`. See change: openspec-dialog-model-effort-selector. |
| `virtualizer-jsdom.ts` | Vitest `setupFiles` layout shim + scoped 160 ms TanStack callback drain. Enforced call-site invariant and flake triage → see `virtualizer-jsdom.ts.AGENTS.md` |
