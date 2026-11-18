# csp-strict-enforce.spec.ts — index

WF2/WF3/WF6/WF7 on the DEFAULT lane (unset `PI_DASHBOARD_CSP` enforces): one enforcing strict header, no baseline, no `unsafe-*`, nonce == import-map nonce, same-origin WS connects, 0 violations, inline-script blocking, SW + deep-link nonce freshness. Skips without an enforcing header. See change: harden-cors-and-csp-reporting, enforce-strict-csp-default.

WF2 arms `armFirstLaunchDismiss` (fresh harness shows the first-launch display modal over `/settings/plugins/<id>`; WF2 never ran before the default flip). See change: enforce-strict-csp-default.
