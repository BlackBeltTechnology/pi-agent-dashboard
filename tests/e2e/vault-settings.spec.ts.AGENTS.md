# vault-settings.spec.ts — index

Playwright E2E. L3 F1 (labels only; no `/api/vault*` body or DOM text carries a value) + F5 (plugin approval persists across reload; demo `vault-read` present only while approved). See change: add-credential-vault. `OperatorSession.arm` narrows through `narrowTrust`; restore per test by reap fixture (`op.restore` removed). See change: triage-browser-e2e-offbox-poison.
