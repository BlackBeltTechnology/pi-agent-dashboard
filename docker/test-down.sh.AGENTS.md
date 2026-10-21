# test-down.sh — index

Teardown. Re-derives `COMPOSE_PROJECT_NAME` from `$PWD` via lib-ports.sh cksum. `docker compose -p <project> -f compose.yml -f compose.test.yml down -v`. Warns on malformed `.pi-test-harness.json` but continues. Removes `.pi-test-harness.json` after down. Drops tmpfs `pi-state` + overlay upper. Host pristine. See change: docker-test-harness. See change: parallelize-test-harness.

Lifecycle marker (#451 part 1): resolves the container id (state `containerId`, else `compose ps -q` before any removal), appends `teardown-begin <ISO> <project> <id>` to the events file BEFORE `compose down`, then waits ≤10 s (`PI_HARNESS_DESTROY_WAIT_SECS`) for that container's `destroy` line, stops the recorder, prints the events path. Dead/absent recorder → one stderr warning, marker still written, no wait, exit 0. Tests: `scripts/__tests__/test-down-recorder.test.mjs`. See change: add-missing-ci-legs.

Overlay teardown: reads state `extraCompose` and adds each `-f`; `down -v --remove-orphans`. State absent / malformed / no `extraCompose` → includes every `compose.test.*.yml`, logs `falling back to every compose.test.*.yml`. Attached-boot id via `compose ps -aq pi-dashboard`. L2: `qa/tests/46-harness-acme-overlay-teardown.sh`. See change: add-acme-dns01-certs.

Removes `.pi-test-canary` (staged canary) with the harness state file.
