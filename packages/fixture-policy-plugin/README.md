# fixture-policy-plugin (TEST FIXTURE)

Trusted host access policy plugin for the identity-plane E2E harness
(openspec: `add-multi-user-identity-plane` §11.2). **Not published; never used
in production.**

Registers a `HostAccessPolicyFn` on the identity seam via
`ctx.registerHostAccessPolicy`. The dashboard trusts it only when
`identity.trustedPolicyPlugin` names this plugin's id (`fixture-policy`).

## Decision model

Config-seeded allow-list. A non-session road is permitted iff some `allow`
entry matches the principal (`sub`, and `iss` when the entry pins one) AND
grants the action (`*` or omitted `actions` ⇒ all). Otherwise **deny**
(default-deny). Session roads are owner-gated and never routed here.

```jsonc
{
  "enabled": true,
  "allow": [
    { "iss": "http://keycloak:8080/realms/pi-identity", "sub": "<anna-sub>", "actions": ["domain.event"] }
  ]
}
```

With only Anna's `sub` listed, Anna receives domain-event fan-out while Béla
(non-owner) reaches none of it — the two-user isolation guarantee the E2E
asserts.

## Test

```bash
npx vitest run --root packages/fixture-policy-plugin
```
