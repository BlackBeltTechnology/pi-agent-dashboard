# semaphore.ts — index

Tiny FIFO throttling semaphore. `createSemaphore(max)` → `Semaphore` with `run(fn)` (queue when at cap, release on settle), `setMax(n)` (live reconfig, drains synchronously), `size()`. Throws on non-positive `max`. Used by openspec poll scheduler in lieu of `p-limit`.
