# plugin-credential-store.ts — index

`createPluginCredentialStore(pluginId, path?)` over `~/.pi/agent/plugin-credentials.json` `{pluginId:{key:record}}`. Own namespace only. `get`/`list`(keys)/`snapshot`/`set`/`remove`/`update(key,fn)` (sync fn inside lock; `undefined` deletes). Keys 1–200, `__proto__`/`constructor`/`prototype` rejected; record ≤64 KiB; ≤256 keys, ≤2 MiB per namespace; `PluginCredentialError{code}`. Unlocked reads never create the file; `structuredClone` copies. See change: expose-plugin-credential-and-oauth-seams.
