# acp-restart-midturn.spec.ts — index

L3: durable ACP session (`qmt-durable`, host B under rpc-keeper) survives `POST /api/restart` mid-turn; same card id, driver chip, reply visible after reattach + log replay. Test-plan #F4 (task 7.55). Harness seeds the fake ACP agents in `docker/test-entrypoint.sh` (`PI_E2E_SEED=1`). See change: add-acp-session-driver.
