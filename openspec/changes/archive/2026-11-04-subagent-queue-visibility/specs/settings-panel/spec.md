# Spec Delta

## REMOVED Requirements

### Requirement: The panel SHALL disclose the heap/fan-out coupling
**Reason**: The `maxConcurrentSubagents` field is removed from Settings → Sessions along with the admission gate. The subagent concurrency limit now lives in the subagents plugin settings, and that field discloses the heap coupling (heap-limits "The ceiling and the subagent fan-out bound SHALL be presented as coupled").
**Migration**: Edit "Max parallel subagents" in the subagents plugin settings. The heap warning appears there.
