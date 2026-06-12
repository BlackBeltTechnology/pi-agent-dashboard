## Context

`@blackbelt-technology/pi-image-fit` ships from `packages/image-fit-extension/` and is published to npm via the existing workspace release loop. It transparently downsizes oversize images on the `Read` tool (defaults: 1568 px long edge / 4 MiB / quality 85) and registers **no tools** — its only effect is mutating `event.input.path` to a cached, resized copy.

The dashboard's curated manifest `RECOMMENDED_EXTENSIONS` lives in `packages/shared/src/recommended-extensions.ts` (single source of truth; there is **no** duplicate under `src/shared/`). It currently holds six entries. The server enriches each entry via `/api/packages/recommended` (live version/description + installed/active cross-reference) and `RecommendedExtensions.tsx` renders one card per entry. `pi-image-fit` is absent, so it is undiscoverable in-dashboard.

Constraints:
- `packages/shared/src/__tests__/recommended-extensions.test.ts` asserts an **exact** set of ids (`"contains exactly the six expected entries"`) and per-source-scheme invariants (npm entries use `npm:` prefix). Adding an entry **breaks** that test until updated.
- `BUNDLED_EXTENSION_IDS` (Electron offline bundle) must remain a strict subset of `RECOMMENDED_EXTENSIONS`; the SPDX allowlist + 15 MB budget gate that set at build time.

## Goals / Non-Goals

**Goals:**
- Surface `pi-image-fit` in the Recommended Extensions card with a one-click install path.
- Keep the change data-only: one manifest entry + the manifest test update.

**Non-Goals:**
- No change to the extension package itself, install plumbing, server routes, or `RecommendedExtensions.tsx`.
- **Not** adding it to `BUNDLED_EXTENSION_IDS` (no Electron offline bundling this change).
- No companion dashboard plugin.

## Decisions

**1. `status: "optional"`** (over `strongly-suggested`/`required`).
The extension registers no tools and silently alters image reads; it is a convenience/cost optimization, not a correctness prerequisite. `required`/`strongly-suggested` are reserved for entries that unblock provider tool-calling (`pi-anthropic-messages`) or core dashboard features (`pi-flows`). Alternative `strongly-suggested` rejected: would surface a "missing required" nudge for a purely optional token-saver.

**2. `source: "npm:@blackbelt-technology/pi-image-fit"`** (over git HTTPS URL).
The package is published to npm. The manifest test enforces npm-sourced entries use the `npm:` prefix; git-sourced entries use the `https://github.com/….git` form. npm install is the lighter, version-pinnable path. Matches `pi-web-access`, `pi-agent-browser`, `pi-dashboard-subagents`.

**3. No `dashboardPlugin`, no `toolsRegistered`, no `autowired`.**
The extension exposes no tools and has no companion plugin, so these optional fields are omitted. `unlocks` carries a single human-readable string describing the auto-downscale behavior (manifest test requires `unlocks.length > 0`).

**4. Update the exact-set assertion to expect seven ids.**
The `"contains exactly the six expected entries"` test is renamed/retargeted to seven and the new id added to the expected array. This is the only test that must change; per-shape and per-scheme assertions already cover the new entry generically.

## Risks / Trade-offs

- **[Manifest test fails on add]** → Update `recommended-extensions.test.ts` in the same change (covered in tasks); CI catches any miss.
- **[User confusion: extension silently changes image bytes]** → Mitigated by a clear `fallbackDescription` naming the resize thresholds and the silent-quality-loss caveat (mirrors the package README). No new mechanism.
- **[Scope creep into Electron bundling]** → Explicitly excluded; `BUNDLED_EXTENSION_IDS` untouched, subset invariant still holds.

## Migration Plan

Pure additive data change. Deploy = ship updated `packages/shared`. Rollback = revert the single manifest entry + test edit. No persistence, API, or schema migration.

## Open Questions

- Final `status` level — `optional` proposed; confirm vs `strongly-suggested` if token-savings should be promoted more visibly. (Flagged to user; default `optional`.)
