# credential-detect.ts — index

Detects configured LLM-provider credential. `hasAnyProviderCredential(homeDir?)` OR-merges `~/.pi/agent/settings.json` + `~/.pi/agent/auth.json`; never logs/returns secret values. `inspectedCredentialFiles(homeDir?)` returns the two probed paths.
