## Why

Every artifact this project ships — 31 npm packages + a 6-leg Electron installer matrix — is only ever exercised end-to-end at **release time**, against the **public npm registry**. There is no scheduled build that answers "would tonight's `develop` produce a correct release?" before a human cuts the tag. The two obvious ways to get that signal both fail:

1. **Run the real release nightly** → publishes ~365 versions/year to npmjs.com, burning the SemVer namespace and confusing every consumer. Unacceptable (the maintainer's hard requirement is **zero public npm writes**).
2. **Skip the registry (build source-only, like `ci-electron.yml`)** → lower fidelity. It verifies the *source* form builds, not that the *published* packages install and bundle correctly. The bundled server's `npm install` resolves several `@blackbelt-technology/*` sub-packages (e.g. `pi-dashboard-bus-client`, `pi-dashboard-document-converter`) **from the registry** — the exact code path that has broken releases before (ETARGET race, run #34; stale-registry taxonomy drift) is never tested source-only.

The industry answer to "full publish→install→build round-trip with zero registry pollution" is an **ephemeral private registry** (Verdaccio). TypeScript/Next.js quarantine nightlies under a `@next` dist-tag (still real npm writes); pkg.pr.new and Verdaccio write nothing public. Verdaccio is the only one that lets the Electron bundle do its **real** `npm install @blackbelt-technology/*` — against a throwaway `localhost:4873` instead of npmjs.com.

Two drift findings surfaced while scoping this and were fixed directly (outside this change's tasks); they are exactly what a nightly plugin-completeness assertion would have caught the night they happened:

- **`kb-plugin` was on disk but not in `BUNDLED_PLUGINS`** (`bundle-server.mjs`) — the Electron bundle shipped 6 of the non-fixture runtime plugins, silently omitting `kb-plugin`. **Fixed**: `kb-plugin` added to `BUNDLED_PLUGINS`.
- **Stale `honcho-plugin` build artifacts** lingered under gitignored `packages/electron/resources/server/` and `out/`, referencing a plugin no longer in `packages/`. **Fixed**: stale artifact dirs removed.

This change adds the *guard* (`assert-bundled-plugins-complete.mjs`) so this drift class fails the build in future rather than shipping silently.

## What Changes

**NEW scheduled workflow**

- **NEW** `.github/workflows/nightly.yml` — `schedule: cron '0 7 * * *'` + `workflow_dispatch`. Resolves a throwaway nightly version `<base>-nightly.<YYYYMMDD>.<sha7>`, runs a publish-validity gate, then drives the Electron matrix against a per-leg Verdaccio. **MUST NOT** `npm publish` (public), create a GitHub Release, push a tag, or commit a version bump — locked by a repo-lint contract test (mirrors the `ci-electron.yml` safety invariants).

**Verdaccio round-trip (the core)**

- **NEW** `.github/verdaccio/config.yml` — uplinks `npmjs`; `@blackbelt-technology/*` = `access/publish $all` with **no `proxy`** (local-only, so working-tree source shadows any public version and no version collision with the public `<base>` can occur); `**` = `proxy: npmjs` (third-party deps resolve + cache from public npm).
- **NEW** `scripts/nightly-verdaccio-publish.mjs` — bump → `sync-versions.js` → lockfile regen (the **real** version-coherence machinery) → publish all 31 non-private workspaces to `http://localhost:4873`. Reuses the publish-ordering invariant already enforced by `publish-allowlist-complete.test.ts`.

**Reuse `_electron-build.yml`, don't fork it**

- **MODIFY** `.github/workflows/_electron-build.yml` — add an optional `registry_url` input. When set: start the Verdaccio sidecar, publish via the script above, and export `npm_config_registry=<registry_url>` for the build. `bundle-server.mjs` spawns npm with `env: {...process.env}`, so the registry override **flows through with zero code change to `bundle-server.mjs`**. Three callers, one build definition: `publish.yml` (public npm), `ci-electron.yml` (source-only), `nightly.yml` (Verdaccio).

**Bundle-completeness assertion (catches the drift class)**

- **NEW** `packages/electron/scripts/assert-bundled-plugins-complete.mjs` — asserts `resources/plugins/` contains every non-fixture runtime plugin discoverable in `packages/*plugin*`. Wired as a per-leg gate in `_electron-build.yml`. This is the check that flags `kb-plugin`-style omissions.

**Nightly signal**

- **NEW** on-failure step opens/updates a single tracking GitHub issue (label `nightly`) with the failing leg + log link, so a red night is visible without watching Actions.

**Artifacts**

- Upload the built installers with 7-day retention (throwaway, not a Release). A human can download and smoke-run the morning's build.

## Discipline Skills

- `observability-instrumentation` — the nightly must make a red night obvious (tracking issue, single-line leg summaries in logs).
- `performance-optimization` — 6 legs × (31 local publishes + full bundle) has a CI-time budget; keep Verdaccio publishes fast and third-party deps cached via the proxy uplink.
- `security-hardening` — Verdaccio runs unauthenticated on loopback only; assert it never binds a public interface and no token reaches it.

## Out of scope (deferred)

- **The two drift findings** (`kb-plugin` not bundled, stale `honcho-plugin` artifacts) — already fixed directly (see Why); this change adds only the *assertion* that prevents recurrence.
- **Continuous per-merge preview releases** (pkg.pr.new style) — nightly `cron` only for v1.
- **Publishing a consumable `@nightly` dist-tag to public npm** — explicitly rejected; requirement is zero public writes.
- **macOS code-signing / notarization of nightly artifacts** — nightlies ship unsigned; retention-only.
