# __tests__/verify-release-deps-keyring-floor.test.mjs — index

E87 (encrypt-credentials-at-rest). Drives `collectFailures({repoRoot})` against a tmp fixture repo (real server/extension/shared/client package.json + `docker/Dockerfile` + `pnpm-workspace.yaml` copied; the server's `@napi-rs/keyring` declaration rewritten). `2.1.2` passes; `2.1.1` reports one `Stale pin`; a missing declaration reports one `Missing`; the real tree passes. Exemplar: `verify-release-deps-openspec-floor.test.mjs`. See change: encrypt-credentials-at-rest.
