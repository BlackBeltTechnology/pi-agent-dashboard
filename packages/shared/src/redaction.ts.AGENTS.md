# redaction.ts — index

`REDACTION_VERSION`=1; `REDACTION_PATTERNS_V1`: PEM private key block, `Authorization: Bearer`, bare `Bearer`, `sk-…{16,}`, `(api|access|secret)[_-]?key[:=]`, `password[:=]`, AWS `AKIA…`. `redactSecrets(text)` replaces matches with `[REDACTED]`. Best-effort, not a security boundary. Bump version + add `_V<N>` when patterns change. Test: `__tests__/redaction.test.ts`. See change: add-pending-question-stack.
