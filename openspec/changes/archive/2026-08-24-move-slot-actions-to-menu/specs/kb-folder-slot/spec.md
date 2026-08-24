## MODIFIED Requirements

### Requirement: KB folder nav slot

The folder group SHALL render a `KB` row via a `sidebar-folder-section` claim, as a sibling of the `Goals` and `Automations` folder sections, showing the entry count and its index state. The row SHALL render **no** reindex affordance of its own: reindexing is a single item in the folder actions menu's `MAINTENANCE` group.

#### Scenario: Populated folder shows chunk count
- **WHEN** folder `C` has `N` chunks indexed
- **THEN** the row shows `KB · N chunks`
- **AND** no reindex control is present in the row

#### Scenario: Count tooltip includes files
- **WHEN** the user hovers the KB count for folder `C` with `F` files and `N` chunks
- **THEN** the tooltip shows `F files · N chunks`

#### Scenario: Reindex is triggered from the menu
- **WHEN** the user activates the KB reindex item in the folder actions menu for folder `C`
- **THEN** the client calls `POST /api/kb/reindex?cwd=C`
- **AND** the row reflects the updated count when the job completes
