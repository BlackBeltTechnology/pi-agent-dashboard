## ADDED Requirements

### Requirement: `pluginRef` is filed under the spawn token before the spawn await

When a plugin spawns a session with a `pluginRef`, the host SHALL record the association `spawnToken → pluginRef` in a **token-keyed pending store** (the unified pending registry that replaces the two per-feature clones) **before** awaiting `spawnPiSession`, so that a `session_register` arriving during the spawn await resolves the ref rather than missing it. This pending store is keyed by token, not by pid — it does not depend on `headlessPidRegistry.register`, which cannot run until a pid exists post-spawn. On first register the resolved ref is promoted onto the linked `headlessPidRegistry` entry (alongside the sessionId link) and the owning plugin is notified. No new correlation key is introduced; the token is the key.

**Retention.** Because token keys are unique (1:1), the unified store SHALL NOT carry the legacy per-cwd FIFO cap of 8; that cap was a per-cwd-queue artifact and does not apply to a token-keyed map. The store SHALL retain a filed `spawnToken → pluginRef` entry for a 60s TTL (preserving `PENDING_*_TTL_MS = 60_000`) and sweep stale entries on touch, with no entry cap. A `session_register` arriving after its token's TTL has elapsed SHALL resolve no ref: the session becomes **unowned** and its ownership does not fall through to a lower correlation tier (cwd never confers ownership). This unowned session is consequently recovery-eligible under `recover !== false` (it never received a `recover: false` byte) — an accepted documented edge, since a register delayed more than 60s past spawn is already abnormal.

#### Scenario: Register past the 60s TTL resolves no ref and is recovery-eligible

- **WHEN** a session registers with its spawn token more than 60s after the ref was filed, so the TTL sweep has dropped the entry
- **THEN** the host SHALL resolve no `pluginRef` and the session SHALL be unowned
- **AND** ownership SHALL NOT fall through to the pid or cwd tier
- **AND** the unowned session SHALL be treated as `recover !== false` (recovery-eligible)

#### Scenario: Many concurrent pending entries are bounded only by TTL

- **WHEN** more than 8 plugin-owned sessions are spawned concurrently, each filing its own token entry before any registers
- **THEN** no entry SHALL be dropped by a cap
- **AND** every one of them SHALL resolve its own `pluginRef` on register within the TTL

The owning plugin SHALL be notified of its resolved session **before** the host forwards the session's first event to plugins and **before** any pending prompt is dispatched to it, so a plugin that correlates by its own ref does not miss the first event or prompt. This ordering is load-bearing: today pending-prompt dispatch runs in `onSessionRegistered` **before** token linking occurs in the `session_register` handler. The seam SHALL move ref resolution + owner notification ahead of pending-prompt dispatch and first-event forwarding, so correlation precedes dispatch rather than following it.

If the spawn fails, the host SHALL remove the filed `spawnToken → pluginRef` association. The removal SHALL be token-keyed and idempotent: it removes only the entry for that exact token, and it is a no-op if a `session_register` already consumed the token (so a failure result arriving after a successful register cannot strip a live session's ref, and cannot delete a later same-cwd spawn's entry).

#### Scenario: Register during the spawn await still resolves the ref

- **WHEN** a session registers with its spawn token after the ref was filed but before `spawnPiSession` returns
- **THEN** the host SHALL resolve the session's `pluginRef` from the token-keyed pending store
- **AND** the resolution SHALL NOT fall through to a lower correlation tier

#### Scenario: Owner is notified before the first event and prompt

- **WHEN** a plugin-owned session registers and resolves its ref
- **THEN** the owning plugin SHALL be notified before the host forwards the session's first event
- **AND** before any pending prompt is dispatched to that session

#### Scenario: Failed spawn removes only its own token entry

- **WHEN** filing `spawnToken → pluginRef` succeeds but `spawnPiSession` then fails
- **THEN** the host SHALL remove only that token's association so no later session resolves a stale ref

#### Scenario: Late failure after a register is a no-op

