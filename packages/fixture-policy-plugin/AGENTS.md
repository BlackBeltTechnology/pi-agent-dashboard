# DOX — packages/fixture-policy-plugin

Files in this directory. One row per file. TEST FIXTURE, not published. See change: add-multi-user-identity-plane.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Trusted host access policy fixture for identity-plane E2E (§11.2). Registers `HostAccessPolicyFn` via `ctx.registerHostAccessPolicy`; trusted only when `identity.trustedPolicyPlugin` = `fixture-policy`. Config-seeded allow-list decision model. |
