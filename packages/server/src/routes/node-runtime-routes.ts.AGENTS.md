# node-runtime-routes.ts — index

Node family discovery + selection. `GET /api/node/installs` (enumerateNodeCandidates with live env + assessFamilyCoherence), `POST /api/node/installs/select` (candidate by root; applySelection = ONE atomic setOverrides; 404 unknown root, 400 entry-validation failure). networkGuard. See change: add-node-runtime-family-selection.
