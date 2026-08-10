# local-token.ts — index

Local-IPC allowlist token (D10, narrowed). `ensureLocalToken(dir?)` writes high-entropy secret to `~/.pi/dashboard/local/token` (dir 0700, file 0600), reused across restarts. `verifyLocalToken(headers, expected)` constant-time compare of `X-Pi-Local-Token` header. Affirmative genuine-local credential for same-host process callers, independent of forgeable loopback IP. See change: add-server-keypair-pairing.
