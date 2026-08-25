# history-backfill-perf.spec.ts — index

L3 P1/P2 for `fix-lazy-history-backfill-ux`, metric AMENDED by the task-1.2 measurement. The original "time to first rendered row ≥5× faster" is unmeasurable: replay ships in `REPLAY_BATCH_SIZE` (200) batches so the first batch lands at the same moment regardless of what follows (measured 0.97×). Asserts what windowing does move — delivered events ≤ budget (deterministic), wire bytes ≥40% smaller (measured −57% @4825ev, −68% @604ev), completion ≥1.2× (measured 2.10× / 1.69×). SERIAL; restores config + ends its session.
