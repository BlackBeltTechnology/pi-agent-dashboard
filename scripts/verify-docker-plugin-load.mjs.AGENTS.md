# verify-docker-plugin-load.mjs — index

Required Docker gate (test-plan X12): build the image, boot the container, and assert the browser plugin ACTUALLY LOADED inside it.

WHY A BOOT, NOT A BUILD. The image is the one install mode that worked before this change — and only through the two crutches the change removes: `docker/entrypoint.sh` execs the wrapper, which stamped `JITI_TSCONFIG_PATHS`, and `Dockerfile` copies `tsconfig.base.json` into the image. A build that succeeds proves nothing about resolution.

THREE ASSERTIONS, all read from the running container:

1. `[plugin-loader] Loaded plugin "browser"` is present in `$HOME/.pi/dashboard/server.log`. Polled until a verdict appears — health 200 does NOT imply the registry finished loading, so sampling once reports a false failure.
2. No unexpected `Failed to load plugin` line. The `PI_E2E_SEED=1` harness deliberately seeds `e2e-broken` (its server entry throws by construction, to exercise the error UI), so that one id is allowlisted and every OTHER failure still fails the gate.
3. No `JITI_*` variable in the container env. If `JITI_TSCONFIG_PATHS` were set, a green run would prove nothing — it is exactly what made the monorepo work while npm / managed / Electron stayed broken.

The script itself sets `PI_E2E_SEED=1` (arms the harness seams) and `PI_BROWSER_RELAY_FAKE=1` (the faucet that ENABLES the plugin, whose manifest is `defaultEnabled: false`); without both, `discovered` contains browser but nothing ever loads it and "no failures" holds trivially. `TEST_COPY_MODE=1` is left to the caller (GitHub runners refuse the overlay mount).

Always tears the harness down in a `finally`, so a failed gate cannot leak a 4 GiB container into the next job on a reused runner.

Exports `parseHarnessState`, `pluginLoadProblems`, `crutchProblems`, `hasPluginVerdict`, `readContainerServerLog`, `readContainerEnv`, `verifyDockerPluginLoad`, `HARNESS_BROKEN_FIXTURES`. Exit non-zero on any assertion failure.

Run in CI by the required `docker-plugin-load` job in `.github/workflows/ci.yml`.

See change: fix-browser-plugin-vendor-specifier-resolution (D4, X12).
