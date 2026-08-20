# virtualizer-jsdom.ts — index

Vitest `setupFiles` shim (wired in `packages/client/vitest.config.ts`). jsdom lacks layout + `ResizeObserver`, so TanStack Virtual reads `offsetHeight`=0 and renders ZERO rows. Provides no-op `ResizeObserver` + reports tall `offsetHeight`/wide `offsetWidth` for ONLY the ChatView scroll container (`data-testid="chat-scroll-container"`), so ALL windowed rows mount for per-row content assertions (rows still measure 0). Global RTL `cleanup()` unmounts every tree. The layout shim records any ChatView scroller access, including a later manual unmount. ChatView tests that use real timers then wait 160 ms for TanStack Virtual's 150 ms scroll-reset callback; tests that use fake timers and non-ChatView tests skip the wait. This prevents the callback from reaching React after jsdom removes `window`, which otherwise exits the run on `Errors 1` after all assertions pass. NOT a global `setTimeout` wrapper cancelling pending ids: that also intercepts `user-event`'s scheduling and broke the clipboard-fallback spec. See change: fix-tmux-session-shutdown-leak. `configure({ asyncUtilTimeout: 5_000 })` raises `waitFor`/`findBy*` poll ceiling under parallel-suite CPU oversubscription. Scroll/windowing BEHAVIOUR is Playwright-gated, not asserted here. See change: virtualize-chat-transcript-tanstack.

## Triage — leaked-callback flake

Symptom. Run exits 1. Every assertion passes. Vitest prints `Errors 1`, no failed test.

Stack:

```
ReferenceError: window is not defined
  ❯ resolveUpdatePriority  react-dom-client
  ❯ Virtualizer.notify      @tanstack/virtual-core
  ❯ Timeout._onTimeout      @tanstack/virtual-core/utils.js
```

Blamed spec rotates. `pool: "forks"` scheduling picks whichever file is active when the leaked callback fires. Suite-level flake, NOT a bug in the blamed file. Do not chase the named spec.

Same class, earlier cause: React concurrent scheduler flushing after fork teardown (`performWorkOnRootViaSchedulerTask`). ~40 client specs render without own `cleanup()`. Fixed by the global RTL `cleanup()`. See change: friendlier-worktree-init.

## Drain scope invariant

`DRAINED_TESTIDS` in the shim lists the drained scroll containers. List MUST cover every `useVirtualizer` call site in `packages/client/src`. At this change, `ChatView.tsx` is the only production call site. A site rendering another testid leaves its own callback scheduled — drain skips it, flake returns, no failing test points at it.

Enforced by `packages/shared/src/__tests__/virtualizer-drain-scope.test.ts`. If another virtualized list is added, widen `DRAINED_TESTIDS` + the drain predicate in the same change; do not just bump the lint's expected list.

## Cost and scope

The 160 ms wait is a bounded but real wall-clock cost for each matching ChatView `afterEach`. Unrelated client tests skip it. Scroll and windowing behavior remain Playwright concerns; this shim supports rendered-output assertions only.

`noteScrollerAccess` named for effect — answers layout question AND arms the drain. Getter access is the only available hook. Pure predicate is `isDrainedScroller`.
