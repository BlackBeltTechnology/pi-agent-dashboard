# runtime-plugin-csp-enforce.spec.ts — index

L3 X12 (8.126). Skips unless the document carries `Content-Security-Policy` (boot with `PI_DASHBOARD_CSP=enforce`). Trusted canary renders styled, 0 plugin-assets violations; blob module import blocked (1 script-src blob violation). See change: decouple-plugins-from-core.

Runs on the DEFAULT lane (unset `PI_DASHBOARD_CSP` enforces); skips on the report lane, skip message names `PI_DASHBOARD_CSP`. See change: enforce-strict-csp-default.

Arms `armFirstLaunchDismiss` before navigating (first-launch display modal hid the claim on a fresh harness). See change: enforce-strict-csp-default.
