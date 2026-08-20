# spawn-correlation-recovery.spec.ts — index

L3 browser E2E for a late-registering spawn. F2: a register inside the recovery window clears the banner AND adds the card — the reported symptom was exactly one half of that. F3/F4: `dashboardSpawned` keeps a headless dashboard spawn visible while an unsignalled worker still hides. F5: one spawn registering leaves a concurrent same-cwd spawn watched. F6: a REST prompt reports `transmitted` + a `promptId` that reaches the bridge, and no `delivered`.

SEAM: `session_added.spawnRequestId` is keyed by the SERVER-MINTED spawn token, which only reaches the spawned pi's env, so a synthetic bridge cannot know it. The spec lowers `spawnRegisterTimeoutMs` via `PUT /api/config`, lets the watchdog fire, and reads `spawnToken` back from `GET /api/spawn-failures` — the join key this change adds (design D5) — then registers a synthetic bridge with it over the gateway port from `/api/health`.

F1/X12 (the >60 s register boundary) are deliberately NOT re-run live: the boundary is pinned deterministically on fake timers by E4/E5/E7/E8/X4, and a live variant costs a 70 s wall-clock wait to re-assert the same arithmetic more flakily.

See change: fix-spawn-correlation-ttl-coupling.
