## REMOVED Requirements

### Requirement: Resolver supports upstream jiti package name
**Reason**: It mandates a fork-first jiti order and a loader error that names `@mariozechner/pi-coding-agent`. It also describes `resolveJitiImport` / `resolveJitiFromAnchor`, which `server-launch` "Removed predecessors" already deleted. Both contradict this change's earendil-only `JitiNotFoundError` and the upstream-first `JITI_PACKAGES` order.
**Migration**: Covered by `server-launch` "Unified jiti resolution via `ToolResolver` anchored at earendil pi" (upstream `jiti` first, `@mariozechner/jiti` fallback) and `jiti-loader` "Resolve jiti register path from any installed source". The loader error names only `@earendil-works/pi-coding-agent` (see `bridge-extension`).
