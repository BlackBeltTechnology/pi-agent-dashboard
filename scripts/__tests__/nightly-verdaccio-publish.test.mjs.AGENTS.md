# __tests__/nightly-verdaccio-publish.test.mjs — index

Vitest unit tests for scripts/nightly-verdaccio-publish.mjs pure helpers: nextPatch (0.6.1→0.6.2, ignores prerelease), computeNightlyVersion slug shape `X.Y.Z-nightly.<8digits>.<7hex>`, publish set == filesystem non-private workspace set, topo ordering (deps-before-dependents, root last), synthetic new-workspace inclusion (scenario 7.1). See change: add-nightly-verdaccio-build.
