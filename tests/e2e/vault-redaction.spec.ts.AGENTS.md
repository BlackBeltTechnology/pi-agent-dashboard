# vault-redaction.spec.ts — index

Playwright E2E. L3 X13 (real bash env: `LEN=undefined` before the grant, `LEN=10` after) + F3 (`printenv` renders `[REDACTED:GEMINI_API_KEY]`; DOM sampled on every mutation). See change: add-credential-vault. `OperatorSession.arm` narrows through `narrowTrust`; restore per test by reap fixture (`op.restore` removed). See change: triage-browser-e2e-offbox-poison.
