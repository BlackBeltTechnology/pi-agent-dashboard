## REMOVED Requirements

### Requirement: Session card flow launcher section

**Reason**: The session card has no flow launcher; running flows lives in the FLOWS dock chip and the flow panel header (see `flows-dock-chip`).
**Migration**: Use the dock chip's Run flow… action.

### Requirement: Flow command detection via exclusion heuristic

**Reason**: Flows are identified from the flows plugin's catalog (see `flows-catalog`), not by filtering the session's commands.
**Migration**: None for users.

### Requirement: Flow launcher section labeled

**Reason**: The session-card launcher section no longer exists.
**Migration**: None for users.
