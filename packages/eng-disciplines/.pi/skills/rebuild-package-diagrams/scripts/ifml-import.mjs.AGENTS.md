# .pi/skills/rebuild-package-diagrams/scripts/ifml-import.mjs — index

Reverse: `graphToUi` (windows→screens, childless AE-reached windows→dialogs, forms/fields, events→actions, guards, navigation, `ifmlIds`), `diffGraphs` (type/name/owner/body/isModal/isLandmark + flows by endpoints), `applyUi` (merge additions/renames/guards/validations, never delete, stand-alone window = existing dialog), `writeUi`, `readScreenFiles`. See change: add-ifml-render-roundtrip. `mergeFields` shared by screen template fields + forms (validation conditions updated, not only new keys) — PR #817 review.
