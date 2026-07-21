# empty-actionable-guard-config.ts — index

Resolve empty-actionable guard config from env. Exports `resolveGuardConfig(env)` → `{mode,retryCap}`. `PI_DASHBOARD_EMPTY_TURN_GUARD` (`auto-continue` default \| `surface-only`), `PI_DASHBOARD_EMPTY_TURN_RETRY_CAP` (default 2). Pure; env injected. See change: fix-gemini-subagent-silent-tool-schema-failure.
