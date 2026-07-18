# pi-core-checker.ts — index

Discovers installed pi-ecosystem CORE packages (global `npm list -g` + `~/.pi-dashboard/node_modules` managed) and compares versions against npm registry / pi.dev. Exports `PiCoreChecker` class (`getStatus`), `PiCorePackage`, `PiCoreStatus`, `CORE_PACKAGE_NAMES`, `_resetDynamicPiAliases`. Strict whitelist: `CORE_PACKAGE_NAMES` + pi.dev aliases (no `pi-*` prefix heuristic). Caches 5 min. See change: consolidate-packages-settings-ui.
