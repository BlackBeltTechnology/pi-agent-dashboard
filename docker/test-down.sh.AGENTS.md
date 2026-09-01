# test-down.sh — index

Teardown. Re-derives `COMPOSE_PROJECT_NAME` from `$PWD` via lib-ports.sh cksum. `docker compose -p <project> -f compose.yml -f compose.test.yml down -v`. Warns on malformed `.pi-test-harness.json` but continues. Removes `.pi-test-harness.json` after down. Drops tmpfs `pi-state` + overlay upper. Host pristine. See change: docker-test-harness. See change: parallelize-test-harness.
