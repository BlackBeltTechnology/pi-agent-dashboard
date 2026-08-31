# Tasks — add-node-runtime-family-selection

Absorbs the remaining scope of `fix-node-family-resolution-gaps` (user decision,
section 0): that change's directory is superseded and removed at ship time.
Landed-context note: `unify-pi-runtime-identity` already landed — the ladder reads
this change's selection as its gated step-1 candidate (`readToolOverrideNode`), and
`spawn-runtime.ts` carries `resolvedFamilyEntries`. Section 4 reconciles with that
reality (see design.md D7) rather than re-introducing an unconditional managed
prepend.

## 0. Settle the premise before building

- [x] 0.1 Run `doubt-driven-review` on the proposal's open question: is the family
      invariant load-bearing enough to justify a new module, or is the UX argument
      alone sufficient? Record the verdict in the proposal.
      DONE — verdict: load-bearing, PROCEED. Cross-model review (`@propose-review-2`)
      returned 3 blockers / 8 concerns / 2 nits; all adopted fixes are recorded in
      the proposal's "Section-0 outcomes" and design.md.
- [x] 0.2 Decide version-manager scope (nvm only vs fnm/asdf/volta). Every added root
      must stay aligned with the strategy chains — cost is recurring, not one-off.
      DONE — nvm + fnm + volta + asdf (user decision).
- [x] 0.3 Decide migration: adopt an existing coherent trio as "selected", or start
      unset. Use `ask_user`.
      DONE — adopt an existing coherent trio as "selected"; else start unset
      (user decision; semantics in design.md D5).
- [x] 0.4 STOP if 0.1 concludes the invariant is not load-bearing — close this change
      and keep only the hotfix. This is a real outcome, not a formality.
      N/A — verdict was affirmative; also the hotfix itself is absorbed (user
      decision), so "keep only the hotfix" no longer exists as a fallback shape.

## 1. Enumeration (TDD)

- [x] 1.1 Test: candidate roots exactly mirror the roots the `node`/`npm`/`npx`
      chains probe. Assert set equality, so the two cannot drift silently.
      DONE — one-directional mirror per review finding 4: chain roots ⊆
      enumeration; version-manager roots additive (scope decision 0.2).
- [x] 1.2 Test: a root with `node` but no `npm` yields a candidate with `npmEntry`
      absent — NOT a discarded candidate, NOT a fabricated path.
- [x] 1.3 Test: version is read from filesystem metadata; assert no child process is
      spawned (inject the spawn seam and assert it is never called).
      DONE — `spawn` dep is a tripwire; version optional per review finding 5.
- [x] 1.4 Test: `registry.rescan()` invalidates the enumeration cache.
- [x] 1.5 Implement `packages/shared/src/node-installs/` mirroring the structure of
      `packages/shared/src/pi-installs/`.
      DONE — candidates.ts / vm-roots.ts / index.ts; cache wired into rescan().

## 2. Atomic family write (TDD)

- [x] 2.1 Test: selecting a full candidate persists all three keys in ONE
      `setOverrides` call. Assert on call count, not just the resulting file — the
      single-write property is the point.
- [x] 2.2 Test: selecting a candidate with an absent member CLEARS that override
      rather than writing a non-existent path.
      DONE — via the explicit-discard path: a prior differing override is hand-set
      by definition (design D5, review blocker 2 precedence), preserved unless
      discarded; the discard clears it in the SAME single write.
- [x] 2.3 Test: a path outside the selected root, or a directory, is rejected and
      NOTHING is persisted (no partial write).
- [x] 2.4 Implement selection persistence.
      DONE — select.ts: planSelection (pure) + applySelection (validate-then-one-
      write); registry gained listOverrides() as the hand-set source of truth.

## 3a. Absorbed: npx managedRuntime + rejected-override badge (CONVERGED — the hotfix landed on develop as #587 mid-flight; the merge kept develop's landed implementations and this change's unique parts; the duplicated absorbed delta was dropped)

Harness exemplar for 3a.1–3a.8:
`packages/shared/src/__tests__/tool-registry-definitions.test.ts` (`freshRegistry`
helper with injected `exists`/`which`). Exemplar for 3a.9–3a.17:
`packages/client/src/components/settings/__tests__/PiRuntimeStatusRow.test.tsx`;
for 3a.15: `settings-unit-i18n.test.tsx`.

- [x] 3a.1 Test npx resolves the managed runtime over a PATH hit. Input:
      `<managedDir>/node/bin/npx` exists, `which("npx")` returns `/usr/bin/npx` ·
      Trigger: `resolve("npx")` · Observable: path is the managed one, not the PATH
      hit. MUST fail today (npx chain has `managedBin`, not `managedRuntime`).
