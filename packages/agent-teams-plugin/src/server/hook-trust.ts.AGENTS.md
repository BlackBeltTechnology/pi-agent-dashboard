# hook-trust.ts — index

TOFU store `<dataDir>/hook-trust.json` keyed `realpath(cwd)`+hash; fail closed on corrupt file; serialised atomic writes. `decideHookTrust`/`trustHook`/`revokeHookTrust` (no hash ⇒ all for cwd), `describeHooks`, `registerHookTrust`. Revocation gates later starts only. See change: add-agent-teams-templates-hooks.
