# DOX — packages/client/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `virtualizer-jsdom.ts` | Vitest `setupFiles` shim (wired in `packages/client/vitest.config.ts`). jsdom lacks layout + `ResizeObserver`, so TanStack Virtual reads `offsetHeight`=0 and renders ZERO rows. Provides no-op `ResizeObserver` + reports tall `offsetHeight`/wide `offsetWidth` for ONLY the ChatView scroll container (`data-testid="chat-scroll-container"`), so ALL windowed rows mount for per-row content assertions (rows still measure 0). Global RTL `cleanup()` in `afterEach` unmounts every tree (blocks post-teardown scheduler flush `window is not defined` under `pool:forks`). `configure({ asyncUtilTimeout: 5_000 })` raises `waitFor`/`findBy*` poll ceiling under parallel-suite CPU oversubscription. Scroll/windowing BEHAVIOUR is Playwright-gated, not asserted here. See change: virtualize-chat-transcript-tanstack. |
