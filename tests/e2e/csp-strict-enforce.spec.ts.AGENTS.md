# csp-strict-enforce.spec.ts — index

WF2/WF3/WF6/WF7 under `PI_DASHBOARD_CSP=enforce`: no `unsafe-*`, nonce == import-map nonce, inline-script blocking, SW + deep-link nonce freshness. Skips without an enforcing header. See change: harden-cors-and-csp-reporting.
