## 1. Report-only header

- [ ] 1.1 Add a failing test: report mode emits `require-trusted-types-for 'script'` in `Content-Security-Policy-Report-Only` (packages/server/src/auth/csp tests)
- [ ] 1.2 Add a failing test: enforce mode and off mode do NOT carry the directive
- [ ] 1.3 Add the directive to the report-only header in `csp.ts` only
- [ ] 1.4 Verify the existing baseline-CSP scenarios still pass

## 2. Default policy

- [ ] 2.1 Add a failing test: bootstrap registers the default policy exactly once when `trustedTypes` exists
- [ ] 2.2 Add a failing test: bootstrap is a no-op without `window.trustedTypes`
- [ ] 2.3 Register the DOMPurify-backed default policy in `main.tsx`

## 3. Mermaid named policy

- [ ] 3.1 Add a failing test: the Mermaid colorize output is produced through the named `pi-mermaid` policy
- [ ] 3.2 Route the colorize step through the named policy in MermaidBlock.tsx
- [ ] 3.3 Verify the reference diagram set renders pixel-identically (within the documented tolerance)

## 4. Script-URL sinks

- [ ] 4.1 Decide per sink (Monaco worker, pdf.js worker, service worker) whether to wrap or document an exception; record the decision in design.md
- [ ] 4.2 Implement the chosen wrapping or exception for each sink

## 5. Measurement

- [ ] 5.1 Promote the spike harness from /tmp/tt-spike into tests/e2e/ as a report-only violation spec
- [ ] 5.2 Record the per-route violation budget as a tracked artifact
- [ ] 5.3 Add a failing check if a route's count exceeds the recorded budget

## 6. Verification

- [ ] 6.1 Run the full client and server unit suites
- [ ] 6.2 Run the Trusted Types measurement spec against the production build
- [ ] 6.3 Confirm no user-visible behaviour change in report mode (manual, deferred to review)
