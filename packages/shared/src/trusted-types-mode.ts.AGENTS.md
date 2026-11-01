# trusted-types-mode.ts — index

`resolveTrustedTypesMode({env,config,cspMode})` → `{mode,source,warnings}`; `recognizeTrustedTypesMode`. env → `security.trustedTypes` → default; unrecognized → `report` + warning (no raw value). See change: enforce-trusted-types-default.
