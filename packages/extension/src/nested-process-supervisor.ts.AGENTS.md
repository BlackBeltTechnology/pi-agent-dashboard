# nested-process-supervisor.ts — index

One-process-per-run nested execution boundary. `NestedProcessSupervisor.run(request,{signal,onEvent})` spawns `nested-process-worker.mjs` with IPC, correlates by `runId`, requests cooperative child-session abort, then escalates child process group SIGTERM→SIGKILL. Settles once and ignores late/cross-run events. Exports request/event/result/options types. See change: fix-terminal-session-cancellation-boundaries.
