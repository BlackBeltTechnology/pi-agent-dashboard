# TunnelButton.tsx — index

Exports `TunnelButton`. Toolbar **Remote access** button: `mdiAccessPointNetwork` + state dot (`failed`/`partial`/`internet`/`network`/`local`) + waiting-request badge; state also in `title`/`aria-label` (`Remote access: <state>[, N device(s) waiting]`). `data-tone`, `data-testid="tunnel-btn"`. Click ALWAYS opens the lazy `RemoteAccessDialog` on its landing.

State: `remoteAccessIndicator(status, resolvedBindHost|null, pending)`. Polls `/api/tunnel-status` every 30s (plus the gated detail when providers are planned, for `failed`); bind host from `reachabilityStore` (no polling of guarded config); pending count from `pairingApprovalStore`. Resumes a run saved by Listen on network on mount and when the RESOLVED bind host changes (`takeFreshRun`, <2 min, key always removed). See change: add-remote-access-wizard (prior: add-tunnel-providers).
