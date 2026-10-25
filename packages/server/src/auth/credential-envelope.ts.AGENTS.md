# credential-envelope.ts — index

Whole-file AES-256-GCM envelope for `plugin-credentials.json` + `vault.json`. Pure: no key resolution, no logging.
File = line 1 `pi-dashboard-encrypted:v1`, line 2 JSON `{alg:"A256GCM",kid,iv,tag,ct}`. AAD `pi-dashboard:v1:<fileId>`. Fresh 12 B IV per write. `kid` = first 8 B of SHA-256(`"pi-dashboard-kid\0"`‖key) hex.
`classify(bytes)` → `absent|envelope|plaintext|unsupported|damaged|corrupt`. Strip one BOM; CRLF + trailing newline ok; prefix check case-sensitive. Magic prefix `pi-dashboard-encrypted:` ⇒ never `corrupt`: unknown version `unsupported`; bad v1 header (missing/non-JSON line 2, field missing, bad base64, iv≠12 B, tag≠16 B, alg≠A256GCM, extra non-empty line) `damaged`.
`decodeEnvelope(bytes,key,fileId)` → `document|locked{key_mismatch|unsupported_format|envelope_damaged}|not-envelope`. Never a partial document.
`createEnvelopeCodec(fileId,getKey)` → `JsonFileCodec` for `locked-json-file`. `getKey()` may answer "not ready" with a key reason ⇒ envelope decodes `locked`, plaintext still reads, `encode` throws `CredentialLockedError{code:"credential_locked",reason}` (message carries the shared remedy). `encode(data, existing)` refuses to overwrite a locked envelope.
See change: encrypt-credentials-at-rest (D1, D2, D3).
