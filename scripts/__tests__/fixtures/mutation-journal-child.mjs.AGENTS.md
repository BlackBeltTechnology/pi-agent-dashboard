# __tests__/fixtures/mutation-journal-child.mjs — index

Child-process fixture for the mutation-journal crash-safety tests. Applies ONE mutation to a throwaway repoRoot via `beginMutation`, writes a marker file to signal readiness, then idles on `setInterval` so the parent can kill it. Idle must keep the event loop FREE — a synchronous block would starve the SIGINT handler and the interrupt test would prove nothing. Used by test-plan #X1 (SIGKILL), #X11 (SIGINT), #X13 (live-owner skip). See change: harden-mutation-harness-restore.
