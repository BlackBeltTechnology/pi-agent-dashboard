## ADDED Requirements

### Requirement: Local link Node compatibility is checked before spawn

The app SHALL refuse to start a linked local checkout, before spawning it, when the Node that would run it cannot load the checkout's installed native modules, and SHALL report the reason and the command that fixes it.

#### Scenario: Native module built for another Node
- **WHEN** source is `local` AND the checkout's native modules were built for a different Node ABI than the Node that would run it
- **THEN** the app SHALL NOT spawn it
- **AND** SHALL report the mismatch and the rebuild command
