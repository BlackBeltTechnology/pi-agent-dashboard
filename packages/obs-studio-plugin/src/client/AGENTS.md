# DOX — packages/obs-studio-plugin/src/client

| File | Purpose |
|------|---------|
| `ObsAppRoute.tsx` | `/obs/*?` claim body: `<EmbeddedApp>` (standalone `/apps/obs/`) around `ObsPanel`. Lazy. |
| `ObsPanel.tsx` | Instance picker, scenes, vcam/record, preview; Start/Retry via `/api/services/:id/{start,retry}` only when not healthy and not `blocked`; never Stop. |
| `ObsSettingsCard.tsx` | Settings card: state, auth, version, exposure warning, recovery, "Open OBS panel". |
| `api.ts` | Route types, `api()`, `authState`, `lifecycleAction`. |
| `index.tsx` | Barrel: eager `catalog`; `ObsSettings`/`ObsAppClaim` wrappers with own `Suspense` + `lazy()`. |
| `usePreview.ts` | `createPreviewPoller` (≤ 1 fps visible only, 0.2 fps after 3 errors) + `usePreview`. |
| `__tests__/i18n.test.ts` | F4 catalog parity. |
| `__tests__/panel.test.tsx` | Panel states. |
| `__tests__/preview.test.ts` | P1 poller (fake timers). |
