# packages-api.ts — index

Fetch helpers for package endpoints not owned by `package-queue`. Exports `PackageScope`, `PackageEntry`, `MoveArgs`, `MoveSuccessResponse`, `MoveErrorResponse`, `MoveResponse` (discriminated union), `movePackage(args)` — POST `/api/packages/move`, never throws on HTTP-error (network errors still throw); partial-success delivered later via WS `partialSuccess` field. See change: unify-package-management-ui.


## reset-override-to-npm

Adds `ResetToNpmArgs`, `ResetSuccessResponse`, `ResetErrorResponse`, `ResetResponse`, `resetToNpm(args)` \u2014 POST `/api/packages/reset-to-npm` (server resolves published target authoritatively); same never-throw-on-HTTP contract as `movePackage`. See change: reset-override-to-npm.
