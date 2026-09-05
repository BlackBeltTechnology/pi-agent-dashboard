# useInstalledPackages.ts — index

Fetches `GET /api/packages/installed?scope=&cwd=` into `packages: InstalledPackage[]` with `isLoading`/`error`/`refresh`. Auto-refreshes on `pi-package-event` `package_operation_complete` success. Cancels stale fetches via mounted ref.
