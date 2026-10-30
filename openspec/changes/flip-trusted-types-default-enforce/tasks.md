## 1. Pre-flip soak gate (evidence before any code change)

- [ ] 1.1 Confirm `add-trusted-types-shadow-enforce` and `enforce-trusted-types-default` are released; record the release version, the live `PI_DASHBOARD_CSP` resolution and the number of deployments contributing evidence
- [ ] 1.2 Opening canary, reset, restart; record window start (see proposal § Pre-flip soak gate)
- [ ] 1.3 Enforce rehearsal incl. `/settings/security` with `forceTtMode(page,"enforce")`, plus `trusted-types-visual.spec.ts` green
- [ ] 1.4 Soak window evidence (manual-only): ≥14 days spanning ≥1 release, all gate counters zero, closing canary

## 2. Plan the flip (plan-proposal)

- [ ] 2.1 Author the spec delta, design and test-plan (carry over old F1–F4: default-enforce E2E, budget/WF4 pinned to report, header-kind guards, runtime-plugin TT-enforce case; old M2 dev-server smoke)

## 3. Flip and verify

- [ ] 3.1 Flip the default branch in `packages/shared/src/trusted-types-mode.ts`; update the `docker/compose.test.yml` and `docker/test-up.sh` comments
- [ ] 3.2 Align the E2E specs; CHANGELOG BREAKING entry; docs; sibling `enforce-strict-csp-default` sentence
- [ ] 3.3 Post-flip: unit suites, Playwright E2E with the mode unset, dev server under enforce, `review-code`
