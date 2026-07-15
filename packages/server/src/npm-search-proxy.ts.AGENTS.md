# npm-search-proxy.ts — index

Cached proxy for npm registry search (`keywords:pi-package`) + README/meta fetch. Exports `searchPackages`, `fetchReadme`, `fetchPackageMeta`, `fetchGithubPackageJson`, `deriveSkillIds`, `PackageNotFoundError`, `NpmSearchResult`, `PackageMeta`, `clearCaches`. 5min TTL caches; type extraction via keyword match; GitHub fetch via `raw.githubusercontent.com/HEAD`.


## reset-override-to-npm

`fetchPackageMeta(name)` reused as the npm-name lookup for published-variant resolution (`/api/packages/installed` + `/reset-to-npm`). See change: reset-override-to-npm.
