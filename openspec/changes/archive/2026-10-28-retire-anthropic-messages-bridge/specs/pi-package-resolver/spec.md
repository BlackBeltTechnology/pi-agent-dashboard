# Spec Delta

## REMOVED Requirements

### Requirement: Tier-2 fallback in plugin peer probes uses the shared resolver
**Reason**: Its only consumer, `flows-anthropic-bridge-plugin/src/peer-probe.ts`, is deleted.
**Migration**: None. The shared resolver itself is unchanged.
