## MODIFIED Requirements

### Requirement: Three-tier link in `headlessPidRegistry`

`headlessPidRegistry` SHALL link a registering session to its spawn entry through three tiers in priority order: (1) token match, (2) pid match, (3) cwd-FIFO fallback. Tiers 2 and 3 exist so a session that registered without a token can still be linked to its spawn entry for identity-independent bookkeeping. Tiers 2 and 3 SHALL be skipped for a register whose pid target is not local (`force-kill-handler` *A recorded pid is used only in its resolved pid target*). For an `unknown` target, tier 2 SHALL match only an entry with the register's `cwd`.

Plugin-ownership resolution (`pluginRef`) SHALL use tier 1 (token) only; tiers 2 and 3 SHALL NOT assign a `pluginRef`. Automation stamp delivery SHALL ride the tier-1 token seam rather than a cwd-FIFO stamp registry, closing the tier-3 same-cwd race for automation ownership.

#### Scenario: Token match wins over pid and cwd

- **WHEN** a registering session presents a spawn token that matches an entry
- **THEN** that entry SHALL be linked by token, regardless of any pid or cwd match

#### Scenario: Pid match used when token is absent

- **WHEN** a registering session with a `host` pid target presents no token but a pid that matches an unlinked entry
- **THEN** that entry SHALL be linked by pid

#### Scenario: Cwd-FIFO fallback used when token and pid both absent

- **WHEN** a registering session presents neither a matching token nor a matching pid
- **THEN** the first unlinked entry for its cwd SHALL be linked
- **AND** no `pluginRef` ownership SHALL be assigned by this cwd match

#### Scenario: Automation ownership resolves by token, not cwd

- **WHEN** an automation-owned session registers with its spawn token
- **THEN** its automation identity SHALL resolve via the token seam
- **AND** two automation sessions spawned into one cwd SHALL each resolve their own identity

#### Scenario: Stale token degrades to lower tier

- **WHEN** a registering session presents a spawn token that matches no live entry
- **THEN** linking SHALL fall through to the pid tier, then the cwd-FIFO tier (for a non-local pid target, tiers 2 and 3 SHALL be skipped)
- **AND** no `pluginRef` ownership SHALL be assigned by the lower tiers

#### Scenario: Already-linked entry is skipped at every tier

- **WHEN** an entry already has a linked sessionId
- **THEN** it SHALL NOT be re-linked by any of the token, pid, or cwd tiers

#### Scenario: A non-local pid is never linked by pid or cwd
- **WHEN** a register whose pid target is WSL or `foreign` carries no matching token
- **THEN** it SHALL NOT be linked by pid or by cwd order
