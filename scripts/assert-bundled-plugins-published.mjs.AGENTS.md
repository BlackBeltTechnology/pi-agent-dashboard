# assert-bundled-plugins-published.mjs — index

Release gate (test-plan #X17): `--version X`; web/extension/plugin-runtime + every `bundledPlugins` pkg MUST `npm view --prefer-online` at X (5 tries, linear 15 s backoff) before lock gen + server publish; miss → exit 1 naming pkg + `GITHUB_STEP_SUMMARY`. `checkPublished({names,version,view,sleep,attempts})` pure. Test hook `RUNTIME_GATE_NPM_VIEW`/`RUNTIME_GATE_ATTEMPTS`. See change: electron-runtime-release-pipeline.
