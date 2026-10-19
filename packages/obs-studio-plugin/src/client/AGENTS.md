# DOX — packages/obs-studio-plugin/src/client

| File | Purpose |
|------|---------|
| `ObsAppRoute.tsx` | `/obs/*?` claim body: `<EmbeddedApp>` (standalone `/apps/obs/`) around `ObsPanel`. Lazy. |
| `ObsPanel.tsx` | Instance picker, scenes, vcam/record, preview; Start/Retry via `/api/services/:id/{start,retry}` only when not healthy and not `blocked`; never Stop. |
| `ObsSettingsCard.tsx` | Settings card: state, auth, version, exposure warning, recovery, "Open OBS panel". Wave 2: `SettingsItem` per instance + `SettingsStatusPill` (human state word via `STATE_WORD`, raw state only in `data-status`) + `SettingsFacts` (auth, version); warnings = `SettingsNotice`; `pi-obs …` commands in `<code>` + `SettingsCopyButton` "Copy command" (`{cmd}` placeholder split by `withCode`, no backticks); load failure = error notice + Try again, raw code only in Copy details. See change: retro-ux-plugin-settings-wave-2. |
| `api.ts` | Route types, `api()`, `authState`, `lifecycleAction`. |
| `index.tsx` | Barrel: eager `catalog`; `ObsSettings`/`ObsAppClaim` wrappers with own `Suspense` + `lazy()`. `ObsSettings` Suspense fallback = "Loading…" (was null). See change: retro-ux-plugin-settings-wave-2. |
| `usePreview.ts` | `createPreviewPoller` (≤ 1 fps visible only, 0.2 fps after 3 errors) + `usePreview`. |
| `__tests__/ObsSettingsCard.test.tsx` | Settings card: state word pill + `<code>` commands + Copy command, no backtick (#E25); 503 load failure → human error + Try again (#X8). See change: retro-ux-plugin-settings-wave-2. |
| `__tests__/i18n.test.ts` | F4 catalog parity. |
| `__tests__/panel.test.tsx` | Panel states. |
| `__tests__/preview.test.ts` | P1 poller (fake timers). |
