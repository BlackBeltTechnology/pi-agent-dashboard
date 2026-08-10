# flows-anthropic-bridge-peer-probe Specification

## Purpose

Determine whether the two peer packages the flows-anthropic-bridge depends on — the anthropic-messages plugin and pi-flows — are present, using a synchronous, side-effect-free, deterministic probe. The probe resolves peers across two tiers (Node module resolution, then a pi-packages settings fallback), accepts a legacy pre-rescope package name for the anthropic-messages peer, uses a flow-listener signal as a backup indicator for pi-flows, and reports per-peer presence plus how each hit was detected so the caller can choose the correct import strategy.

## Requirements

### Requirement: Two-tier peer resolution

The probe SHALL resolve a peer specifier by trying Node's synchronous resolver first, then an optional pi-packages fallback, and SHALL report which tier produced a hit.

#### Scenario: Tier 1 Node resolution succeeds

- WHEN the Node resolver (`deps.resolve`) resolves the peer specifier without throwing
- THEN the peer probe SHALL report the peer present (`ok: true`)
- AND the probe SHALL report `via: "node"`
- AND the probe SHALL NOT set `entryPath`

#### Scenario: Tier 1 fails, tier 2 pi-packages fallback succeeds

- WHEN the Node resolver throws for the peer specifier
- AND the optional pi-packages fallback (`deps.resolvePiPackage`) returns an object whose `entryPath` is a non-empty string
- THEN the peer probe SHALL report the peer present (`ok: true`)
- AND the probe SHALL report `via: "pi-packages"`
- AND the probe SHALL report the resolved absolute `entryPath`

#### Scenario: Both tiers fail — peer absent

- WHEN the Node resolver throws for the peer specifier
- AND the pi-packages fallback is absent, returns null, or returns an object without a non-empty string `entryPath`
- THEN the peer probe SHALL report the peer absent (`ok: false`)
- AND the probe SHALL report `reason` set to the tier-1 resolver error message

### Requirement: Anthropic-messages peer with legacy-name back-compat

The probe SHALL probe the anthropic-messages peer under its current name first and then its legacy pre-rescope name, accepting the first tier-successful hit.

#### Scenario: Current name resolves

- WHEN probing the anthropic-messages peer
- AND `@blackbelt-technology/pi-anthropic-messages` resolves via either tier
- THEN the anthropic-messages result SHALL report present
- AND the legacy name SHALL NOT be probed further

#### Scenario: Legacy name hit after current name misses

- WHEN `@blackbelt-technology/pi-anthropic-messages` fails both tiers
- AND the legacy name `@pi/anthropic-messages` resolves via either tier
- THEN the anthropic-messages result SHALL report present
- AND the result SHALL reflect the tier that resolved the legacy name

#### Scenario: Neither name resolves

- WHEN neither `@blackbelt-technology/pi-anthropic-messages` nor `@pi/anthropic-messages` resolves via any tier
- THEN the anthropic-messages result SHALL report absent
- AND the `reason` SHALL be the failure reason of the last probed name

### Requirement: pi-flows peer with flow-listener backup signal

The probe SHALL consider the pi-flows peer present if EITHER its module (`pi-flows`) resolves via any tier OR a backup flow-listener signal indicates at least one active listener.

#### Scenario: pi-flows module resolves

- WHEN the `pi-flows` module resolves via tier 1 or tier 2
- THEN the pi-flows result SHALL report present with the resolving tier's `via` (and `entryPath` when tier 2)

#### Scenario: Module absent but flow listener active

- WHEN the `pi-flows` module fails both tiers
- AND the optional `flowsListenerCount` returns a count greater than zero
- THEN the pi-flows result SHALL report present
- AND the result SHALL report `via: "node"`
- AND the `reason` SHALL indicate detection via the `flow:register-agent-extension` listener

#### Scenario: Module absent and no listener

- WHEN the `pi-flows` module fails both tiers
- AND `flowsListenerCount` is absent or returns zero
- THEN the pi-flows result SHALL report absent
- AND the `reason` SHALL be the module failure reason, or "pi-flows event listeners absent" when no module reason exists

### Requirement: Aggregate probe result

The probe SHALL return a combined result reporting each peer and whether both are present.

#### Scenario: Combined result shape

- WHEN `probeAll` runs with a set of dependencies
- THEN the result SHALL contain an `am` peer probe and a `flows` peer probe
- AND `bothPresent` SHALL be true only when both `am.ok` and `flows.ok` are true

#### Scenario: Determinism and purity

- WHEN `probeAll` runs with the same dependency functions
- THEN the probe SHALL produce the same result without side effects
- AND resolution SHALL be synchronous
