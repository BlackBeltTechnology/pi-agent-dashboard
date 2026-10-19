## 1. craft-apps: latest web channel (TDD)

- [x] 1.1 Tests in `packages/craft-apps/src/__tests__/provision-web.test.ts`: L1 latest channel (option + env `latest`), latest-cached within 24 h, release without web asset → registry + not cached, offline → fallback-installed, explicit pin beats channel, pinned default never asks latest, `latestWebVersion` metadata-only
- [x] 1.2 `provision.ts`: `ProvisionWebOptions.channel`, `WebSource` + `latest|latest-cached|fallback-installed`, async `resolveWebSource`, `latestWebVersion`, reuse fetched release
- [x] 1.3 Update `packages/craft-apps/src/AGENTS.md` `provision.ts` row; `docs/craft-apps.md` §3b (DocScribe)

## 2. craft-web-plugin: version channel (TDD)

- [x] 2.1 Tests in `packages/craft-web-plugin/src/server/__tests__/service.test.ts`: channel passed to provisionWeb; pinned status makes no lookup; latest + newer known → not-prepared with latest version; latest + failed update + valid build → ok; status row has `channel`
- [x] 2.2 `config.ts` `appChannel`; `configSchema.json` `version` enum; `service.ts` background refresh + status rules
- [x] 2.3 Update `packages/craft-web-plugin/src/server/AGENTS.md`; `docs/craft-web-plugin.md` (DocScribe)

## 3. Settings section (TDD)

- [x] 3.1 Server status adds `installedVersion` / `latestVersion` (service.test.ts)
- [x] 3.2 `status-types.ts` parses `channel`/`installedVersion`/`latestVersion`/`enabled`
- [x] 3.3 Tests `src/client/__tests__/CraftWebSettings.test.tsx`: renders group per app; toggle + select dirty the draft and commit `plugin_config_write` with full config; update button label/visibility/disabled-while-dirty; prepare call + status refetch; restart-required / unreachable states
- [x] 3.4 `CraftWebSettings.tsx`, manifest `settings-section` claim, i18n keys en/zh-CN/hu
- [x] 3.5 AGENTS.md rows (client, package); docs/craft-web-plugin.md (DocScribe)

## 4. Verify

- [x] 4.1 `npm test` for craft-apps + craft-web-plugin green; `npm run quality:changed`
- [ ] 4.2 Manual: set `apps.wordcraft.version: "latest"`, open a `.docx`, Download installs latest
