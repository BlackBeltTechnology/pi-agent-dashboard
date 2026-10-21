# local-scope-detector.ts — index

`createLocalScopeDetector({listCwds, listProjectPackageDirs?})` → `{rerun(): boolean}`: project-scope (`<cwd>/.pi/settings.json`) manifest-bearing pi packages become `source:"local-detected"` rows (`enabled/loaded:false`, error `LOCAL_SCOPE_ERROR`), or a `shadowed` entry on an existing row; never loaded; `rerun` strips + reapplies and returns whether the (id, dir) set changed. See change: decouple-plugins-from-core (5.9). Strip pass reads `store.listStored()`.
