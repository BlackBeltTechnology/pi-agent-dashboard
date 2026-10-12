## REMOVED Requirements

### Requirement: Resolve jiti register path from any installed source
**Reason**: The dashboard server no longer runs under jiti and no launch path resolves a jiti register hook. (`jiti` may remain a transitional dependency of the server package, per `packaging`, but nothing resolves it.) pi resolves its own jiti for extensions without dashboard help.
**Migration**: None for users. Delete the now-empty `openspec/specs/jiti-loader/` capability at archive.
