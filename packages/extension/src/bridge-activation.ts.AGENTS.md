# bridge-activation.ts — index

Activation gate `shouldActivateBridge(env, readConfig)`: `bridgeEnvOverride(env)` (`PI_DASHBOARD_BRIDGE` off/0/false/no → false, on/1/true/yes → true) else `readConfig().enabled`; recognised env skips the config read; any throw → `true` (fail open); silent. Called first in `bridge.ts` default export. See change: add-bridge-env-opt-out.
