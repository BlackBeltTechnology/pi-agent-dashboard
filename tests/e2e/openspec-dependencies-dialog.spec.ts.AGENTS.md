# openspec-dependencies-dialog.spec.ts — index

F10: board → `Dependencies…` on `board-card-61` → add blocker `board-card-60` → Save writes `dependencies.yaml` (read back via `GET /api/openspec/dependencies`); after the poll the card shows `blocked by 1` and `wave 2`. Clears the declaration in `finally` (file stays with empty lists). See change: add-openspec-change-dependencies.
