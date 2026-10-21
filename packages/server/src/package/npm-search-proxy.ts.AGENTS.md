# npm-search-proxy.ts — index

Cached proxy for npm registry search (`keywords:pi-package`) + README/meta fetch. Exports `searchPackages`, `fetchReadme`, `fetchPackageMeta`, `fetchGithubPackageJson`, `deriveSkillIds`, `PackageNotFoundError`, `NpmSearchResult`, `PackageMeta`, `clearCaches`. 5min TTL caches; type extraction via keyword match; GitHub fetch via `raw.githubusercontent.com/HEAD`.


## reset-override-to-npm

`fetchPackageMeta(name)` reused as the npm-name lookup for published-variant resolution (`/api/packages/installed` + `/reset-to-npm`). See change: reset-override-to-npm.

## dashboard-plugin type

`searchPackages({type:"dashboard-plugin"})` searches `keywords:pi-dashboard-plugin` (other types keep `keywords:pi-package`); `TYPE_KEYWORDS["dashboard-plugin"] = ["pi-dashboard-plugin"]`; cache key stays type+query, 5 min TTL. Client `PackageBrowser` type pill `dashboard-plugin`. See change: decouple-plugins-from-core (5.12).
