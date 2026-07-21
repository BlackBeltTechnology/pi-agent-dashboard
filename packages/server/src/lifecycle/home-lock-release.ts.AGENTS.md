# home-lock-release.ts — index

Installs SIGINT/SIGTERM/SIGHUP/SIGBREAK + `exit` handlers that release the per-HOME dashboard lock exactly once. Exports `installReleaseHandlers(release, options)`, `ReleaseFn`, `InstallReleaseHandlersOptions`. Split from `home-lock.ts` to keep lock-acquisition logic pure + testable. Idempotent; returns remover fn.
