# lifecycle.test.ts — index

Unit tests (vitest `tests` project, NOT Playwright) for `tests/e2e/lifecycle.ts`'s harness failure diagnostics: `resolveHarnessProject`, `harnessRestartCount`, `captureHarnessFailure`.

Why: first CI dispatches of the sharded browser-E2E workflow died with "container never became healthy" and NO cause — `test-up.sh` output ends at `Container ... Started` (compose returns as soon as the container is up), so an entrypoint that then crash-loops left no trace. `captureHarnessFailure` snapshots container state + log tail into `test-results/harness-failure.log`, which the workflow uploads per shard.

Tests drive the helpers with an injected `DockerProbe` stub (keyed on the docker args actually passed: `ps -a --filter label=com.docker.compose.project=…`, `inspect -f`, `logs --tail 200`), so no docker daemon is needed.

Pinned contracts: `resolveHarnessProject` reads the state file's `project` and degrades to `undefined` (never throws) on absent/malformed input — it runs on the failure path. `harnessRestartCount` is `undefined` before the container exists. `captureHarnessFailure` writes the project, container names, `status=`/`restarts=`/`exit=` and the log tail; returns `undefined` + writes nothing when docker shows no container.

See change: stabilize-browser-e2e.
