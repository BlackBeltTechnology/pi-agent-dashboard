# ui-terminology Specification

## Purpose
TBD - created by archiving change align-ui-with-theme-tokens. Update Purpose after archive.

## Requirements

### Requirement: User-facing copy says "new session", not "spawn"
English text shown to users in the dashboard — button labels, titles, tooltips, `aria-label`s, settings labels and hints, empty states, help text, plugin setting schemas, diagnostics labels and error messages surfaced to the UI — SHALL NOT contain the words "spawn", "spawns", "spawned", "spawning", "respawn" or "respawns". Creating a session SHALL be described as "new session" (noun) or "start" (verb), and automatic re-creation as "restart". Internal identifiers SHALL keep their names: protocol message types, function and variable names, config keys, `data-testid` values, file names and i18n keys.

#### Scenario: Worktree collision action
- **WHEN** the worktree dialog offers to use the worktree that already holds the branch
- **THEN** the button SHALL read "New session in that worktree →"

#### Scenario: Goal restart setting
- **WHEN** the goal settings show the automatic driver re-creation option
- **THEN** the label SHALL read "Auto-restart on driver death (bounded by budget + crash-loop breaker)"

#### Scenario: No spawn wording in English strings
- **WHEN** every English value in `i18n-en-source.json` and plugin `src/i18n.ts` catalogs, every English fallback passed to `i18nT`/`t`, every `configSchema.json` `title`/`description`, and the doctor and session error strings listed in design D9 are scanned
- **THEN** none SHALL match `\b(re)?spawn(s|ed|ing)?\b` (case-insensitive)

#### Scenario: Translation keys unchanged
- **WHEN** the copy change lands
- **THEN** every i18n key that existed before SHALL still exist, the Hungarian values SHALL be unchanged, and Chinese values SHALL be unchanged except goal-plugin strings that said 重生 (respawn), which SHALL say 重启 (restart)
