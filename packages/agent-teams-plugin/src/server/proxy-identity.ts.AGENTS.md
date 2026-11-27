# proxy-identity.ts — index

Lead-proxied member identity: `mintProxyToken` (32 bytes hex), `tokensEqual` (constant-time, equal-length only), `asClaimOf` (own-prop `as {member,token}`; malformed ⇒ `null`), `resolveProxied` (socket = lead of an `in-process` team, then token, then member live; mismatch ⇒ `forbidden`, gone member + valid token ⇒ `member_gone`; dummy compare for unknown member), `scrubProxyTokensOnClose`. See change: add-agent-teams-in-process.
