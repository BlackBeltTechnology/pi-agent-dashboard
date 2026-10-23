# trust-mode.ts — index

Trust-mode resolver. `effectiveTrustMode()`, `trustModeOf`, `admissionTrustedNetworks(fallback)` = live admission list, `[]` under `pair`; ONE source for every admission site. `setBootTrustFallback`, `resetTrustModeForTests`. Unrecognised value → `pair` fail-closed, warns once per process per value. See change: retire-trusted-networks-bypass.
