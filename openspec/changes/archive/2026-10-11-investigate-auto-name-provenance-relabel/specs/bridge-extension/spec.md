## MODIFIED Requirements

### Requirement: Bridge pushes external renames from session_info_changed via the auto-namer's self-filter

The bridge SHALL register `pi.on("session_info_changed", ...)` (pi 0.80.3+, try/catch) and SHALL route the new name through the existing `autoNamer.onObservedName(name)`, which classifies self-applied, system-applied, or external via `classifyNameChange` and reports (locking out auto-naming) ONLY when external. The bridge's own `pi.setSessionName(...)` auto-name echoing back through the event SHALL be classified self, and a dashboard `system`-origin rename echoing back SHALL be classified system; neither SHALL push or lock out. The recorded self-applied and system-applied names SHALL be normalized with pi's own name sanitization (`replace(/[\r\n]+/g, " ").trim()`) so a name containing internal newlines still matches the sanitized name pi carries in the event. The turn-end name poll SHALL remain as a fallback.

#### Scenario: External rename pushes and locks out
- **WHEN** `session_info_changed` fires with a name the auto-namer classifies external
- **THEN** the bridge SHALL push exactly one `session_name_update{nameSource:"user"}` and lock out auto-naming

#### Scenario: Bridge's own auto-name echo is ignored, including a newline-bearing title
- **WHEN** the bridge auto-applies a multi-word title containing a newline and pi emits `session_info_changed` with the sanitized (newline-collapsed) form
- **THEN** the normalized self-applied comparison SHALL classify it self
- **AND** the bridge SHALL NOT push a `session_name_update` and SHALL NOT lock out auto-naming

#### Scenario: Dashboard system rename echo is ignored
- **WHEN** the server sends a `system`-origin rename and pi emits `session_info_changed` with that name
- **THEN** the auto-namer SHALL classify it system
- **AND** the bridge SHALL NOT push `session_name_update{nameSource:"user"}` and SHALL NOT lock out auto-naming

#### Scenario: Absent event falls back to poll
- **WHEN** pi does not emit `session_info_changed`
- **THEN** the existing turn-end name poll SHALL still detect an external rename (today's behavior)
