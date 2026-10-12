## Context

See proposal.md (Why). Current state, cited:

- `tests/e2e/AGENTS.md` is 29 997 bytes against the 30 000 `dox-byte-gate` cap. The
  `helpers/*` rows were already split into `tests/e2e/helpers/AGENTS.md` (1 408 B,
  9 rows). Of the `__tests__/` files it lists only `evidence-path.test.ts`. The two other sidecars exist
  on disk: `tests/e2e/helpers/__tests__/{lifecycle,playwright-config}.test.ts.AGENTS.md`.
- `docker/test-up.sh:48-49` computes `PEER_HARNESSES` and gates the whole capacity
  block on `[ -n "$PEER_HARNESSES" ]`. The refusal headline at `:64` reads
  "co-resident harness oversubscription". The behaviour matrix is pinned by
  `scripts/__tests__/test-up-oversubscribe-guard.test.mjs` (docker stubbed on
  PATH, `FAKE_PROJECTS` / `FAKE_MEMTOTAL` / `FAKE_INFO_FAIL`). The FAQ entry is at
  `docs/faq.md:3172`.
- `packages/shared/src/__tests__/e2e-fixme-guard.test.ts:37` matches
  `test.fixme(<cond>, "<reason>")` by regex over every `tests/e2e/**` spec.
  The guard walks `tests/e2e/` recursively. Six file-level (column-0) conditional
  `test.skip` calls exist today:
  - `tests/e2e/browser-relay.spec.ts:110` (multi-line call; reason names the `e2e-browser-relay` leg);
  - `tests/e2e/identity-matrix/multi-user.spec.ts:44`, `tests/e2e/team/team-{llm,skills,app,standalone}.spec.ts`
    (`test.skip(!hasPi, "needs the pi CLI on PATH …")`). Their files are run by
    `playwright.identity-matrix.config.ts` / `playwright.team.config.ts`.
    They are also discovered, and skipped, by the default `playwright.config.ts`, whose
    `testDir` is `tests/e2e` with only `helpers/__tests__` ignored. **No CI workflow
    invokes either dedicated config**: `ci-e2e-browser.yml:112` shards the default
    config and the relay leg runs it too. So today these five files run in no CI
    leg, which the existing `playwright-e2e-qa` sharding requirement ("every spec SHALL
    run exactly once … in exactly one shard, or on a dedicated variant-harness leg") already fails.
  Indented guards exist inside test bodies and helpers, e.g.
  `tests/e2e/composer-session-strip.spec.ts:45` (inside the `connectBridge()`
  helper) and `tests/e2e/chat-gateway-team-controls.spec.ts:77` (tab-indented).
- `playwright.config.ts:22-26` declares `REPORTERS` untyped. Root `tsconfig.json`
  `include` is `packages/*/src`, so the config is never type-checked. A strict
  `tsc` over the file reproduces CodeRabbit's TS2769 claim. Verified: annotating
  with `ReporterDescription[]` alone still fails (TS2322), because the conditional
  spread `...(IS_CI ? [["blob"]] : [])` widens to `string[][]`. Adding `as const` on
  that inner tuple makes it pass. `ReporterDescription` itself admits 1-tuples like `["list"]`.
- `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts:116-118`
  compares `count(runs-on)` against `count(timeout-minutes)` globally.
- `knip-ratchet.mjs` (run 2026-10-11): files 15/10, exports 245/234, types 189/193,
  duplicates 14/12. The figures in #510's body (243/194) are stale. `.github/workflows/nightly.yml:102-107`
  records that knip is nightly-only by decision ("Nightly, never ci.yml").
  `--check-baseline-diff <ref>` (`scripts/knip-ratchet.mjs:129-151`) rejects any
  raised class and has no override. It runs in ship-it step 4.4 against
  `origin/develop` and in nightly against `HEAD~1`. The `dead-code-detection` spec
  ("Per-class baseline ratchet") makes that rejection normative.
- `packages/server/src/persistence/memory-event-store.ts:803-810` exempts a
  base64 `data` string from `truncateStrings` when `isBase64DataCarrier(obj)`.
  `packages/server/src/attachments/display-fit.ts:8-10` caps a fitted derivative at
  ~212 KB, ~50× the default string cap `DEFAULT_MAX_STRING_SIZE = 4_000`
  (`memory-event-store.ts:643`). The `in-memory-event-buffer` spec ("Image data
  preservation during truncation") requires the exemption. `:915-920` in
  `walkObjectSize` carries two contradictory comment paragraphs. The first says
  image bytes count as a constant, which is false (trailer `See change:
  bound-subagent-event-serialization`). The second, newer one says they count at real size (trailer `See change:
  head-tail-truncate-subagent-event-timeline (D8)`).

## Goals / Non-Goals

**Goals:** close #705, #701, #510 and #416 with each gate green and honest.

**Non-Goals:**
- Deleting the long tail of unused exports. Only the overage above the existing
  baseline is cleaned (D6); no baseline class is raised.
- Adding knip to `ci.yml`.
- Changing in-test `test.skip` usage or any spec's skip **condition**. The
  file-level reasons of the five `hasPi` skips are reworded (D3); their conditions stay.
- Splitting `tests/e2e/AGENTS.md` further.

## Decisions

**D1 — #705: write rows into the existing split file.** The issue suggested
`tests/e2e/AGENTS.md`, but the `helpers/` split it recommended as the durable fix
has since landed. The rows belong in `tests/e2e/helpers/AGENTS.md`, with paths relative
to that directory. The alternative (rows in the parent) is impossible: 3 bytes of headroom.

**D2 — #701.1: always compute, decide by peer count.** Use
`INSTANCES = PEER_COUNT + 1` unconditionally, with `PEER_COUNT=0` when none. Outcomes:

| peers | fits | memory readable | result |
|---|---|---|---|
| 0 | yes | yes | silent (unchanged) |
| 0 | no | yes | refuse (headline: "harness memory cap exceeds the daemon"); override → one warning |
| 0 | — | no | silent (never refuse on missing data; a lone run must not gain noise) |
| ≥1 | as today | as today | unchanged |

The #701 comment's guard-test nit is handled here too. Every refusal case in
`test-up-oversubscribe-guard.test.mjs` asserts that `compose up` was never reached,
by reading `$FAKE_DOCKER_LOG`, not just the exit code.

Rejected: warn-only for a lone oversize. This is a policy choice: `MEM_LIMIT` is a
cgroup cap, not a reservation, so a lone oversize does not necessarily OOM. But the
spec arithmetic is a refusal and `test-up.sh:44` already treats a cap equal to
MemTotal as oversubscribed (no host headroom). A lone harness is held to the same rule.

**D3 — #701.2: top-level = a line that starts with `test.skip(`.** A file-scope
call is any source line whose **first character** begins `test.skip(`, with no leading
space or tab. The call may span lines: the guard reads from `test.skip(` to its
matching `)` (paren depth, string-aware), then takes argument 1 as the condition and
argument 2 as the reason. A call whose first argument is a string literal is the
unconditional `test.skip(title, body)` form and is ignored. Every indented call
(spaces or tabs, in a test, describe or helper body) is out of scope.

The reason passes if it contains **any** of:
- an `issues/<n>` URL;
- the id of a CI job in `.github/workflows/ci-e2e-browser.yml` that **runs specs**, i.e.
  a top-level `jobs:` key whose body invokes `playwright test`. `merge-report` runs none,
  so it is excluded. The id is matched as a whole token delimited by backticks or
  non-`[A-Za-z0-9_-]` characters, so `e2e` does not match inside `e2e-browser-relay`
  and `e2e-browser-relax` does not match.

A dedicated-config name is **not** accepted: no workflow runs those configs, so naming
one would bless a file that runs nowhere. The five `hasPi` file-level skips are
therefore honestly uncovered. Implementation files one tracking issue ("team /
identity-matrix specs have no CI leg"), and the five reasons link it (conditions
unchanged). Negative tests pin the matching rules: `"e2e flake"` is rejected,
`` "`e2e-browser-relay`" `` is accepted, `` "`merge-report`" `` is rejected,
`"e2e-browser-relax"` is rejected, `"playwright.team.config.ts"` alone is rejected,
and an indented or tab-indented call is ignored.
Rejected: an AST parse, which needs a new dependency in a test for one call shape. Rejected:
banning all conditional skips, which would break ~30 runtime guards. Rejected:
accepting any "needs X" precondition text, which is too loose to be a tripwire.

**D4 — #701.3: annotate, do not widen the tsconfig.** `import type {
ReporterDescription } from "@playwright/test"`, type `REPORTERS` as
`ReporterDescription[]`, and write the conditional entry as `[["blob"] as const]`.
Both changes are needed, as verified above. Bringing `playwright.config.ts` into a
type-checked project is a larger, separate change (unrelated configs would surface errors).

**D5 — #701 comment: per-job timeout.** Slice the workflow YAML per job (the
relay `describe` block already slices its own `job` text, but there is no named
helper. Extract one `jobBlock(id)` used by both) and assert that each top-level job
(`e2e`, `e2e-browser-relay`, `merge-report`) carries its own `timeout-minutes`.

**D6 — #510: clean back under the existing baseline; never raise it.** Raising
is ruled out by the `dead-code-detection` ratchet and by the enforcer, which has no override.
Work from a fresh `knip --reporter json` at implementation time, not the
issue's numbers:
1. *files (15 → ≤ 10)*. Each reported file falls into one bucket:
   *config gap*: a real entry knip cannot see (playwright global
   setup/teardown referenced from `playwright*.config.ts`; deck3d fixture build
   scripts run by tests or CLI). Root it in `knip.json`, keeping
   `node scripts/knip-config.mjs` green.
   *confirmed dead*: no static or dynamic-by-name import from source, only its own
   test or prose refers to it. Delete it with its test and its `AGENTS.md` row.
   *uncertain*: keep it.
2. *exports (245 → ≤ 234), duplicates (14 → ≤ 12)*. Remove the `export` keyword (or
   the symbol, when nothing uses it locally), ordered by blast radius: symbols with no
   importer at all first, then leaf modules, never shared hub modules. `git log -S`
   dating does not work here because most symbols date to the monorepo restructure.
   Of the 14 duplicates, 11 are plugin `registerPlugin=default` entry contracts and
   stay. The other three are `EmlPreview`, `PdfPreview` and
   `FlowInputWiring`/`FlowInputWiringClaim`. Dropping one side of a pair means editing
   its importers too: `components/editor-pane/viewer-registry.tsx:34` imports
   `EmlPreview` by name and `:51` lazy-imports `PdfPreview`'s default. Two of the three
   must go, each followed by `tsc` and a client build. Constraint: `PdfPreview` must stay
   lazy-loaded (`file-and-url-preview` spec, line 174: pdfjs rides its own chunk). Keep its
   `default` export and drop only the named alias, and only if no module imports it statically.
   Never introduce a static import of it.
   Config-gap entries hand-added to `knip.json` (playwright global setup, deck3d
   fixtures) follow the existing `ignore`/`entry` precedent. `knip-config.mjs` only
   checks manifest-derived entries, so the hand-added part is verified by a before/after
   `knip --reporter json` files-class delta recorded in the PR body.
3. *types (189 ≤ 193)* already pass.
If a class lands below its ceiling, lower that number in `knip-baseline.json`
(`measuredAt`, `_comment` naming this change). Lowering is allowed and keeps the
ratchet tight. `--check-baseline-diff origin/develop` must then report "no
baseline class was raised". If a class cannot reach its ceiling without deleting
something uncertain, stop and hand back (`SHIP_IT_BLOCKED.md`). Never raise.

**D7 — #416: keep the exemption, fix the comment, pin with a test.** Delete the
stale first paragraph at `memory-event-store.ts:915-920`, keeping **both** `See
change:` trailers on the surviving paragraph. Add an L1 test proving that an image
block, in **both** the flat `{data, mimeType}` shape and the nested Anthropic
`{source: {media_type, data}}` shape, whose base64 `data` string is larger than `DEFAULT_MAX_STRING_SIZE` (sized from the
imported constant, not a literal), carries a sibling `mimeType` and stays under the event
ceiling survives `truncateStrings` byte-identical.
Close #416 with a comment explaining it was verified reachable, not dead.

## Risks / Trade-offs

- [A lone developer with `MEM_LIMIT` ≥ daemon now gets refused] → the override
  variable still works, and the FAQ documents it.
- [The line-start heuristic misses a file-scope skip wrapped in `if (…) {}` or an
  IIFE] → acceptable: the guard is a tripwire for the shape the suite actually
  uses, not a proof. Pinned as a known miss in the guard's doc comment.
- [Un-exporting a symbol breaks a consumer knip cannot see (plugin loaded by
  name, test-only import)] → `npm test` plus `npm run build` after each batch. A
  symbol imported only by tests stays exported (knip already treats test files as entries).
- [Deleting a file knip calls dead that is actually loaded dynamically] → bucket 2
  requires no import or dynamic reference by name in source. The full `npm test` plus
  client build must pass after each deletion.

## Migration Plan

None. Repo-internal tooling and tests only; rollback is `git revert`.
