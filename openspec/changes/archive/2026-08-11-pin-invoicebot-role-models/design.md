# Design — pin-invoicebot-role-models

## Context

Two independent model-selection planes exist:

```
spawn plane   pinned by spawn-model.ts ──► session boots on this model
role plane    role map (providers.json) ──► @classification / @extraction /
                                            @bank-intake / @rule-authoring /
                                            @validation / @fast / @smart
```

`pin-invoicebot-spawn-model` closed the spawn plane. The role plane is still
free to disagree, and did.

## Decision 1 — report, never auto-rewrite

The role map is operator-owned configuration (edited from the settings UI). A
plugin silently rewriting it would fight the operator and erase a deliberate
choice. The audit therefore returns findings and logs them; correcting the map
stays an explicit operator action.

## Decision 2 — divergence is defined against the PIN, not a vendor deny-list

A role is divergent when it does not equal the resolved spawn model. That is
provider-agnostic: it catches every wrong provider (including ones nobody
anticipated) without maintaining a list of banned vendor names that would rot.
`provider` and `modelId` are compared through the same `parseModelRef` the spawn
plane uses, so a cosmetic difference (whitespace) is not reported as divergence.

## Decision 3 — `unset` is a distinct finding from `divergent`

An empty role string is not a wrong model, it is *no* model: the agent falls
through to a host default. Those fail differently and are worth separate words in
the log, so the operator knows whether to fix a value or add one.

## Decision 4 — the active preset is audited too

`providers.json` carries `roles` (the effective map) plus named `rolePresets` and
an `activePreset`. Loading a preset overwrites the effective map, so a preset
containing a divergent role is a latent regression. Both surfaces are audited;
findings carry which surface they came from.

## Decision 5 — reading is defensive and side-effect free

`readRoleMap(home)` resolves `<home>/.pi/agent/providers.json`, and returns an
empty map for: missing file, unreadable file, invalid JSON, or a `roles` value
that is not an object. Activation must never fail because a config file is
malformed — that would turn a cosmetic misconfiguration into an outage.

## Decision 6 — no audit when nothing is pinned

If the spawn plane resolves no model (no plugin config, no dashboard default, no
`IB_MODEL`), there is no reference to compare against, so the audit is skipped
and says so. Auditing against a guessed reference would produce false alarms.

## Security

Role identifiers only. `auth.json` is never opened; the audit cannot reveal
whether a credential exists, only which model id a role names.

## Risks

- A deployment that deliberately runs one role on a cheaper model will now see a
  divergence line every boot. Accepted: it is a log line, not an error, and the
  alternative is the silent failure this change exists to end.
