# Fix Doctor "Server launch test" on Windows (ERR_UNSUPPORTED_ESM_URL_SCHEME)

## Why

On Windows, `packages/electron/src/lib/doctor.ts:381` builds a probe command of the form:

```
"<node>" --import "<jiti-url>" -e "import <JSON.stringify(testCli)>; setTimeout(() => process.exit(0), 100)"
```

`testCli` is a raw Windows path like `C:\…\resources\server\packages\server\src\cli.ts`. `JSON.stringify` produces `"C:\\…\\cli.ts"`. The `-e` script then runs:

```js
import "C:\\…\\cli.ts"
```

Node's ESM resolver parses the import specifier as a URL. `C:` is treated as a scheme; Node rejects with `ERR_UNSUPPORTED_ESM_URL_SCHEME` (only `file:`, `data:`, and `node:` are accepted for ESM imports).

Result on every Windows install: Doctor's `Server launch test` reports **error — Server hung during launch test (15s deadline exceeded)** with a stderr tail showing the `ERR_UNSUPPORTED_ESM_URL_SCHEME` from `jiti-register.mjs`. The error is a **false positive** — the real server spawn from `main.ts` (via `launchDashboardServer` → `node-spawn.ts`) passes the entry as a **positional argv**, not as a dynamic import inside `-e`, and works correctly.

Surfaced during the spike for `fix-ci-electron-runnable-bundles` (CI run 26416255173, `electron-win32-x64-afca87a`). Spike confirmed the bundle is complete; this is a Doctor-only diagnostic bug, not a runtime regression.

## What Changes

- **One-line fix** in `packages/electron/src/lib/doctor.ts`: wrap `testCli` with `pathToFileURL(testCli).href` before `JSON.stringify`, so the `-e` script becomes `import "file:///C:/…/cli.ts"` — Node-accepted URL form.
- **No behavioural change on POSIX** — `pathToFileURL("/Users/.../cli.ts").href` returns `file:///Users/.../cli.ts`, which Node already accepts via `import "..."`. The transformation is universal.
- **Unit test** in `packages/electron/src/lib/__tests__/doctor.test.ts` (or sibling) that constructs the probe command and asserts the `-e` script contains `import "file://`, not `import "C:\\` (Windows-arm of the matrix).
- **No change** to `node-spawn.ts`, `launchDashboardServer`, or any production launch path — only the diagnostic probe.

## Capabilities

### Modified Capabilities

- `doctor-diagnostic`: adds a sub-requirement to the existing "Bounded and classified external invocations" requirement specifying that probe argv built from filesystem paths SHALL use `file://` URL form for dynamic imports.

## Impact

- **Scope**: 1 file changed (`doctor.ts`), 1 test added. ~10 LOC.
- **User-visible**: Windows Doctor reports go from 5 ok / 5 warn / **3 error** → 5 ok / 5 warn / **2 error** (or fewer, once the bundle-aware probe fix lands). The "Server hung during launch test" false alarm disappears.
- **Risk**: zero. The change is to a probe command that already only ran on Windows; the POSIX behaviour is mathematically identical. Unit test pins the contract.
- **Out of scope**: any other Doctor probe, the actual server-launch hang (a separate issue covered by `fix-doctor-bundle-aware-probes` and the wizard's `health-wait` timeout tuning).
