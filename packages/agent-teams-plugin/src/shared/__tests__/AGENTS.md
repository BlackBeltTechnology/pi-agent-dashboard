# DOX — packages/agent-teams-plugin/src/shared/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `mail-format.test.ts` | Test-plan S1 (envelope round trip, unknown kind tolerated), S2 (150-line cap, marker inside, blank-run collapse), S18 (kind → customType registry), S62/S140 (single-source constants), forged-envelope/fake-item primitives (S94/S95), plus the rows that drive the server with them: message size (S3), kinds the server creates (S18 server half), `kind_reserved` (S139), forged envelope (S94), fake lifecycle items (S95), op sanitiser (S98). |
| `text.test.ts` | Sanitiser (C0/C1/ANSI/bidi strip, `\n`/`\t` kept, ZWJ intact) and code-point counting/cutting. |