- [x] 3a.2 Test override still outranks the managed runtime for npx.
- [x] 3a.3 Test bundled-node still outranks the managed runtime for npx.
- [x] 3a.4 Test a partial managed family falls through cleanly for npx: missing
      `<managedDir>/node/bin/npx` → `managedBin` hit, `tried[]` records the
      `missing:` probe, no non-existent path returned.
- [x] 3a.5 Test managedRuntime outranks managedBin for npx (both present).
- [x] 3a.6 Test the PATH fallback is preserved for npx.
- [x] 3a.7 Test the managed runtime is visible to every family member
      (node+npm+npx all share the `<managedDir>/node` prefix).
- [x] 3a.8 Test the npx trail order and length:
      `["override","bundled-node","managed","managed","where"]` — assert ORDER and
      LENGTH only (both managed strategies report `name: "managed"`). Reconcile the
      existing chain test + title at
      `tool-registry-definitions.test.ts` (npx trail) rather than duplicating.
- [x] 3a.9 Implement: add `managedRuntimeStrategy("npx", deps)` between
      `bundledNodeStrategy` and `managedBinStrategy` in the npx chain.
- [x] 3a.10 Test the rejected-override badge on a not-found row: third state,
      distinct from plain not-found AND from rejected-but-fell-back; tooltip names
      the rejected path. MUST fail today (`ToolsSection.tsx` gates on `tool.ok`).
- [x] 3a.11 Test a not-found row WITHOUT an override is unchanged (plain badge).
- [x] 3a.12 Test a resolved + rejected row keeps the existing fallback indicator.
- [x] 3a.13 Test the wording distinguishes fell-back from did-not-resolve.
- [x] 3a.14 Test an unparseable rejection reason still indicates (tooltip degrades
      to reason text; no empty/`undefined` path rendered). Include the non-ASCII +
      space path case and the trail-less payload case (degrade, no throw).
- [x] 3a.15 Test i18n parity for the new tooltip key in `en`, `zh-CN`, `hu`.
- [x] 3a.16 Implement: badge gating renders the third state on `ok:false` rows with
      a rejected override; tooltip names the path. Read the configured path from
      the overrides source rather than parsing prose; degrade per 3a.14 when
      unparseable. Do NOT rebuild the inline expanded warning, the trail render,
      or the payload — they already ship.
- [x] 3a.17 Confirm red for the right reason: 3a.1, 3a.4, 3a.5, 3a.7, 3a.8, 3a.10,
      3a.13, 3a.14 fail on their assertions, not on setup; note which regression
      guards already pass.

## 3. Coherence reporting

- [x] 3.1 Test: three members in different roots → mismatch reported, naming the
      deviating member and its root.
