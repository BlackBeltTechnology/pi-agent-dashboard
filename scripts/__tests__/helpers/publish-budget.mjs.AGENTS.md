# __tests__/helpers/publish-budget.mjs — index

Publish-checker runtime budget helpers: `budgetSeconds(n)=30+3*n`, `withinBudget(measured, n)`, `budgetMessage(measured, n)` (names measured time, budget and N) and `budgetedWorkspaceCount(root?)` (`listWorkspaces(root).length + (rootPackage(root) ? 1 : 0)` from `verify-published-imports.mjs`). Pure, no env gate. Imported by `dependency-declarations.test.mjs` (E26-E28, E33, E34) and `dependency-declarations.budget.test.mjs`. See change: stabilize-blocking-test-lanes.
