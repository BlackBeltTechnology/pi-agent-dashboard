## 1. Tests first (red)

- [x] 1.1 command-handler test: `request_models` invokes the provider re-sync callback before `registry.refresh`; verify fails before 2.1
- [x] 1.2 command-handler test: `request_models` calls `refresh` with `allowNetwork:false`; verify fails before 2.2
- [x] 1.3 command-handler test: re-sync callback throwing still yields a `models_list` (degraded); verify passes after 2.1
- [x] 1.4 bridge test: `credentials_updated` with empty `reloadProviders` diff calls `refresh({allowNetwork:false})` and pushes `models_list`; verify fails before 2.3

## 2. Implementation

- [x] 2.1 Thread a `reloadProviders` callback through command-handler options (wired in `bridge.ts` to `reloadProviders(pi)`); `request_models` awaits it, catch+log on error; verify 1.1 and 1.3 pass
- [x] 2.2 `request_models` passes `{ allowNetwork: false }` to `reportRefresh(registry.refresh(...))`; verify 1.2 passes
- [x] 2.3 `credentials_updated`: when `touched` empty, `reportRefresh(refresh({allowNetwork:false}), "credentials reload refresh (full)")`; verify 1.4 passes

## 3. Verify + docs

- [x] 3.1 `npm test`: change-scope suites green (70/70); 22 pre-existing native-TS-loader failures reproduce on origin/develop, unrelated
- [ ] 3.2 Manual: hand-edit `~/.pi/agent/providers.json` to add a provider, `npm run reload`-free, open selector in a live session -> new models appear without restart
- [ ] 3.3 Manual: add API key for a built-in provider in Settings -> selector shows its models immediately
- [x] 3.4 Update `packages/extension/src/AGENTS.md` rows for `command-handler.ts` / `bridge.ts` with `See change: refresh-models-on-provider-change`
