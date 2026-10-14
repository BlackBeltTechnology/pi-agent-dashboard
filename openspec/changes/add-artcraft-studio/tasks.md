## 0. Gating

- [ ] 0.1 Capture code-signing identities: macOS Team ID of `ArtCraft.app` (`codesign -dv`), Windows Authenticode publisher of the msi
- [ ] 0.2 Read the desktop app's login-challenge usage; document the flow (browser approval vs code) in design.md
- [ ] 0.3 Ask ArtCraft team (Discord) about hosted MCP transport URL/protocol and third-party client policy; record answer
- [ ] 0.4 Keychain access approach per OS without new heavy deps (macOS `security`, Windows `cmdkey`/PowerShell, Linux `secret-tool`), else 0600 file

## 1. Studio management (TDD)

- [ ] 1.1 Tests: signature-identity mismatch fails closed, optional SHA pin, Linux unsupported, status offline, open/launch without install
- [ ] 1.2 Implement install/update/status/launch/open

## 2. Account session (TDD)

- [ ] 2.1 Tests: login timeout stores nothing, token redaction in all outputs, atomic rotation under concurrent refresh (lock), 0600 fallback, offline logout
- [ ] 2.2 Implement login/whoami/logout + session store

## 3. Hosted MCP bridge (TDD, flag-gated)

- [ ] 3.1 Tests against a local fake MCP endpoint: flag unset/non-https, auth refresh-once, serialized calls, credit acknowledgement gate, registration
- [ ] 3.2 Implement bridge; live test only after 0.3 yields an endpoint

## 4. Skill + docs + QA

- [ ] 4.1 `artcraft-studio` skill (when to use vs nano-banana/veo/craft apps, hand-off via `open`, credits, untrusted remote output)
- [ ] 4.2 README + `AGENTS.md` rows; DocScribe docs page section
- [ ] 4.3 Manual: install + open a FilmCraft frame export in ArtCraft on macOS
- [ ] 4.4 `review-code`; Audit subagent pass (auth/secrets)
- [ ] 4.5 Follow-up change stub: credential-vault machine-rotated account kind
