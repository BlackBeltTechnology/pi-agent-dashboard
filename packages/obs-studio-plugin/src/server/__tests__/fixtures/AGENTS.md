# DOX — packages/obs-studio-plugin/src/server/__tests__/fixtures

| File | Purpose |
|------|---------|
| `stub-exec.mjs` | Stub `service exec` parent: child with inherited stdio, no own stdout; `STUB_IGNORE_EOF=1` swaps in an EOF-ignoring child; with `STUB_CHILD_PID_FILE=<file>` (that branch only) writes the child pid synchronously after spawn so the test can reap the orphan. Forwards no signals. See change: stabilize-flaky-unit-tests. |
