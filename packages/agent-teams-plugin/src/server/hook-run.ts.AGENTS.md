# hook-run.ts — index

`startHook`: `bash -c` detached via shared exec wrapper, stdin JSON, `buildHookEnv` allowlist, 64 KiB stream caps, tree kill (SIGTERM, SIGKILL after `HOOK_KILL_GRACE_MS`); `HookIo` seam (spawn/kill) for tests; `firstChars`. See change: add-agent-teams-templates-hooks.
