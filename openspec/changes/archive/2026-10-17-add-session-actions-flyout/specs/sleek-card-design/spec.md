## REMOVED Requirements

### Requirement: Session card action row with divider
**Reason**: The desktop session card no longer has a footer action row.
- Hide/unhide was already replaced by the header Archive button (archive-sessions-lazy-load).
- Editor buttons are no longer rendered on the card.
- With this change, every remaining card action moves into the session actions menu (`session-actions-menu`).

The requirement already contradicted shipped code before this change.

**Migration**: Card actions are reached through the session actions menu's `⋯` trigger, hover strip, right-click or Shift+F10. Archive and Exit stay as header controls (`session-card-subcards` "Desktop session card keeps only state and its inline controls").

### Requirement: Source badge in action row
**Reason**: There is no action row any more. The session source is carried by the status chip in the name row (`session-card-subcards` "Status indicator is the source icon colored by status"), which is the code's behaviour today.

**Migration**: None. The source remains visible as the status chip's icon and in its `<source> — <status>` title.
