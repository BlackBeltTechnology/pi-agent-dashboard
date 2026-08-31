# Test Plan — fix-node-family-resolution-gaps

Stage: proposal   Generated: 2026-07-09

Clarification C1 (badge rendering on a not-found + rejected-override row) was raised
and RESOLVED before this file was written: the row renders a **third distinct state**,
separate from both the plain not-found state and the existing fallback state. Scenario
observables below assert **three-way distinctness** rather than a specific glyph, so
the exact icon/colour remains an implementation choice that cannot silently invalidate
the manifest.

---

## Scenarios

### Edge-case

Harness exemplar for every L1 row below: `packages/shared/src/__tests__/tool-registry-definitions.test.ts` (`freshRegistry` helper, injected `exists`/`which` deps).

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | npx strategy chain | decision-table | L1 | automated | `<managedDir>/node/bin/npx` exists; `which("npx")` returns a different path (`/usr/bin/npx`) | `resolve("npx")` | `Resolution.path === <managedDir>/node/bin/npx`; NOT the PATH hit |
| E2 | npx chain — override precedence | decision-table | L1 | automated | override for `npx` → an existing file; managed runtime ALSO provides npx | `resolve("npx")` | `path` === override path AND `source === "override"` |
| E3 | npx chain — bundled outranks managed | decision-table | L1 | automated | `<resourcesPath>/node/bin/npx` exists AND `<managedDir>/node/bin/npx` exists | `resolve("npx")` | `path` === the `<resourcesPath>` one (bundled-node runs before managedRuntime) |
| E4 | npx chain — partial managed family | BVA (absent member) | L1 | automated | `<managedDir>/node/` exists but has NO `bin/npx`; `MANAGED_BIN/npx` exists | `resolve("npx")` | `path === MANAGED_BIN/npx`; the managedRuntime `tried[]` entry reads `missing: <probed path>`; no non-existent path is ever returned |
| E5 | npx chain — managedRuntime outranks managedBin | decision-table | L1 | automated | BOTH `<managedDir>/node/bin/npx` and `<managedDir>/node_modules/.bin/npx` exist | `resolve("npx")` | `path === <managedDir>/node/bin/npx` |
| E6 | npx chain — no managed roots | decision-table | L1 | automated | no override, no bundled, no managed roots; `which("npx")` → `/usr/bin/npx` | `resolve("npx")` | `path === /usr/bin/npx` AND `source === "system"` (pre-change behaviour preserved) |
| E7 | managed runtime visible to every family member | decision-table | L1 | automated | `<managedDir>/node/bin/{node,npm,npx}` all exist; no override, no bundled | `resolve("node")`, `resolve("npm")`, `resolve("npx")` | all three paths share the `<managedDir>/node` prefix; none resolves via `where` |
| E8 | ordered strategy chain + trail (C2) | state/order | L1 | automated | every root missing (`exists: () => false`, `which: () => null`) | `resolve("npx")` | `tried[]` strategy names in order `["override","bundled-node","managed","managed","where"]`, length 5. ORDER+LENGTH only — `managedRuntimeStrategy` and `managedBinStrategy` both report `name: "managed"`, so the trail cannot distinguish them by name; the behavioural claim lives in E1/E5 via resolved path |

### Frontend-quirk

Harness exemplar for every L1 row below: `packages/client/src/components/settings/__tests__/PiRuntimeStatusRow.test.tsx` (settings-row render + assertion pattern). F7 exemplar: `settings-unit-i18n.test.tsx`.

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | rejected override indicated on unresolved rows | decision-table | L1 | automated | `Resolution {ok:false, path:null, tried:[{strategy:"override", result:"invalid: path does not exist: /nope/bin/node"}, …]}` | row renders collapsed | badge state is distinct from BOTH the plain not-found state AND the fallback state (three-way distinct); tooltip contains the literal `/nope/bin/node` |
| F2 | not-found row without an override is unchanged | decision-table | L1 | automated | `{ok:false, tried:[{strategy:"override", result:"no override set"}, …]}` | row renders collapsed | badge === plain not-found state; tooltip contains no override wording |
| F3 | resolved + rejected keeps existing indicator | decision-table | L1 | automated | `{ok:true, source:"system", tried:[…override invalid…]}` | row renders collapsed | badge === the existing fallback state, byte-identical behaviour to today |
| F4 | resolved + clean is unchanged | decision-table | L1 | automated | `{ok:true, source:"system"}`, no override entry | row renders collapsed | badge === the ordinary resolved state |
| F5 | wording distinguishes fell-back from did-not-resolve | decision-table | L1 | automated | two rows: (a) `{ok:false}` + rejected override, (b) `{ok:true}` + rejected override | both render | (a)'s tooltip does NOT assert a fallback occurred; (b)'s tooltip DOES retain the existing fallback phrasing |
| F6 | unparseable rejection reason still yields an indicator | fault-injection (malformed input) | L1 | automated | `{ok:false, tried:[{strategy:"override", result:"invalid: validator said no"}]}` — reason carries NO path | row renders collapsed | badge still shows the rejected state; tooltip degrades to the reason text; renders no empty path, no `undefined`, no `null` |
| F7 | i18n parity for the new tooltip key | static/parity | L1 | automated | the new catalog key added by this change | `i18n:lint` / `i18n:parity` | key resolves in `en`, `zh-CN`, AND `hu` (`ui-i18n-coverage` spec:72) |
| F8 | new badge state reads as distinct at a glance | visual/subjective | — | manual-only | Settings → Tools with one rejected-override row, one plain not-found row, one fallback row | human looks at the collapsed list | [judgment: the three states are tellable apart without hovering — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | badge tolerates a trail-less payload | fault-injection (malformed) | L1 | automated | `Resolution` with `tried: []` (or absent), as an older server or a plugin-sourced row could produce | row renders | no throw; degrades to the plain not-found state |
| X2 | rejected path with spaces/non-ASCII renders intact | BVA (character-class boundary) | L1 | automated | `result:"invalid: path does not exist: /home/t/ünïcode dir/bin/node"` | row renders collapsed | tooltip contains the exact path including the space and non-ASCII characters, not truncated or mis-escaped |

### Performance

**None.** This change states no latency, throughput, memory, or soak requirement, and
`npx` resolution gains exactly one `existsSync` probe. Inventing a threshold to
populate this section would violate the skill's "never invent a missing value" rule.
If a perf budget is later attached to registry resolution, it belongs to that change.

---

## Coverage summary

- Requirements covered: 3/3 behavioural (npx chain incl. family visibility · rejected-override indication · trail/order preservation). The two spec-alignment items (`npm` scenario drift, stale `spec.md:350` note) and the MODIFIED-block carry-forward are **documentation-only with no runtime observable** — verified by tasks 4.1/4.1a, not by a test.
- Scenarios by class: edge 8 · perf 0 · frontend 8 · error 2
- Scenarios by level: L1 17 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 17 · manual-only 1

Why no L2/L3: defect 1 is pure resolution logic behind fully injected `exists`/`which`
seams, and defect 2 is pure render logic over a payload prop. Neither needs a process
spawn or the docker harness, and routing them there would trade determinism for
runtime with no added coverage. L3 would be warranted only if this change altered the
`/api/tools` payload — it does not (C6 holds; the payload is untouched).

## New infra needed

None. All three harness exemplars already exist:
`tool-registry-definitions.test.ts`, `PiRuntimeStatusRow.test.tsx`,
`settings-unit-i18n.test.tsx`.
