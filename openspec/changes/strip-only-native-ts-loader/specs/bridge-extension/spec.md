## REMOVED Requirements

### Requirement: Bridge anchors jiti loader resolution at the active earendil pi cli
**Reason**: Bridge auto-start launches the dashboard server with the Node-native loader only, so the bridge never resolves a jiti loader for the server. pi's own jiti, which loads the bridge itself, is unaffected.
**Migration**: None. The "Cannot find pi's TypeScript loader (jiti)" auto-start error no longer exists.