- [x] 3.2 Test: a legitimately absent member does not by itself constitute a
      mismatch (guards against 1.2's partial family being mis-flagged).
- [x] 3.3 Test: a hand-set member is reported as a deviation before the write and can
      be preserved.
- [x] 3.4 Implement reporting + the Settings → Developer options picker.

## 3b. Absorbed: Windows npm anchoring (TDD)

- [x] 3b.1 DONE — design.md D1/D2 (`StrategyDeps.resolvePeer` bound at `getDefaultRegistry` via exported `bindPeerResolution`; global-registry option rejected on binding-ambiguity grounds). Decide the peer-resolution binding site (`registerDefaultTools` vs registry
      constructor vs factory) and record it in `design.md`. Re-evaluate the
      global-registry option on determinism/test-isolation grounds — NOT on the false
      premise that `LazyRegistry` lacks `resolve()` (`runner.ts:95-99` declares it).
- [x] 3b.2 Test: the peer seam is bound in the PRODUCTION path. Assert that a registry
      built the way `getDefaultRegistry()` builds it (`index.ts:32-38`, currently no
      deps) resolves npm's anchor through the peer, not `process.execPath`. Without
      this test the fix is inert in production while unit tests pass.
- [x] 3b.3 Test (win32 ctx): `npmCliBesideNode` returns `npm-cli.js` from the
      peer-resolved node's installation, not the injected `execPath`'s. Inject distinct
      fake roots.
- [x] 3b.4 Test (win32 ctx): with no resolvable peer node, the strategy probes beside
      the injected `execPath` seam and never reads `process.execPath`; existence goes
      through `deps.exists`, not raw `existsSync`.
- [x] 3b.5 Test: re-entrancy — a peer lookup that would re-enter the in-flight tool is
      refused, not looped. Note the registry cache is written only AFTER the strategy
      loop (`registry.ts:203`), so a cache check alone does not stop recursion; the
      guard needs an in-flight set at the binding site.
- [x] 3b.6 Implement: thread `deps` into `npmCliBesideNodeStrategy` (currently the only
      strategy constructed without them), anchor on the peer, fall back to
      `deps.execPath`, route probes through `deps.exists`, add the guard.
- [x] 3b.7 Correct the stale comment at `definitions.ts:611-614` describing the
      unimplemented "global registry hook" mechanism.
- [x] 3b.8 CONFIRMED WANTED (user decision, Section-0 outcomes); documented in design.md D9 + changelog. Confirm and document the behaviour change: win32 npm now follows `node`'s
      override. Verify a `node` override at an installation lacking `node_modules/npm`
      degrades to `where` rather than failing the row.

## 4. Child-process PATH

- [x] 4.1 DONE — child-path.ts helper + tests; tooling lane wired (process-manager else-lane); pi-session lane already ladder-governed. Test: with a non-managed selection, a spawned child's PATH is prepended
      with the SELECTED bin dir and not the managed one.
- [x] 4.2 Test: with no selection, child PATH construction is byte-identical to
      pre-change behaviour, and `process.env` is never mutated.
- [x] 4.3 Update the child-PATH construction per design.md D7: dashboard-tooling
      builders (process-manager tool env, headless spawn) follow the selection;
      pi-core-updater and the managed-tree path keep managed-first; pi-session
      spawns need no change (ladder governs; selection is its step-1 candidate).
      Verify the actual consumer list in code first — `server-launcher` builds env
      via `buildSpawnEnv`, not this helper (review nit 12).

## 5. Simplify check

- [x] 5.1 DONE — verdict: MET. Before, the family relationship was expressed NOWHERE
      (four divergence sites independently expressible). After, it is expressed in
      ONE module (node-installs: selection + coherence + shared vm root table,
      design D3/D8) plus ONE seam binding (bindPeerResolution at getDefaultRegistry).
      Honest caveat: version-manager root knowledge is NEW (additive by scope
      decision 0.2), single-sourced in vm-roots.ts; the mirror test guards drift.
      The four divergence sites are no longer independently expressible: 1 fixed in
      the chain+spec, 2 fixed via the peer seam, 3 fixed by the atomic family write
      + coherence reporting, 4 fixed by the selection-aware child-PATH helper with
      explicit consumer classes. Run `code-simplification`: confirm the family relationship is now expressed
      in FEWER places than before. If the four divergence sites from the proposal are
      still independently expressible, the change has not met its goal — say so
      rather than shipping.

## 5b. Supersede the absorbed change

- [x] 5b.1 At ship time (before archive): remove
      `openspec/changes/fix-node-family-resolution-gaps/` — its scope is fully
      carried here (section 3a + the absorbed `specs/tool-registry/spec.md` delta);
      its reporter close-out thread (its tasks 9.x) is noted as staying with the
      superseded change.

## 6. Verify

- [x] 6.1 DONE — 17505 passed; 6 failures reproduce IDENTICALLY on clean develop
      (eval-guard, plugin-registry-populated, OpenSpecPreview, PluginStalenessBanner,
      overlay-claim ×2 — pre-existing, not this change's).
- [x] 6.2 Build + restart per the `implement` skill matrix (shared/server/client all
      touched → `npm run build` then `POST /api/restart`).
- [x] 6.3 DEFERRED per manual-keyword defer (no test-plan.md → legacy rule): post-merge manual QA — select a non-managed Node, confirm all three rows follow it and a spawned session's `node --version` matches. Manual: select a non-managed Node, confirm all three rows follow it and a
      spawned session's `node --version` matches.
- [x] 6.4 `openspec validate add-node-runtime-family-selection --strict`.

## 7. Docs

- [x] 7.1 DONE — docs/architecture.md `### Node runtime family selection` (Tool Resolution section); docs/AGENTS.md row updated. Delegate `docs/` prose to DocScribe (caveman style) — architecture entry
      for the selection flow.
- [x] 7.2 Add `packages/shared/src/node-installs/AGENTS.md` via `kb dox init`; update
      the `platform/` and `tool-registry/` rows with `See change:` markers.

## Post-review record

- 4.5 review gate: round 1 (`@review` = deepseek-v4-pro) — SHIP, 0 blocking,
  3 concerns + 2 nits. Round 2 fixes landed (honoured-override check in
  child-path; trio/pin-gated adoption in coherence; server-computed
  per-candidate pendingHandSet; containment fallback removed). Round-2
  re-review confirmed the shared/server fixes correct; its 2 client-layer
  blockers (stale pendingHandSet wiring + over-eager selected fallback)
  were fixed and verified by tests + tsc. Two-round cap reached.
- 6.1 full suite: 17505 passed; the 6 failures reproduce on clean develop.
- E2E harness: 80/83; the 3 failures reproduce on a harness WITHOUT this
  diff (pre-existing/environmental).
- Enforcers: green except the knip exports ratchet (236>234) which also
  fails on clean develop (stale baseline, not this change);
  `--check-baseline-diff` passes (baseline not raised).
