## REMOVED Requirements

### Requirement: Content-window header surfaces attached-proposal artifact summary
**Reason**: Attach leaves the session header (see the `session-header` capability). The header no longer renders the attached-change chip, the artifact-letters pill or the task counter.
**Migration**: The attached change, its artifact letters and task progress remain on the session card and in the composer session actions. The auto-detected `session.openspecChange` field still does not trigger an attached-change summary.

### Requirement: SessionHeader accepts an artifact-reader callback
**Reason**: With the header artifact summary removed, `SessionHeader` has no artifact-letters pill to wire, so the `onReadArtifact` prop is dropped.
**Migration**: Artifact letters on the session card and in the composer session actions keep using the existing `useContentViews` artifact-reader callback.
