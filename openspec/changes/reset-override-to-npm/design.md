## Context

`flag-package-source-overrides` added detection (`isSourceOverride`) and a
neutral `override` pill. This change adds the action that resets an override
back to its published npm version. Two decisions were made in explore mode with
the requester.

## Decision 1 — Atomic, install-first ordering

**Chosen:** a single atomic backend endpoint that installs `npm:<name>` FIRST,
and only on success removes the local/git `settings.json#packages[]` entry.

**Rejected:** naive two-queued-ops (remove then install). If the npm install
failed after the remove, the user would be left with *neither* source — losing
their working local checkout registration for no gain.

```
   POST /api/packages/reset-to-npm { source: <local|git>, scope }
        │
        ▼
   1. install  npm:<name>        ──fail──▶  abort, local entry untouched ✅
        │ ok
        ▼
   2. remove   <local|git> entry ──fail──▶  PartialSuccess: npm installed,
        │ ok                                 local entry still present;
        ▼                                    surface cleanup banner
   done: only npm:<name> registered
```

The existing `/api/packages/move` route is the template — it already performs
an atomic install-into-new-scope + remove-old, and its `move` op emits a
`package_operation_complete`. Reuse that machinery; the difference is the new
spec swaps the *source kind* (local/git → npm) rather than the *scope*.

Partial-failure (install ok, remove fails) reuses `PartialSuccessBanner`.

## Decision 2 — Confirm-gated, low-pressure framing

**Chosen:** the reset control opens a confirm dialog before acting:
"This discards your local checkout link and installs the published npm version."

**Rationale:** a source override is frequently *intentional* — a developer
iterating on a live local checkout. The `override` pill is deliberately
neutral. An always-on, one-click reset would imply the override is a defect and
risk a dev nuking their own working tree link. Confirm makes it a deliberate
opt-out.

Note: removing the settings entry only drops the `packages[]` *registration* —
it does not delete the developer's working tree on disk. The confirm copy
should say "link", not "files".

## Decision 3 — Extended scope + dual source-line display

**Chosen:** the second source line + reset action apply to ANY local/git
install whose package name resolves to a published variant — not only
`RECOMMENDED_EXTENSIONS` overrides. A qualifying row renders two source lines
(installed `local`/`git` path + published `npm`/`git` link with available
version) and both an inline **↺ Reset to npm** and the `⋮`-menu item.

Two resolution paths for the published variant:

```
  local/git row
      │
      ├─ isRecommended ? ──yes─▶ matchRecommendedEntry() → npm:<name>   (cheap, offline)
      │
      └─ else ──▶ npm-registry lookup by package.json `name`
                     │
                     ├─ found  → npm:<name> + latest version  (surface line)
                     └─ none   → no second line, no reset action
```

Exposed on the wire as `InstalledPackage.publishedVariantSource` (+
`publishedVariantVersion`). Un-enriched rows (field absent) render exactly as
today — single source line, no reset.

### Non-recommended resolution risks (npm-name lookup)

- **Network + latency.** The registry probe runs server-side during list
  enrichment; cache per (name→result) with a TTL so the packages list stays
  fast and works offline (cache miss → omit the line, never block).
- **Name collision / false match.** A local `package.json name` may collide
  with an unrelated published package. Confirm dialog copy must show the exact
  npm target so the user verifies before resetting. Consider requiring a
  stronger signal than name alone (e.g. repository URL match) before offering
  reset on non-recommended rows — open question.
- **No published variant.** The common case for a purely-local package; simply
  omit the second line and the reset action.

## Canonical spec resolution (recommended path)

For recommended rows, `matchRecommendedEntry()` already resolves the linkage
offline — use its entry `source`. This is the cheap, always-available path; the
npm-registry lookup above only runs for non-recommended local rows.

## Scope handling

The override entry may live in local or global `settings.json`. The reset must
target the row's own scope (already tracked as `scope` on the list). Both the
install and the remove happen in that same scope.

## Open questions

- Endpoint shape: dedicated `POST /api/packages/reset-to-npm` vs. extending the
  `move` handler with a `mode: "reset"`. Dedicated route is clearer; move-reuse
  is less code. Lean dedicated.
- Does `PackageAction = "reset"` need distinct WS-consumer handling, or can it
  reuse the `move` completion path? Prefer reuse.
