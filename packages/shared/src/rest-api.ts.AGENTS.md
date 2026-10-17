# rest-api.ts — index

REST endpoint request/response types. Sessions, events, spawn, file read/write (`FileWriteRequest` mtime… → see `rest-api.ts.AGENTS.md` `NetworkInterface` gains `label`/`pointToPoint`/`suggestions`; still one entry per address. See change: warn-unreachable-trusted-networks.

`ProviderAuthStatus` gains `authLabel?` (env mechanism label) and `subscription?` (OAuth; absent → client treats as true). See change: update-pi-core-1-0-adopt-apis.

`CreateProjectRequest`, `CreateProjectResult` (`path`, `existed`), `CreateProjectErrorReason`, `CreateProjectResponse` next to `MkdirRequest`. See change: streamline-first-run.
`LegacyProviderIdEntry` + `LegacyProviderIdsResponse` — body of `GET /api/provider-auth/legacy-provider-ids` (renamed provider ids still in pi files; ids + location tokens only). See change: update-pi-core-1-1-adopt-apis.

## addons-hub-declutter

`InstalledPackage.dashboardManaged?: boolean` — display-only flag for dashboard-recorded plugin bridge rows. See change: addons-hub-declutter.

## edit-pi-agent-settings

`PiSettingsReadResponse`, `PiSettingsPatch`, `PutPiSettingsRequest`, `PutPiSettingsRawRequest`, `PiSettingsWriteResponse`, `PiSettingsConflict`, `PiMirrorResult`, `PiSettingsSyncResponse` — `/api/pi-settings*` bodies and the `piMirror` field of the config save. See change: edit-pi-agent-settings.

`MermaidRepairRequest {code,error}`, `MermaidRepairData {code,model}`, `MermaidRepairErrorCode` (`disabled|bad_request|too_large|busy|timeout|provider_error|unparseable`), `MermaidRepairResponse` for `POST /api/mermaid/repair`. See change: add-mermaid-ai-repair.
