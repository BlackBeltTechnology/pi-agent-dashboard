# Test Plan — add-knip-dead-code-oracle

Stage: design   Generated: 2026-08-13 (round 3)

Rebuilt after the round-2 doubt-review and the corrected spike. Superseded and
removed: E1–E4 + H3 (phantom-dependency fixes — Biome owns that class) and
X4–X8 (kb-dox orphan cross-check — `dox lint`'s `orphan` means the file no
longer exists, so the scenarios were unconstructible). See the correction in `spike-results.md`.

Evidence: `spike-results.md` + `spike/knip.json` + `spike/knip-baseline.json`.
Measured baseline: files 10, exports 227, types 189, duplicates 11 (total 437),
9.78s whole-workspace.

---

## Scenarios

### Entry-point rooting

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| G1 | plugin manifest entries rooted | EP | L1 | automated | every package declaring `pi-dashboard-plugin.{client,server,bridge}` | compare declared paths against `knip.json` entries | every declared path is an entry |
| G2 | pi extension entries rooted | EP | L1 | automated | packages declaring `pi.extensions` (e.g. `packages/extension` → `src/bridge.ts`) | compare against `knip.json` entries | every listed path is an entry |
| G3 | app entries rooted | EP | L1 | automated | `client/src/main.tsx`, `electron/src/{main,preload}.ts`, `server/src/cli.ts` | run Knip | none reported as an unused file |
| G4 | new manifest entry is caught | decision-table | L1 | automated | fixture package adding a `pi-dashboard-plugin.bridge` absent from `knip.json` | run the config check | fails; names the package and missing entry |
| G5 | shell-invoked scripts are entries | EP | L1 | automated | `scripts/ab-context/extract.mjs` (run by `finish.sh`), `scripts/lib/smoke-spawn-session.mjs` (run by `test-standalone-npm-install-docker.sh`) | run Knip | neither is reported unused |
| G6 | rooting actually holds | EP | L1 | automated | `packages/extension/src/canvas-tool.ts` (imported by `src/bridge.ts`) | run Knip | not reported as an unused file |

### Ratchet

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | class regression fails | BVA | L1 | automated | baseline `exports: 227`, run reporting 228 | run the ratchet check | fails; output names class, baseline, new count |
| R2 | offsetting change still fails | decision-table | L1 | automated | `files` 10→9 and `exports` 227→229 | run the ratchet check | fails on `exports`; the `files` drop does not offset |
| R3 | counts at baseline pass | BVA | L1 | automated | every class exactly at baseline | run the ratchet check | succeeds |
| R4 | baseline increase rejected | decision-table | L1 | automated | a diff raising any recorded baseline number | run the enforcer | fails; message says remove dead code, do not raise the baseline |
| R5 | missing baseline fails loudly | EP | L1 | automated | no baseline file present | run the ratchet check | named error; current counts not adopted |
| R6 | enforcer is deterministic | EP | L1 | automated | unchanged tree | run the enforcer twice | identical verdict; no network, no model call |

### Rule ownership

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| D1 | dependency classes disabled | EP | L1 | automated | parsed `knip.json` | inspect rules | every dependency class disabled; Biome recorded as owner |
| D2 | no dependency findings emitted | EP | L1 | automated | current workspace | run Knip | zero findings in any dependency class |
| D3 | exempted trees not re-litigated | decision-table | L1 | automated | a `**/__tests__/**` file importing an undeclared dep | run Knip | nothing reported; no manifest declaration added |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | whole-workspace runtime budget | BVA | L1 | automated | full workspace | timed Knip run | wall time < 30s (measured 9.78s) |
| P2 | per-change loop unaffected | BVA | L1 | automated | `package.json` scripts + `quality:changed` chain | resolve the command chain | no Knip invocation reachable |

### CI wiring

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Knip absent from PR CI | EP | ci | automated | `ci.yml` | parse workflow YAML | no step or script invokes `knip` |
| X2 | nightly runs Knip | EP | ci | automated | `nightly.yml` | parse workflow YAML | a job invokes the whole-graph Knip script |
| X3 | nightly surfaces a regression | decision-table | ci | automated | nightly Knip job definition | parse workflow YAML | the job runs the ratchet check and fails on a class above baseline |

### Integration / harness

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| H1 | harness analyses the same tree | EP | L2 | automated | docker harness container | scan in the harness and on the host | unused-FILES sets equal; ratchet passes in-container; every knip-referenced tree present; `.pi/settings.json` absent |
| H1b | scalar equality is not asserted | EP | L2 | automated | host vs container `types` count | compare | documented env delta (1) does not fail the gate — see spec scenario "Cross-environment scalar equality is not required" |
| H2 | enforcer blocks a real regression | state-transition | L1 | manual-only | an unused export added on a branch | run the ship enforcer step | enforcer exits non-zero — verified once against a live run |

---

## Disposition summary

- `automated`: G1–G6 (6), R1–R6 (6), D1–D3 (3), P1–P2 (2), X1–X3 (3), H1+H1b (2) → **22**
- `manual-only`: H2 → **1**

### Revised during implementation

H1's original observable ("same per-class counts as a host run") was **not
achievable** and was replaced above. The image change did work — files, exports
and duplicates now match exactly — but the `types` class differs by one
(`KbSettingsClaimProps`) with identical file hashes, identical TypeScript
5.9.3 / `@types/react` 19.2.17, and each environment internally deterministic
across repeat runs. The difference is environmental (Node 24.15 vs 24.19), not
a tree difference, so the assertion now covers the unused-FILES set — the class
the tree shape actually moves (90 → 10 when the graph was rooted).
