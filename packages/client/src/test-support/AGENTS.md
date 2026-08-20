# DOX — packages/client/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `virtualizer-jsdom.ts` | Vitest `setupFiles` shim (wired in `packages/client/vitest.config.ts`). jsdom lacks layout + `ResizeObserver`, so TanStack Virtual reads `offsetHeight`=0 and renders ZERO rows. Provides no-op `ResizeObserver` + reports tall `offsetHeight`/wide `offsetWidth` for ONLY the ChatView scroll container (`data-testid="chat-scroll-container"`), so ALL windowed rows mount for per-row content assertions (rows still measure 0). Global RTL `cleanup()` unmounts every tree. When a test mounted ChatView and uses real timers, cleanup then waits 160 ms for TanStack Virtual's 150 ms scroll-reset callback. Fake-timer and non-ChatView tests skip the wait. This prevents the callback from reaching React after jsdom removes `window`, which otherwise exits the run on `Errors 1` after all assertions pass. NOT a global `setTimeout` wrapper cancelling pending ids: that also intercepts `user-event`'s scheduling and broke the clipboard-fallback spec. See change: fix-tmux-session-shutdown-leak. `configure({ asyncUtilTimeout: 5_000 })` raises `waitFor`/`findBy*` poll ceiling under parallel-suite CPU oversubscription. Scroll/windowing BEHAVIOUR is Playwright-gated, not asserted here. See change: virtualize-chat-transcript-tanstack. |
