## REMOVED Requirements

### Requirement: Folder header navigation button

**Reason**: Falsified twice over. It mandates "a Pi Resources button SHALL appear in the button row alongside [+ Session] and [+ Terminal]" — a button row that no longer exists in that form, and a control that was re-labelled "Directory Settings" by `directory-settings-page` before this change. Leaving it in place would mandate a header button that nothing renders.

**Migration**: The Pi Resources surface is reached from the folder actions menu's existing `DIRECTORY`-group "Directory Settings" item, which already routes to it — see `folder-actions-menu` → "The Pi Resources surface keeps exactly one menu home". Navigation destination and behaviour are unchanged; no new entry point is created.

### Requirement: Pi Resources button icon

**Reason**: Describes the glyph and the "right-aligned position in the action bar" of the same superseded control. The action bar is deleted; there is no position to retain.

**Migration**: The menu item carries the icon; placement is governed by the menu's fixed group taxonomy rather than by row alignment.
