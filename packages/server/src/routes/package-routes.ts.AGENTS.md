# package-routes.ts — index

Extension/package management routes. Exports `registerPackageRoutes`. Endpoints: `GET /api/packages/search`, `GET /api/packages/readme`, `GET /api/packages/installed`, `POST /api/packages/{install,remove,update,move,check-updates}`. Uses `PackageManagerWrapper`; move returns phases based on `parseSourceKind`. `POST /api/packages/reset-to-npm {source,scope,cwd?}` resolves the published variant server-side (`resolvePublishedVariant`), validates the row is installed + resolvable, then invokes `wrapper.reset()`; 202 `{resetId,publishedSource,phases}`. `GET /installed` fills `publishedVariantSource/Version` via `attachPublishedVariants`. See change: reset-override-to-npm.

## addons-hub-declutter

`GET /api/packages/installed?scope=global` reads `listManagedBridges()` + `listManagedPackageOwnership()` (never throws; warns once on reader error or when registry non-empty and nothing matches) and passes `managedPaths` to the enricher. See change: addons-hub-declutter.

`routeAdmission` dep (default fail-closed). A supplied `cwd` (`installed`, `install`, `remove`, `update`, `move` fromCwd + toCwd, `reset-to-npm`, `check-updates`) is admitted via `admitOptionalCwd`; refusal 403 `{code:"cwd_unknown", error:"cwd not allowed", reason, hint}`, undecidable 503 + `Retry-After`; no cwd keeps the wrapper fallback. `move` / `reset-to-npm` answer `400 invalid_request` for a local scope without a string cwd before admission; move refusal beats 503. See change: core-file-cwd-admission.
