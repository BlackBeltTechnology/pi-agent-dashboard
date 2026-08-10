# package-source-helpers.ts — index

Pure helpers classifying pi package sources + computing dedup identities. Exports `SourceKind`, `parseSourceKind`, `computeIdentity`. Rules: `npm:`→bare name, `git:`/https→url minus trailing `@ref`, abs-path→normalized, rel-path→resolve against `settingsDir`. Used by `PackageManagerWrapper.move()` for identity preflight + arm selection.
