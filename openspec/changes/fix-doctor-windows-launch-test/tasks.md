# Tasks

## 1. Fix

- [ ] 1.1 In `packages/electron/src/lib/doctor.ts`, import `pathToFileURL` from `node:url` (if not already imported).
- [ ] 1.2 At the line that constructs `importSpec` (currently `const importSpec = JSON.stringify(testCli);`), replace with:
  ```ts
  const importSpec = JSON.stringify(pathToFileURL(testCli).href);
  ```
- [ ] 1.3 No other changes in `doctor.ts`. The `cmd` template stays the same.

## 2. Test

- [ ] 2.1 Add a unit test in `packages/electron/src/lib/__tests__/doctor-launch-test.test.ts` (new file). Test exports the relevant cmd-builder helper (refactor only if needed; otherwise test the public `runDoctor` with a stubbed `testCli`). Assertions:
  - Given `testCli = "C:\\Users\\test\\cli.ts"`, the produced cmd's `-e` script contains the substring `import "file:///C:/Users/test/cli.ts"`.
  - Given `testCli = "/Users/test/cli.ts"`, the produced cmd's `-e` script contains the substring `import "file:///Users/test/cli.ts"`.
  - Negative assertion: the cmd does NOT contain `import "C:\\` or `import "/Users/test` (raw path).
- [ ] 2.2 If `doctor.ts` doesn't expose a testable cmd-builder, refactor minimally — extract a pure helper `buildServerLaunchTestCmd({ nodeBin, jitiUrl, testCli })` that returns the cmd string. Keep the call site identical.

## 3. Validate

- [ ] 3.1 Run `npm test`, all green.
- [ ] 3.2 Manual smoke on Windows VM: open Doctor (Help → Doctor), confirm `Server launch test` row turns ✅ (or shows a different real error, no longer `ERR_UNSUPPORTED_ESM_URL_SCHEME`).
- [ ] 3.3 Manual smoke on macOS or Linux: open Doctor, confirm no regression — same ✅ as before.
