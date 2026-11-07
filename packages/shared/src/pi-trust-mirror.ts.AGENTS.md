# pi-trust-mirror.ts — index

Dashboard-trust → pi mirror shared core. `piTrustKey(path,{home})` = pi's trust-store key (realpath∘resolve, no Unicode-space normalisation; relative throws). `mirrorDenyRules`/`isMirrorDenied` (own deny list, reuses forbidden-subjects values read-only). `filterMirrorEntries` → counted + ignored-with-reason. `decidePiTrust` = recorded pi entry → implicit → dashboard trust (over `never`) → default (pi 1.5 order; See change: update-pi-core-1-5-adopt-apis). `findCoveringEntry`, `statFolderIdentity`, `identityMatches`. Node-only; client imports `pi-trust-mirror-types.ts`. Never writes trust.json. See change: mirror-dashboard-trust-to-pi.

`statFolderIdentityAsync(dir,signal)` async identity probe for the bridge deadline; `MIRROR_SOURCE_LABELS.yolo`; `PiTrustSource` dashboard variant + `mirrorEntry` carry optional `lifetime`. See change: mirror-dashboard-trust-live-remote.

`ancestorKeys(key, pathApi?)` walks with an injectable path module (default native). See change: update-pi-core-1-5-adopt-apis.
