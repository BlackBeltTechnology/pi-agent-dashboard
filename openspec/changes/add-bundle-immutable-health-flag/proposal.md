# Add `bundleImmutable` flag to /api/health and migrate client gates

## Why

Two client UI gates currently use `launchSource === "electron"` as a **proxy** for "running from a read-only bundle":

| Site | Intent | Current check |
|---|---|---|
| `packages/client/src/App.tsx:1344` | Hide pi-core update badge when no writable install target | `launchSource !== "electron"` |
| `packages/client/src/components/UnifiedPackagesSection.tsx:90-91` | Hide Core sub-group from the package manager UI | `launchSource === "electron"` |

This conflates two orthogonal concerns:

1. **Who started the server** (3 starters: `Electron`, `Bridge`, `Standalone`) — owned by `dashboard-starter-identity`.
2. **Is the install root writable** — currently true iff starter is Electron, but that's an implementation accident, not a contract.

The proxy works today but leaks the model in three ways:

- **Future immutable scenarios** — if we ship a Snap, Flatpak, MSIX, or read-only container later, every gate needs to learn new starter values. The contract should already say "is the bundle immutable?" so new transports plug in without touching call sites.
- **Documentation honesty** — `docs/service-bootstrap.md#Concepts` explicitly calls out the proxy as a smell. Fixing the contract retires the caveat.
- **Conceptual asymmetry** — Bridge and Standalone are server-identical (see `docs/service-bootstrap.md#Concepts`). Branching on `launchSource` for a property that is *actually* about install topology pulls them apart for the wrong reason.

The third existing check — `packages/server/src/routes/system-routes.ts:553` gating `/api/electron/reextract` — is **not** a proxy. Its intent is "is the orchestrator Electron?" because the endpoint asks Electron specifically to restart the server. It stays on `launchSource === "electron"`. This proposal does **not** sweep all `launchSource === "electron"` references; it only migrates the two whose intent is install-root immutability.

## What Changes

- **Health endpoint** — `GET /api/health` SHALL return a new field `bundleImmutable: boolean` alongside the existing `launchSource`, `pid`, `version`, `mode` fields. For this phase, the value is derived deterministically: `bundleImmutable === (launchSource === "electron")`. The contract documented in the spec is "true iff the server's install root is read-only at runtime", and future immutable transports can extend the derivation without breaking call sites.
- **Client hook** — add `useBundleImmutable()` in `packages/client/src/hooks/` mirroring the shape of `useLaunchSource()`. Caches the value (it never changes for a connected server).
- **Client gate migration** — replace the two proxy checks:
  - `App.tsx:1344` — `{launchSource !== "electron"` becomes `{!bundleImmutable`.
  - `UnifiedPackagesSection.tsx:90-91` — `const hideCoreGroup = launchSource === "electron"` becomes `const hideCoreGroup = bundleImmutable`.
- **Server-side derivation** — pure helper `computeBundleImmutable(launchSource: LaunchSource): boolean` in `packages/shared/src/dashboard-starter.ts`. One-liner today; documented seam for future expansion.
  - **Note**: TWO `LaunchSource` types coexist. The helper uses the **flat-string** `LaunchSource` (`"electron" | "standalone" | "bridge"`) defined in `dashboard-starter.ts`, **not** the discriminated union in `packages/shared/src/launch-source-types.ts` (`{ kind: "attach" | "bundled" | "devMonorepo"; … }`). The server imports `parseLaunchSource` from `@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js`; the helper lives alongside it.
- **Documentation** — update `docs/service-bootstrap.md#Concepts` to drop the "proxy" caveat and reference `bundleImmutable` as the first-class property. Update `docs/architecture.md:884` to read `bundleImmutable` instead of `launchSource === "electron"`. The "Starter" concept is unchanged — three values, runtime identity, lifecycle ownership.
- **Tests**:
  - Pure-helper unit test for `computeBundleImmutable` covering all 3 starter values.
  - Contract test asserting `GET /api/health` returns `bundleImmutable: true` for Electron, `false` for Bridge and Standalone, in `packages/server/src/__tests__/health-route.test.ts` (extend existing file).
  - Client hook test for `useBundleImmutable` covering happy path, undefined-field fallback, and refetch idempotence.

## Capabilities

### Modified Capabilities

- `dashboard-starter-identity` — adds the `bundleImmutable` Requirement on `/api/health` and the pure-helper Requirement. Existing `starter` Requirement and lifecycle-ownership Requirement are unchanged.

## Impact

- **No behavioural change in this phase** — `bundleImmutable` is byte-equivalent to `launchSource === "electron"`. UI renders identically; only the *contract* shifts. Verifiable via the contract test.
- **Forward path opened** — adding a Snap/Flatpak/MSIX/container starter later requires updating `computeBundleImmutable` in one place; no call-site sweep. Without this change, every gate has to grow a new disjunct.
- **Documentation honesty** — `docs/service-bootstrap.md` can drop the "proxy" caveat, and the new mapping table in that doc stays accurate (the `launchSource === "electron"` column becomes `bundleImmutable === true`).
- **Code impact** — ~60 LOC across:
  - `packages/shared/src/dashboard-starter.ts` — pure helper.
  - `packages/server/src/routes/system-routes.ts` — extend `/api/health` payload.
  - `packages/client/src/hooks/useBundleImmutable.ts` — new hook.
  - `packages/client/src/App.tsx`, `UnifiedPackagesSection.tsx` — 2 line edits.
  - Tests across the three layers.
- **Backwards compatibility** — `launchSource` field stays on `/api/health` unchanged. Existing clients that read it (including older browser tabs against a newer server) continue working. The new field is purely additive.
- **Out of scope**:
  - **Not migrating `/api/electron/reextract`** — its intent is genuinely Electron-specific, not bundle-immutability. Sweep is two call sites only.
  - **Not probing the filesystem** — `computeBundleImmutable` is a pure function over starter today. A future change could probe `resourcesPath` writability for new transports; this proposal explicitly leaves that seam unfilled.
  - **Not deprecating `launchSource`** — both fields coexist. `launchSource` remains the canonical lifecycle-ownership identity; `bundleImmutable` is a derived install-topology property.
  - **Not adding a CLI flag** — there is no user-facing override. The flag is a runtime fact, not a preference.
