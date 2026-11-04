# __tests__/codeql-anchor-contract.test.ts — index

Static contract on `scripts/codeql-anchor/plugin-routes.mjs` source (never imported): local `checkAnchor` — import set == 5-registrar allowlist, each module exports its registrar, no `listen(`, no top-level code outside an exported fn; `paths-ignore` keeps test globs, never ignores the anchor; anchor absent from root `package.json` `files` (#E19–#E25). See change: fix-codeql-baseline-coverage.
