# e2e-notify.ext.ts — index

pi extension fixture: the only L3 lever on `ctx.ui.notify`. Captures `ctx` at `session_start` and registers tool `e2e_notify({message, level?})` whose `execute(_toolCallId, params)` calls `ctx.ui.notify`. Seeded by `docker/test-entrypoint.sh` to `~/.pi/agent/extensions/e2e-notify/`; driven by the `notify-probe` faux scenario. See change: split-notify-from-prompt-request.
