## Context

`GET /api/packages/recommended` (`recommended-routes.ts` → `enrichEntry`) decides each recommended entry's `installed.scope` / `activeInPi` with the pure `sourcesMatch(a, b)` string predicate. For local monorepo installs the settings source is a filesystem path whose basename is decorated differently from the published npm name (`image-fit-extension` vs `pi-image-fit-extension`), so `sourcesMatch`'s npm↔raw basename rule fails on 7/7 local recommended packages.

Traced facts:
- `listConfiguredPackages()` returns `installedPath` populated for local installs (= the checkout dir).
- Each local checkout's `package.json` `name` equals the manifest npm source exactly (7/7).
- `enrichEntry` already opens `<installedPath>/package.json` for `version` + `pi.skills`.

## Goals / Non-Goals

**Goals**
- Correct display/state for locally-installed recommended packages.
- Zero extra file IO (reuse the existing `package.json` parse).
- Keep `sourcesMatch` pure (no fs) so the Electron wizard enricher and plugin loader are unaffected.

**Non-Goals**
- Renaming monorepo directories to match npm names.
- Changing `package-source-matching` behavior or the `/api/packages/recommended` response shape.
- Fuzzy/substring name matching.

## Decisions

### D1 — fs-aware match lives in the server enrichment layer, not in `sourcesMatch`

`sourcesMatch` is imported by the shared package (wizard bootstrap, plugin loader) and is contractually pure string logic. The `installedPath` is only known at the enrichment layer. So the name resolution is added inside `enrichEntry`'s `inGlobal`/`inLocal` computation as an **either-match**: `sourcesMatch(row.source, entry.source) || localNameMatches(row, entry)`.

`localNameMatches` parses the entry source via the existing `parseSourceKey` (npm kind → `name`), reads `<row.installedPath>/package.json` `name`, and compares exactly. It fails closed (returns false) on any missing path / read / parse / non-string error, so behavior degrades to today's string match.

### D2 — read the name in the SAME parse already performed

`enrichEntry` currently parses the matched row's `package.json` only after `installedScope` is decided (for `version`/`skills`). To use the name for the match decision, the parse must move to (or be shared with) the match step. Chosen approach: a small helper that reads+caches the parsed `package.json` per `installedPath` within the entry's evaluation, so both the match and the version/skills reads use one parse. Net IO unchanged.

### D3 — wizard bootstrap enricher parity: DEFER, documented

The Electron first-launch wizard has its own bootstrap enricher that also uses `sourcesMatch`. It runs pre-install (nothing installed locally yet), so the local-name gap is not observable there in the common path. This change scopes the fix to the server route. If wizard parity is later required, extract `localNameMatches` into a shared fs-aware helper callable with an explicit path. Recorded as an open follow-up, not implemented here.

## Risks / Trade-offs

- **False positive**: two unrelated local packages with the same `package.json` name — impossible within one settings scope (npm names are unique) and no worse than today.
- **Cache**: results cached 60s, busted on install/remove — a fresh local install shows correctly after the next cache miss, identical to current freshness.

## Migration / Rollback

Pure read-path change. No persisted state, no settings migration. Rollback = revert the `enrichEntry` diff; string matching resumes.
