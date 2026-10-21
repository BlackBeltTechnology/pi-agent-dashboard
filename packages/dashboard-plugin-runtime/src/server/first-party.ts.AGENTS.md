# first-party.ts — index

First-party plugin identity = npm scope `@blackbelt-technology/` (`FIRST_PARTY_PLUGIN_SCOPE`). `isFirstPartyPluginPackage(name)` (empty → false); `createGatedProviderAuth(packageName, readAuth)` — providerAuth seam returning auth.json entries only to first-party plugins, read failure → `undefined`. Shared by server.ts providerAuth + `/api/plugins` `firstParty`. See change: promote-model-roles-settings.
