# selectedSessionId.ts — index

Pure derivation of selected session id from wouter route matches. Exports `deriveSelectedSessionId(match, params, diffMatch, diffParams)`. Includes `/session/:id/diff` sub-route so `sessionDetail` + in-tree `<FileDiffView>` branch don't collapse to null on desktop. See change: fix-changed-files-desktop-route.
