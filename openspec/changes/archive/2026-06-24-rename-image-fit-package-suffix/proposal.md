## Why

The repo splits packages into two runtime kinds, but the npm naming only half-encodes it:

- **dashboard plugin** — declares a `pi-dashboard-plugin` manifest, loaded by the dashboard shell into React slots. Named `@blackbelt-technology/pi-dashboard-<name>-plugin`.
- **pi extension** — no manifest, loaded by the pi agent runtime (`packages[]`), registers tools/hooks. Named `@blackbelt-technology/pi-dashboard-<name>-extension` when dashboard-coupled, or `@blackbelt-technology/pi-<name>` when standalone.

Every package conforms to this except one. `@blackbelt-technology/pi-image-fit` is a standalone pi extension (peerDep `@earendil-works/pi-coding-agent`, dep `jimp` only, keyword `pi-extension`, zero dashboard coupling). Its `pi-` prefix is correct — it is dashboard-independent — but it omits the `-extension` suffix that disambiguates an extension from a plugin. Read cold, `pi-image-fit` could be either kind.

This change (a) documents the extension-vs-plugin naming convention so future packages conform, and (b) renames the one outlier to match. The package has **no in-repo importers** — it is referenced only as a string id in the recommended-extensions manifest plus tests and docs — so the rename is low-blast despite being a breaking npm republish.

## What Changes

- **NEW**: documented naming convention (spec delta `package-naming-convention`):
  - `pi-dashboard-<name>-plugin` → dashboard plugin (declares `pi-dashboard-plugin` manifest).
  - `pi-dashboard-<name>-extension` → pi extension, dashboard-coupled.
  - `pi-<name>-extension` → standalone pi extension, dashboard-independent.
- **RENAME**: `@blackbelt-technology/pi-image-fit` → `@blackbelt-technology/pi-image-fit-extension`. Package identity only:
  - `packages/image-fit-extension/package.json` `"name"`.
  - `packages/shared/src/recommended-extensions.ts` entry `id` + `source` (`npm:@blackbelt-technology/pi-image-fit-extension`); `displayName` stays `pi-image-fit` (UI brand).
  - test fixtures: `recommended-extensions.test.ts` (3 refs), `source-matching.test.ts` (1 ref).
  - `packages/image-fit-extension/README.md` title + `pi install` line.
  - docs rows: `docs/faq.md`, `docs/file-index-shared.md`, `docs/file-index-extension.md`.
- **DEPRECATE**: at release, mark the old npm name `@blackbelt-technology/pi-image-fit` deprecated with a pointer to the new name (`npm deprecate`). No `unpublish`.
- **UNCHANGED** (runtime brand, out of scope): `[pi-image-fit]` log prefix, `os.tmpdir()/pi-image-fit` cache dir, `PI_IMAGE_FIT_*` env vars, `displayName`. Renaming these is a behavior change for existing users and unrelated to the npm-name convention.
- **UNCHANGED**: all 15 cross-depended published packages keep their names; no other rename is in scope.

## Capabilities

### New Capabilities

- `package-naming-convention` — the documented rule mapping package kind to npm name shape.
