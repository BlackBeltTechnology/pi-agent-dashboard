# acp-session-queue.spec.ts — index

L3: prompt sent mid-turn on an ACP session (`qmt-slow`) shows the follow-up queue chip, then runs when the turn ends. Mid-turn the composer has no send button — drive with Enter. Test-plan #F2 (task 7.52). Harness seeds the fake ACP agents in `docker/test-entrypoint.sh` (`PI_E2E_SEED=1`). See change: add-acp-session-driver.

add-composer-dock: queued chip assertion opens the dock Queue lane first (`expandQueueLane`). See change: add-composer-dock.
