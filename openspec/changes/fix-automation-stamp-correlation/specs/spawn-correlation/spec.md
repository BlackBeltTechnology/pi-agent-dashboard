## ADDED Requirements

### Requirement: Automation-run stamps are consumed by spawn token

A pending automation-run stamp SHALL be claimed by the exact session the spawn
produced, identified by the `spawnToken` minted for that spawn invocation and
echoed back on the bridge's first `session_register`. The stamp registry SHALL
support binding a queued stamp to its spawn token once the spawn call resolves,
and SHALL resolve a claim in two tiers:

1. **Exact token** — when the registering session carries a `spawnToken` and a
   queued stamp is bound to that token, THAT stamp SHALL be claimed, regardless
   of its position in the cwd queue.
2. **Unbound fallback** — otherwise the oldest queued stamp that has NO bound
   token SHALL be claimed. A stamp bound to a token SHALL NOT be claimable by
   any other token, and SHALL NOT be claimable by the unbound fallback.

When neither tier matches, no stamp SHALL be claimed and the registering session
SHALL be left unstamped. Enqueue SHALL remain possible before the spawn call
resolves, so a bridge that registers faster than the spawn promise cannot lose
its stamp.

#### Scenario: Two plugins spawning into one cwd each get their own stamp

- **GIVEN** two independent spawns into the same `cwd`, each enqueuing its own
  automation-run stamp and each bound to its own `spawnToken`
- **WHEN** the second spawn's session registers first, carrying its own token
- **THEN** it SHALL be stamped with ITS OWN run identity
- **AND** the first spawn's stamp SHALL remain queued for the session that
  carries the first token.

#### Scenario: A foreign session never claims a token-bound stamp

- **GIVEN** a queued automation-run stamp bound to a spawn token
- **WHEN** a session registers in the same `cwd` carrying a different
  `spawnToken`, or carrying none at all
- **THEN** that session SHALL NOT be stamped with the bound run identity
- **AND** the stamp SHALL stay queued.

#### Scenario: Register racing the spawn resolution still claims its stamp

- **GIVEN** an automation-run stamp enqueued for a `cwd` whose spawn call has not
  yet returned a token, so the stamp is still unbound
- **WHEN** the spawned session registers
- **THEN** it SHALL claim that unbound stamp via the fallback tier.

#### Scenario: Legacy tokenless spawn path is unchanged

- **GIVEN** a spawn path that produces no `spawnToken`, leaving its stamp unbound
- **WHEN** its session registers without a `spawnToken`
- **THEN** the oldest unbound stamp for that `cwd` SHALL be claimed, preserving
  the existing FIFO behaviour.
