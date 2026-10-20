# DOX — packages/craft-web-plugin/src/client/__tests__

Files in this directory. One row per source file. See change: edit-office-in-pane-with-craft-web.

| File | Purpose |
|------|---------|
| `CraftWebSettings.test.tsx` | L1 jsdom. Settings section inside `SettingsDraftProvider` + `PluginContextProvider`: group per app (switch, select, status, installed), draft dirty/commit full config via `plugin_config_write` (unknown keys kept) + reset, back-to-default clears dirty, Update button (version label, disabled while dirty, prepare + refetch), Download + failed prepare reason, 404/unreachable notice. See change: track-latest-craft-web-version. Sized Download label, `shimUpdate` → Update, G2 group heading + header extensions. See change: extend-craft-web-to-all-apps. |
| `gate.test.tsx` | Status gate (unverified stand-in = synthetic DeckCraft row) + renderer probe + snapshot preflight: E2 (unverified / absent app → no iframe, no prepare), disabled, 404 → restart-required, not-prepared size + Prepare, shim-outdated, X2 offline prepare, E25 GPU probe (no flag / `?webgl` / none), iframe attributes + per-mount nonce, over-limit snapshot. |
| `i18n.test.ts` | Catalog key + placeholder parity EN ↔ zh-CN ↔ hu; `formatSize`. |
| `protocol.test.tsx` | Simulated shim messages: ready→open once (transfer), E21 acceptance, X3 60 s readiness + `?webgl` retry, X4 15 s opened, E20 dirty derivation, frame loss (second `ready`/`load`, Resume), blocked toast, csp rate-limit, navigate-blocked offer (http(s) only). v2: E12 v1 `opened` = title, no plugin dialog; E28 fallback telemetry + direct core save; core copy ≠ own save; shim `start-failed` (before/after opened) + timeout telemetry; E25 frame flags per claim + `nosw`; E30 toolbar chips; E33 contrast class; E27 view-only host. See change: extend-craft-web-to-all-apps. |
| `save.test.tsx` | E19 save routing (`routeSave` matrix + host behaviour): own/save-as dialog/device download/over-cap offer, failed + rejected + busy saves, Save-target toggle keyed by file. E13 routing (sibling, inner-title, preview, `siblingName`), D10 remembered answers in the host (overwrite / copy), E32 session-name hint. See change: extend-craft-web-to-all-apps. |
| `test-utils.tsx` | Harness: `makeFh`, `stubFetch`, `stubRenderer`, `mountFrame`, `shimSend`, `openDoc`, `flush`/`advance` (fake timers). |
