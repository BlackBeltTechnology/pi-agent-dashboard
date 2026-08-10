# zrok-env.ts — index

Pure `readZrokEnvironment({homedir,fs})` returning `{found, kind: v2\|v1\|null, path, env, reason}`. Prefers `~/.zrok2/environment.json` over `~/.zrok/environment.json`. Never throws. Consumed by `tunnel.ts#loadZrokEnv` and `doctor-core.ts` zrok-environment check so runtime and diagnostic agree. See change: add-tunnel-diagnostic-checks.
