# check-loader-neutral-source.mjs

Loader-neutral source gate (native-ts-loader capability).
AST-level: strip types (`module.stripTypeScriptTypes`) → `acorn`.
Flags unbound `require` / `__dirname` / `__filename` / `exports`, `module.<x>`, value-imported `.tsx`.
Passes: `createRequire` bindings, file-declared names, string/template text, `import type`.
Skips `.cts` (CommonJS by design) and data files (`.json`).
Scope: `serverMain` (whole `src/**`) + `pluginServer` seeds from `lib-jiti-scope.mjs`, value-import walk.
Excludes `piExtension` / `pluginBridge` seeds (pi's jiti).
Empty file set → failure. Unreadable discovered file → `unreadable` violation (fail closed).
Relative import → exact on-disk target first (`./helper.js` scanned), then TS remap via `resolveFirstParty`.
Binding check is file-level by design (D5): a name declared anywhere in the file counts as bound.
Exports `runLoaderNeutralGate({ root, discoverSeeds })`, `scanSource(source, file)`.
CLI: `node scripts/check-loader-neutral-source.mjs [--root <dir>]`, exit 1 on violation.
Wired into `npm test` via `__tests__/loader-neutral-source.test.mjs` (E23–E28).
See change: fix-appimage-cold-boot-latency.
