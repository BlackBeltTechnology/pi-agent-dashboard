# runtime-plugin-csp-enforce.spec.ts — index

L3 X12 (8.126). Skips unless the document carries `Content-Security-Policy` (boot with `PI_DASHBOARD_CSP=enforce`). Trusted canary renders styled, 0 plugin-assets violations; blob module import blocked (1 script-src blob violation). See change: decouple-plugins-from-core.
