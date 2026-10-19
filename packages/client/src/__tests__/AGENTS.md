# DOX — packages/client/src/__tests__

Client-level suites. Only suites with a recorded contract have a row; the rest are discoverable by name.

| File | Purpose |
|------|---------|
| `plugin-settings-consistency.test.tsx` | Parametrized cross-plugin settings-kit contract over 15 settings components, imported by relative path from sibling `packages/*` (client alias map already covers runtime/shared). Mounts each real component in `PluginContextProvider` + `CurrentPluginLayer` + `SettingsDraftProvider` with per-plugin `fetch` fixtures; id/displayName read from each package manifest. #E6: 0 `input[type=checkbox]` (mcp-client dialogs exempt), `aria-checked` only on `switch`/`radio`, every control has accessible name, every `aria-describedby` id resolves, `minSwitches` per plugin. #E7: no text node equals displayName/id (apple-tools, flows-anthropic-bridge, grammar, quota, system-one, mcp-client). #E8: master switches "Relay connections"/"Answer Discord messages"/"Check grammar in the composer"/"Check quotas" on testids `browser-enabled-toggle`/`chat-gateway-enabled`/`grammar-enabled`/`quota-enable`; no switch named Enabled/Enable/On. i18n (#E31) lives in per-plugin i18n tests + `scripts/i18n-parity.mjs`. See change: retro-ux-plugin-settings-wave-2. |
