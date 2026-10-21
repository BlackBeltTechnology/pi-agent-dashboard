# __tests__/codeql-local-real.test.mjs — index

`codeql-local.mjs` against the REAL CodeQL CLI on tiny repos (#E4, #E18, #X6; #E12 spike glob root-only; #E4/#E5 quoted model on a mini monorepo — opaque guard bodies, since `known().includes(cwd)` is itself a CodeQL guard). `describe.skipIf` no `codeql` / uncached packs; uses the real HOME for the pack cache. See change: add-local-codeql-ratchet.
