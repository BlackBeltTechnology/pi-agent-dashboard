# vault-session-bindings.spec.ts — index

Playwright E2E. L3 F2 (pending-confirmation → Confirm → delivered, no reload; origin set via faux scenario in a throwaway session) + F4 (delivered / local-override via `DEBIAN_FRONTEND` / revoked + running-process note). See change: add-credential-vault. `OperatorSession.arm` narrows through `narrowTrust`; restore per test by reap fixture (`op.restore` removed). See change: triage-browser-e2e-offbox-poison.
