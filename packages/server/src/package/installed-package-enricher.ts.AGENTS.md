# installed-package-enricher.ts — index

Enriches raw `packageManagerWrapper.listInstalled()` rows with version, description, displayName, isRecommended, isBundled. Exports `RawInstalledRow`, `readPackageJsonMeta`, `extractBasenameFromSource`, `matchRecommendedEntry`, `computeIsBundled`, `enrichInstalledRow`, `enrichInstalledRows`. Reads on-disk `package.json`, matches `RECOMMENDED_EXTENSIONS`, checks bundled dir under Electron `resourcesPath`.


## reset-override-to-npm

Adds `readPackageJsonName`, `PublishedVariant`, `resolvePublishedVariant(row, {manifest, readName, lookupNpm})` (recommended \u2192 manifest source offline; non-recommended local \u2192 npm-name lookup, NAME-ONLY gate; plain-npm/identity-equal \u2192 undefined), and `attachPublishedVariants(rows, {lookupNpm})` (fills `publishedVariantSource/Version`, never blocks). See change: reset-override-to-npm.
