# DOX — packages/client/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `attachmentHarness.tsx` | Test harness: `stubArchiveApi`, `withOpenSpecMap`, `archiveEntry`, `knownData`, `absentData`, `makeChange`. See change: resolve-archived-attached-proposal. |
| `history-load-harness.tsx` | `setupHistoryLoad(status)` composes real `useHistoryLoadState` + `useMessageHandler` (real `setSessionStates`); helpers `begin`, `advance`, `dispatch`, `phase`, `setStatus`, `markSpy`; `contentReplay(sid)`. See change: show-session-history-load-state. |
| `eager-lazy-dialogs.ts` | Vitest `setupFiles` shim: `vi.mock`s both `lazy-*-dialogs` modules to the EAGER components so unit tests assert dialogs synchronously; real loaders covered by `lazy-dialogs.test.tsx`. See change: redesign-composer-session-strip. |
| `runConfigHarness.tsx` | `ModelConfigProvider` test harness. Exports `makeModels`, `makeRunConfig`, `RunConfigHarness`. See change: openspec-dialog-model-effort-selector. |
| `virtualizer-jsdom.ts` | Vitest `setupFiles` layout shim + scoped 160 ms TanStack callback drain. Enforced call-site invariant and flake triage → see `virtualizer-jsdom.ts.AGENTS.md` |
| `renderWithProviders.tsx` | `renderWithProviders(ui)`: `render` wrapped in a default `ThemeProvider` + `window.matchMedia` shim (jsdom has none). See change: test-trust-audit. |
| `restore-globals.ts` | Vitest `setupFiles` hygiene. `afterEach`: RTL cleanup + real timers. `afterAll`: `restoreGlobals()` puts back storage objects/contents, `getBoundingClientRect`, `matchMedia`. No `vi.resetModules` (second React copy). See change: test-trust-audit. |
| `pointer.ts` | jsdom pointer helpers: `pointerDown/Move/Up/Cancel`, `lostPointerCapture`, `nextFrame`. Typed `MouseEvent`s + defined `pointerId` (no `PointerEvent` in jsdom). See change: fix-split-divider-drag. |
