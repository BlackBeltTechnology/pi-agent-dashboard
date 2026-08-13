# __tests__/test-up-port-derivation.test.mjs — index

Vitest tests for parallel-worktree test-harness port/project derivation. Sources docker/lib-ports.sh; asserts derive_hash deterministic, derive_project compose-legal + distinct, base offsets land in 18000-18999/19000-19999 windows, is_free + find_free_in_window skip held ports, test-up.sh state file shape, compose interpolation (skips if no docker).
