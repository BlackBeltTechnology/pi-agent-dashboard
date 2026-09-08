## 1. Regression and implementation

- [x] 1.1 Add independent argv, child-marker, and non-default SDK regression cases, plain startup, resume/fork/reload, deferred-provider and accepted-limit cases; record the focused red test run.
- [x] 1.2 Implement the shared startup-choice helper and early startup snapshot; verify focused bridge-default-model tests pass, including settings-error cases and production wiring.

## 2. Validation and documentation

- [x] 2.1 Run the extension suite and TypeScript checks; review task-owned code with code-simplifier against passing focused tests and repeat validation after any edits.
- [x] 2.2 Sync current specs, architecture documentation, and source documentation rows, including the exact same-default limitation; validate OpenSpec and inspect the scoped documentation diff.
- [x] 2.3 Obtain fresh independent correctness and maintainability review of the current diff; resolve confirmed findings and repeat affected tests.

## 3. Delivery

- [ ] 3.1 Commit and push only the task branch, open a direct PR against the repository default branch, include validation evidence and explicit no-global-mutation startup-gate exclusion, and report the full PR URL. Do not merge or run shared lifecycle commands.
