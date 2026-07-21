## Context

`kb dox lint` `over-threshold` currently fires on `rows > ROW_CAP (40)` OR `bytes > AGENTS_BYTE_CAP (30000)` and emits one `kind: "over-threshold"` issue for both. The byte arm is the only one that costs per-turn context (pi injects the nearest ancestor `AGENTS.md` every turn); the sidecar split (`scripts/split-large-agents.mjs`) already addresses it. The row arm is a cohesion proxy with no injection cost once bytes are bounded. This change separates the two and then removes the *legitimate* row-count debt (rollup dirs + oversized root-level source dirs) while formally accepting the marginal residue.

## Goals / Non-Goals

- **Goal:** `kb dox lint` output distinguishes byte-over (act) from row-over (inform).
- **Goal:** no directory `AGENTS.md` documents files from a subdirectory that lacks its own `AGENTS.md` (kills rollup over-counts at the source).
- **Goal:** `components/`, `server/src/`, `lib/` foldered into cohesive per-domain subfolders, behavior-preserving.
- **Goal:** `ROW_CAP` counts inline detail rows only; promoted sidecar-pointer rows are excluded (splitting a file to its sidecar reduces the counted total).
- **Non-Goal:** raising the numeric `ROW_CAP`. 40 stays; only *what is counted* and severity classification change.
- **Non-Goal:** foldering the marginal dirs (`hooks/`, `extension/src/`, `shared/src/` at 44–47; `tests/e2e/` at 62). Accepted as informational.
- **Non-Goal:** any change to runtime behavior of the dashboard.

## Decisions

### D1 — Severity split, not threshold bump
`doxLint` emits two detail shapes (or a `severity`/`arm` discriminator) so a consumer can tell byte-over from row-over. Keeping `ROW_CAP = 40` preserves the foldering trigger; bumping it would just hide the cohesion signal. Row-over becomes advisory-informational; byte-over stays actionable.

### D6 — ROW_CAP counts inline rows via a dedicated counter (parseRowPaths signature untouched)
The over-threshold row check (`packages/kb/src/dox.ts`, currently `parseRowPaths(af).length > ROW_CAP`) SHALL count only **inline** rows. A **sidecar-pointer** row — one whose purpose carries the `→ see `<File>.AGENTS.md`` marker written by `scripts/split-large-agents.mjs` when it promotes a >`INLINE_CAP` (200-char) row — is pull-only and cheap and SHALL be excluded from the count. Detection: match the row purpose against `/→ see `[^`]+\.AGENTS\.md`/`.

**Implementation constraint (load-bearing):** `parseRowPaths` is a **public export** (`packages/kb/src/index.ts`) consumed by `packages/kb-extension/src/reindex.ts` (`acknowledgeRows`, `decideNudge`) as a plain `string[]` of paths. The fix MUST NOT change its signature or drop any path from it — the `missing`/`orphan`/staleness checks and kb-extension all depend on the complete path list. Add a **sibling** `countInlineRows(af): number` (or a classifier returning `{ path, inline }[]`) used ONLY by the over-threshold comparison. The exclusion applies to the **count**, never to path collection.

Consequence: the split script now reduces *both* the byte total and the counted-row total, so a directory of mostly long rows can drop under `ROW_CAP` by splitting alone, while a directory of many *short* (already-inline) rows (e.g. `components/`, `lib/`) still trips it and needs foldering. This keeps the row metric honest: it measures inline-detail volume, not file count.

### D2 — Rollup dirs fixed by scaffolding, not by moving source
`qa/` and `docker/` over-count purely because subdir files roll up into the parent `AGENTS.md`. `kb dox init` already scaffolds a per-directory tree; run it (or hand-create) so `qa/packer/AGENTS.md`, `qa/tests/AGENTS.md`, `qa/fixtures/AGENTS.md`, `qa/scripts/AGENTS.md`, `docker/fixtures/AGENTS.md`, `docker/scripts/AGENTS.md` exist, then move each row from the parent into the owning subdir file (purpose preserved verbatim, caveman style, `See change:` intact). Zero source-file moves. This is the cheapest, lowest-risk increment and lands right after D1.

### D3 — Direct import-path updates, no new barrels; codemod covers BOTH specifiers and string paths
When foldering source, update importers to the new deep path (`../components/session/SessionCard.js`) rather than introducing `index.ts` barrels. Rationale: the repo already imports foldered components by deep path (e.g. `tool-renderers/*`), barrels add an indirection layer and a re-export surface to maintain, and deep paths keep the DOX tree's per-file rows meaningful.

The rewrite has **two** reference classes and the codemod MUST cover both:
1. **ESM import specifiers** — ts-morph over resolved specifiers; `tsc --noEmit` is the safety net. Preserve the repo's `.js`-extension-on-`.tsx` convention (`from "../components/CommandInput.js"`).
2. **String-literal path references** — `tsc` does NOT see these. Multiple `packages/shared/src/__tests__/no-*.test.ts` allowlists reference source files as `"packages/server/src/<file>.ts"` / `"packages/client/src/components/<file>.tsx"` strings (verified: `no-direct-child-process`, `no-managed-dir-reference`, `no-direct-platform-branch`, `plugin-activation-contracts`). A `git grep -nE '"packages/(client/src/(components|lib)|server/src)/'` pass per increment finds them; they are updated in the same commit. These fail only at **test runtime**, so `npm test` (not just `tsc`) is a required gate per increment.

### D4 — Grouping taxonomy is per-increment design, sketched not frozen; RECONCILE with existing subfolders
The exact file→subfolder assignment is decided when each increment is implemented (it needs a read of each file's role). Representative sketches below anchor scope; they are not a frozen contract. **These directories are NOT greenfield** — each already has subfolders, and the fold MUST absorb root-level files into an existing subfolder where one fits before inventing a new name. Naming a new subfolder that collides with an existing one (e.g. a new `preview/` when `components/preview/` already holds `MarkdownPreview.tsx`, `ImagePreview.tsx`, …) is forbidden.

- **`packages/client/src/components/` (~172 root-level; existing subfolders: `DirectorySettings/`, `Gateway/`, `chat/`, `editor-pane/`, `extension-ui/`, `interactive-renderers/`, `preview/`, `split/`, `tags/`, `tool-renderers/`):** absorb root peers into existing homes first — root `Markdown*`/`Image*`/`Mermaid*`/`PreviewCard`/`PreviewOverlayView` → existing `preview/`; `ChatView*` → existing `chat/`; `Split*`/`SessionSplitView` → existing `split/`. Then new subfolders for un-homed domains: `openspec/`, `packages/` (Package*/Install*/WhatsNew*), `session/`, `worktree/` (Worktree*/Branch*/Commit*/Merge*), `diff/`, `workspace/`, `folder/`, `terminal/`, `connectivity/` (Tunnel*/Pair*/Paired*/Qr*/NetworkDiscovery*/KnownServers*), `settings/`, `primitives/`.
- **`packages/server/src/` (~138 root-level; existing subfolders: `browser-handlers/`, `lib/`, `model-proxy/`, `routes/`, `rpc-keeper/`, `test-support/`, `tunnel-providers/`):** absorb `model-proxy*` root files into `model-proxy/` etc.; new subfolders for `session/`, `worktree/`+`git/`, `goal/`, `tunnel/`, `auth/`, `openspec/`, `pending/`, `pi/`, `canvas/`, `changelog/`, `package/`, `spawn/`+`process/`.
- **`packages/client/src/lib/` (~118 root-level; only `__tests__/`):** new subfolders `openspec/`, `gateway/`, `session/`, `git/`, `package/`, `pairing/`, `canvas/`, `i18n/`, `replay/`, `chat/`, `primitives/`.

