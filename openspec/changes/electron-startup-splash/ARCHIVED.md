# Archived — electron-startup-splash

**Archived**: 2026-05-04  
**Superseded by**: `simplify-electron-bootstrap-derived-state`

The setup screen / splash behavior proposed here is replaced by the Phase B wizard window repurposing in `simplify-electron-bootstrap-derived-state`. The setup screen now renders three states: idle (cached/reuse), extracting (spinner), bootstrapping (per-package progress rows from server WS).

The `decideStartupAction` function referenced in this change has been deleted as part of Phase C.
