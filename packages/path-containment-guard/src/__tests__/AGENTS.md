# DOX — packages/path-containment-guard/src/__tests__

L1 vitest suites (real temp trees; fake POSIX env for pure cases). See change: add-path-containment-guard-extension.

| File | Purpose |
|------|---------|
| `config.test.ts` | #E1–#E5 root/denied parsing + fail-closed table; denied tools survive unusable roots. |
| `decide.test.ts` | #E6–#E18 denied tools, containment, `~`/`@`/`file://`, dangling links, grep/find/ls cwd default, case fold, arg validation; EACCES fault; #P1 p95 < 1 ms. |
| `extension.test.ts` | #X1–#X6 handler: fault → `error`, loop, total factory, no UI, log-forging escape, reason codes. |
| `helpers.ts` | Test helpers: env var names, fake POSIX `ResolveEnv`, `envOf`, `tmpTree` (realpath'd temp dir). |
| `jiti-safe.test.ts` | #X9b: jiti CJS transform of every guard source has no code-position `import.meta` (the repo gate does not seed `-e`-only entries). |
| `package-shape.test.ts` | #E20: no `pi.extensions`, no root index, `exports` map, `scope.ts` import graph never reaches pi/server/runtime. |
| `runner.test.ts` | #X7 #X8 #X9a: guard loaded through pi's real `discoverAndLoadExtensions` + `ExtensionRunner`; nested `parentToolCallId`; both handler orders. |
| `scope.test.ts` | #E19 `withPathContainmentGuard`: fragment, merge without mutation, throws. |
