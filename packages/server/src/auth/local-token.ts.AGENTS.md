# local-token.ts — index

Local-IPC allowlist token (D10, narrowed). `ensureLocalToken(dir?)` writes high-entropy secret to `~/.pi/dashboard/local/token` (dir 0700, file 0600), reused across restarts. `verifyLocalToken(headers, expected)` constant-time compare of the DEPRECATED raw `X-Pi-Local-Token` header — only the legacy leg of `local-credential.ts` now; exemption sites read `hasLocalCredential`. Affirmative genuine-local credential for same-host process callers, independent of forgeable loopback IP. See change: add-server-keypair-pairing.

Root: `defaultLocalTokenDir(env?)` resolves through `dashboard-paths.ts::getDashboardConfigDir` (NOT `os.homedir()`), so the token shares one HOME root with the rendezvous record and the gateway socket and honours an injected `homedir`. See change: add-pi-gateway-transport-identity (task 2.0g).

`readLocalTokenIfPresent(dir?)`: read-only; `null` when absent, unreadable or empty; never creates dir or file. Used by `pi-dashboard pair`; `safeEnsureLocalToken` stays for `open`/`login`. See change: fix-pairing-approval-credential.
