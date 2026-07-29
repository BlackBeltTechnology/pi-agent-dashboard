# Tasks — compact-session-card-details

## 1. Session-card toggle

- [ ] 1.1 Add desktop-local compact/expanded state and an accessible details
      toggle to `SessionCard`. → verify: component test initially finds the
      “Show details” control with `aria-expanded="false"`.
- [ ] 1.2 Put only the existing detail subcard region behind the toggle; retain
      the card's scan and attention signals outside it. → verify: component
      test finds a status/title signal while detail content is absent in compact
      state, then present after activation.
- [ ] 1.3 Preserve the existing mobile-card branch unchanged. → verify: mobile
      test still renders its current simplified session-card contract.

## 2. Regression coverage

- [ ] 2.1 Test toggle interaction, accessible state, and click propagation
      (expanding must not invoke session selection). → verify: test clicks the
      toggle, observes `aria-expanded` transition, and asserts `onSelect` was
      not called.
- [ ] 2.2 Test critical attention signals stay visible in compact mode. →
      verify: fixtures for error/approval/activity preserve their existing
      visible marker when the details region is collapsed.

## 3. Verification

- [ ] 3.1 Run targeted `SessionCard` tests. → verify: test command exits 0.
- [ ] 3.2 Run the client typecheck/build command documented by the package. →
      verify: exits 0.
