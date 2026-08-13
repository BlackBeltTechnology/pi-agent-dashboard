# __tests__/ship-it-no-weakening.test.mjs — index

Vitest unit tests for ship-it `no-weakening.ts` assertNoWeakening. Rejects added `.only`/`.skip`/`xit`/`xdescribe`, net assertion deletion (expect() removed>added), strong→permissive matcher swap (toEqual→toBeDefined, toThrow→not.toThrow); accepts value-change fix, added assertion, non-assertion edit, empty diff. See change: add-openspec-pipeline-orchestrators.
