# add-folder-file-manager.spec.ts — index

L3 Add Folders file-manager picker: #F4 desktop click selects / dblclick opens; touch context (`hasTouch`,`isMobile`, 390×844) #F17 rows ≥44 px, #F18 tap opens + long-press selects + `Add 2 folders`, #E16 `pinDirectory` pins exact path. Fixture dirs via `POST /api/browse/mkdir` under the server browse root (`GET /api/browse` `current`, i.e. $HOME) at `afm-file-manager-fixture/{leaf-a,leaf-b}`; `/tmp` is outside the allowed browse roots; unpin over bus in `afterAll`. See change: simplify-add-folder-picker.