**A cohesive domain that itself exceeds `ROW_CAP` (>40 files) nests a further level** (e.g. `session/list/`, `session/card/`) rather than fragmenting into incoherent buckets; if no cohesive nesting exists either, the subfolder is accepted as an informational row-over (the inline-count fix also lets it drop below cap if its long rows sidecar-split). Do not fragment a real domain just to hit ≤ 40.

### D5 — Staging order and independence
1. Lint fix (D6 inline count + severity split — prerequisite, makes residual reads correct). 2. `qa/` rollup fix. 3. `docker/` rollup fix. 4. `components/` fold. 5. `server/src/` fold. 6. `lib/` fold. Each of 2–6 is independently **shippable** and should be a discrete PR with `tsc --noEmit` + `npm test` green. **Independent-revert caveat:** folds 4–6 rewrite overlapping importer files (a module that imports from both `lib/` and `components/`), so reverting an earlier fold after a later one lands may conflict on those shared importers — clean isolated revert holds only within a single fold or when no later fold re-touched the same importers. Land 4–6 in quick succession to keep the overlap window small.

## Risks / Trade-offs

- **Import churn (highest risk):** foldering ~430 source files rewrites imports repo-wide. Mitigation: codemod on resolved specifiers + `tsc --noEmit` gate + full `npm test` per increment; one directory per PR so a regression is bisectable.
- **Merge conflicts against active work:** many active changes touch `components/`, `server/src/`, `lib/`. Mitigation: land increments quickly and individually; coordinate ordering so a fold PR rebases cleanly ahead of feature PRs, or defer a directory whose files are mid-flight.
- **Over-foldering:** a too-fine taxonomy creates 3-file subfolders and its own noise. Mitigation: target ≤ 40 rows and cohesion, not minimum row count; merge thin domains into a sibling.
- **Churn-for-lint smell:** the honest framing (D1) is that this is pursued for *navigability + cohesion*, with the lint as the trigger — not to make an advisory warning disappear. Marginal dirs are explicitly left alone to reinforce that.

## Migration / Rollout

Per-increment. No data migration, no user-facing change, no server restart semantics. The DOX tree self-updates as `AGENTS.md` files are added/edited (the kb-extension reindex hook acknowledges rows on edit). After all increments: `kb dox lint` shows 0 byte-over and only the accepted marginal row-over (informational).

## Open Questions

- **OQ1:** Should the marginal dirs (`hooks/`, `extension/src/`, `shared/src/`) be foldered opportunistically if a clean 2–3 subfolder split falls out of the big-three work, or strictly deferred? (Default: deferred; fold only if free.)
- **OQ2:** For `tests/e2e/` (62 flat specs), is a `specs/<area>/` grouping worth the Playwright path updates, or accepted as informational? (Default: accepted.)
- **OQ3:** Codemod tool choice — ts-morph (accurate, heavier) vs a resolved-specifier `sed` pass (lighter, needs care with re-exports). (Default: ts-morph for the big three.)
