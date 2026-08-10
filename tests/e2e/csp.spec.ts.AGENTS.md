# csp.spec.ts — index

Baseline CSP e2e (§7). Asserts a CSP header (report-only or enforce) present on `/` with default-src/object-src/frame-ancestors self, AND the shell renders with zero CSP console violations (report-only clean signal gating enforce flip). See change: improve-content-editor.
