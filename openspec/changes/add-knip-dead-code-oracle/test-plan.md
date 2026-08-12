# Test Plan — add-knip-dead-code-oracle

Stage: design   Generated: 2026-08-12

All four gate questions (phantom-fix placement, escalation trigger,
reconciliation mechanism, harness inclusion) were resolved before the specs were
written and are recorded under `## Decisions` in `proposal.md`. No open markers.

Baseline evidence for the numeric assertions below is `spike-results.md`
(63/63 `unlisted` true positives; 5.59s measured whole-workspace runtime).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | phantom deps resolved | EP | L1 | automated | current workspace manifests | run Knip, read `issues[].unlisted` | total `unlisted` count is `0` |
| E2 | each known phantom declared | decision-table | L1 | automated | the 7 packages: `node-pty`, `@mdi/js`, `@vitejs/plugin-react`, `@testing-library/react`, `jszip`, `@pi/anthropic-messages`, `@electron-forge/shared-types` | for each importing package, read its `package.json` | every importer declares the dep in `dependencies` or `devDependencies` |
| E3 | regression: new undeclared import | EP | L1 | automated | temp package importing `left-pad`, not declared | run Knip on fixture | reports exactly one `unlisted` naming `left-pad` |
| E4 | config must not suppress `unlisted` | decision-table | L1 | automated | parsed `knip.json` | inspect ignore/`ignoreDependencies` entries | no entry matches any of the 7 phantom package names |
| E5 | plugin client entry not orphaned | EP | L1 | automated | `packages/automation-plugin/src/client/**` | run Knip | no `*-plugin` client entry appears in `files`; `react-dom` not reported unused for it |
| E6 | skill/config entries not orphaned | EP | L1 | automated | `.pi/skills/**/scripts/*.ts`, `packages/*/vitest.config.ts`, `public/sw.js` | run Knip | none appears in the unused `files` list |
| E7 | server→client type import followed | EP | L1 | automated | `ConfigOk` exported by `blackhole-plugin/src/server/config-io.ts`, imported by `src/client/BlackholeSettings.tsx` | run Knip | `ConfigOk` not reported as an unused type |
| E8 | genuine orphan still detected | EP | L1 | automated | fixture module with an export nothing imports | run Knip on fixture | that export is reported in `exports` |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | whole-workspace runtime budget | BVA | L1 | automated | full workspace | timed Knip run | wall time < 30s (baseline 5.59s) |
| P2 | per-change loop unaffected | BVA | L1 | automated | `package.json` scripts + `quality:changed` implementation | resolve the changed-scope command chain | no Knip invocation reachable from `quality:changed` |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | advisory job cannot fail nightly | decision-table | ci | automated | `nightly.yml` Knip job | parse workflow YAML | job carries `continue-on-error: true` while baseline is unclean |
| X2 | Knip absent from PR CI | EP | ci | automated | `ci.yml` | parse workflow YAML | no step or script invokes `knip` |
| X3 | Knip present in nightly | EP | ci | automated | `nightly.yml` | parse workflow YAML | a job invokes the whole-graph Knip script |
| X4 | cross-check: orphan in both tools | decision-table | L1 | automated | file unused per Knip AND orphan row per `kb dox lint` | run cross-check script | reported as confirmed dead code / deletion candidate |
| X5 | cross-check: doc-only drift | decision-table | L1 | automated | reachable file, orphan `AGENTS.md` row | run cross-check script | reported as documentation-only drift; not a deletion candidate |
| X6 | cross-check: code-only drift | decision-table | L1 | automated | unused file, valid `AGENTS.md` row | run cross-check script | reported as code-only drift; row flagged for removal |
| X7 | cross-check: clean | EP | L1 | automated | neither tool reports orphans | run cross-check script | no drift reported; exit code `0` |
| X8 | cross-check handles missing input | EP | L1 | automated | `kb dox lint` output absent/unparseable | run cross-check script | fails with a named error, does not report false drift |

### Integration / harness

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| H1 | harness runs Knip | EP | L2 | automated | docker harness container | invoke the Knip script inside the harness | completes; produces the same finding classes as a host run |
| H2 | escalation flip to blocking | state-transition | ci | manual-only | baseline reached zero | flip `continue-on-error` off and introduce an unused export | pipeline fails — verified once at escalation time, post-merge |
| H3 | published package installs standalone | EP | L2 | manual-only | a package whose phantom deps were fixed | pack + install outside the monorepo | imports resolve without the hoist |

---

## Disposition summary

- `automated`: E1–E8, P1–P2, X1–X8, H1 → **19**
- `manual-only`: H2, H3 → **2**