- **WHEN** a `session_register` consumes the token, and a spawn-failure result then arrives for the same token
- **THEN** the rollback SHALL be a no-op
- **AND** the already-registered session SHALL keep its resolved `pluginRef`

### Requirement: Keeper-respawn continuity rides the persisted entry, not the token

The spawn token is single-use and is deleted from the child env on every keeper relaunch after the first, so a keeper-respawned session registers with a **new sessionId, a new pi pid, and no token**. Ownership continuity across a keeper respawn SHALL therefore ride the persisted keeper-mediated `headlessPidRegistry` entry (stable `keeperPid`, with the resolved `pluginRef` persisted on the entry as `goalId` is today), NOT the consumed token. Because the current tokenless register path resolves only by pi `pid`/`piPid`, the seam SHALL add a keeper-mediated re-link: when a tokenless register arrives for a keeper-managed entry whose `keeperPid` still matches, the host SHALL relink that entry to the new sessionId and refresh the stale `piPid`, so the respawned session reaches its existing owner ref. An in-process fork, which mints a tokenless sessionId with no keeper entry of its own, SHALL NOT inherit the ref (consistent with cwd never conferring ownership).

#### Scenario: Keeper respawn keeps the same owner

- **WHEN** pi crashes and the keeper relaunches it, producing a new sessionId, a new pi pid, and no token, while `keeperPid` is unchanged
- **THEN** the host SHALL relink the persisted keeper entry to the new sessionId by `keeperPid`, refreshing `piPid`
- **AND** the respawned session SHALL resolve the same `pluginRef` via that entry

#### Scenario: In-process fork does not inherit the owner

- **WHEN** a session is forked in-process, minting a tokenless sessionId
- **THEN** it SHALL NOT inherit the parent session's `pluginRef`

### Requirement: Cwd never assigns `pluginRef` ownership

Ownership of a `pluginRef` SHALL be derived strictly from the spawn token. The cwd-FIFO correlation tier SHALL NOT assign a `pluginRef` to a registering session. The cwd tier MAY still serve its existing non-ownership classification role, but a cwd match alone SHALL NOT confer plugin ownership.

#### Scenario: Two same-cwd sessions each resolve their own ref

- **WHEN** two plugin-owned sessions are spawned into the same cwd, each with its own token and `pluginRef`
- **THEN** each session SHALL resolve its own `pluginRef` via its own token
- **AND** neither SHALL acquire the other's ref through a cwd match

#### Scenario: Tokenless register acquires no ref by cwd

- **WHEN** a session registers with no spawn token into a cwd where a `pluginRef` was filed for a different token
- **THEN** the tokenless session SHALL NOT acquire that `pluginRef`

## MODIFIED Requirements

### Requirement: Three-tier link in `headlessPidRegistry`

`headlessPidRegistry` SHALL link a registering session to its spawn entry through three tiers in priority order: (1) token match, (2) pid match, (3) cwd-FIFO fallback. Tiers 2 and 3 exist so a session that registered without a token can still be linked to its spawn entry for identity-independent bookkeeping.

Plugin-ownership resolution (`pluginRef`) SHALL use tier 1 (token) only; tiers 2 and 3 SHALL NOT assign a `pluginRef`. Automation stamp delivery SHALL ride the tier-1 token seam rather than a cwd-FIFO stamp registry, closing the tier-3 same-cwd race for automation ownership.

#### Scenario: Token match wins over pid and cwd

- **WHEN** a registering session presents a spawn token that matches an entry
- **THEN** that entry SHALL be linked by token, regardless of any pid or cwd match

#### Scenario: Pid match used when token is absent

- **WHEN** a registering session presents no token but a pid that matches an unlinked entry
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
- **THEN** linking SHALL fall through to the pid tier, then the cwd-FIFO tier
- **AND** no `pluginRef` ownership SHALL be assigned by the lower tiers

#### Scenario: Already-linked entry is skipped at every tier

- **WHEN** an entry already has a linked sessionId
- **THEN** it SHALL NOT be re-linked by any of the token, pid, or cwd tiers
