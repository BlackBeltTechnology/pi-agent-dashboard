## ADDED Requirements

### Requirement: Client build-time deps are runtime dependencies

The `@blackbelt-technology/pi-dashboard-web` workspace (`packages/client/package.json`) SHALL declare
every direct build-time requirement of its `prepare`/`build` scripts as a runtime `dependency`, NOT a
`devDependency`, so a production-style install (`npm install --omit=dev`) can run the Vite build. The
required set is: `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, and `tsx`.

`tsx` SHALL be declared explicitly on `packages/client` (it is imported by
`packages/client/scripts/vite-build.mjs`), not left to resolve via hoisting of another workspace's
`tsx` dependency. The root `tsx` devDependency and the `packages/server` runtime `tsx` dependency are
unaffected.

#### Scenario: Build deps are present under --omit=dev resolution

- **WHEN** `packages/client/package.json` is inspected
- **THEN** `dependencies` SHALL contain `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, and `tsx`
- **AND** `devDependencies` SHALL NOT contain any of `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`

#### Scenario: Release-deps guard asserts the build deps stay runtime

- **WHEN** `scripts/verify-release-deps.mjs` runs
- **THEN** it SHALL fail if any of `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `tsx` is absent from `packages/client/package.json` `dependencies`

### Requirement: Fresh checkout builds the client under --omit=dev

A clean checkout of the repository SHALL, after `npm install --omit=dev`, produce a built client
without any manual dev-dependency install — i.e. the `@blackbelt-technology/pi-dashboard-web`
`prepare` Vite build SHALL complete and emit `packages/client/dist/`.

#### Scenario: --omit=dev install emits the client bundle

- **GIVEN** a clean checkout with no `node_modules` and no `packages/client/dist`
- **WHEN** `npm install --omit=dev --engine-strict=false` runs at the repo root
- **THEN** the install SHALL exit `0`
- **AND** `packages/client/dist/index.html` SHALL exist
