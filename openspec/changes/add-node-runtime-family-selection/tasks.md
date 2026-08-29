# Tasks — add-node-runtime-family-selection

Depends on `fix-node-family-resolution-gaps` landing first: this change assumes the
family chains are already aligned, so selection has a coherent base to build on.

## 0. Settle the premise before building

- [ ] 0.1 Run `doubt-driven-review` on the proposal's open question: is the family
      invariant load-bearing enough to justify a new module, or is the UX argument
      alone sufficient? Record the verdict in the proposal.
- [ ] 0.2 Decide version-manager scope (nvm only vs fnm/asdf/volta). Every added root
      must stay aligned with the strategy chains — cost is recurring, not one-off.
- [ ] 0.3 Decide migration: adopt an existing coherent trio as "selected", or start
      unset. Use `ask_user`.
- [ ] 0.4 STOP if 0.1 concludes the invariant is not load-bearing — close this change
      and keep only the hotfix. This is a real outcome, not a formality.

## 1. Enumeration (TDD)

- [ ] 1.1 Test: candidate roots exactly mirror the roots the `node`/`npm`/`npx`
      chains probe. Assert set equality, so the two cannot drift silently.
- [ ] 1.2 Test: a root with `node` but no `npm` yields a candidate with `npmEntry`
      absent — NOT a discarded candidate, NOT a fabricated path.
- [ ] 1.3 Test: version is read from filesystem metadata; assert no child process is
      spawned (inject the spawn seam and assert it is never called).
- [ ] 1.4 Test: `registry.rescan()` invalidates the enumeration cache.
- [ ] 1.5 Implement `packages/shared/src/node-installs/` mirroring the structure of
      `packages/shared/src/pi-installs/`.

## 2. Atomic family write (TDD)

- [ ] 2.1 Test: selecting a full candidate persists all three keys in ONE
      `setOverrides` call. Assert on call count, not just the resulting file — the
      single-write property is the point.
- [ ] 2.2 Test: selecting a candidate with an absent member CLEARS that override
      rather than writing a non-existent path.
- [ ] 2.3 Test: a path outside the selected root, or a directory, is rejected and
      NOTHING is persisted (no partial write).
- [ ] 2.4 Implement selection persistence.

## 3. Coherence reporting

- [ ] 3.1 Test: three members in different roots → mismatch reported, naming the
      deviating member and its root.
- [ ] 3.2 Test: a legitimately absent member does not by itself constitute a
      mismatch (guards against 1.2's partial family being mis-flagged).
- [ ] 3.3 Test: a hand-set member is reported as a deviation before the write and can
      be preserved.
- [ ] 3.4 Implement reporting + the Settings → Developer options picker.

## 3b. Absorbed: Windows npm anchoring (TDD)

- [ ] 3b.1 Decide the peer-resolution binding site (`registerDefaultTools` vs registry
      constructor vs factory) and record it in `design.md`. Re-evaluate the
      global-registry option on determinism/test-isolation grounds — NOT on the false
      premise that `LazyRegistry` lacks `resolve()` (`runner.ts:95-99` declares it).
- [ ] 3b.2 Test: the peer seam is bound in the PRODUCTION path. Assert that a registry
      built the way `getDefaultRegistry()` builds it (`index.ts:32-38`, currently no
      deps) resolves npm's anchor through the peer, not `process.execPath`. Without
      this test the fix is inert in production while unit tests pass.
- [ ] 3b.3 Test (win32 ctx): `npmCliBesideNode` returns `npm-cli.js` from the
      peer-resolved node's installation, not the injected `execPath`'s. Inject distinct
      fake roots.
- [ ] 3b.4 Test (win32 ctx): with no resolvable peer node, the strategy probes beside
      the injected `execPath` seam and never reads `process.execPath`; existence goes
      through `deps.exists`, not raw `existsSync`.
- [ ] 3b.5 Test: re-entrancy — a peer lookup that would re-enter the in-flight tool is
      refused, not looped. Note the registry cache is written only AFTER the strategy
      loop (`registry.ts:203`), so a cache check alone does not stop recursion; the
      guard needs an in-flight set at the binding site.
- [ ] 3b.6 Implement: thread `deps` into `npmCliBesideNodeStrategy` (currently the only
      strategy constructed without them), anchor on the peer, fall back to
      `deps.execPath`, route probes through `deps.exists`, add the guard.
- [ ] 3b.7 Correct the stale comment at `definitions.ts:611-614` describing the
      unimplemented "global registry hook" mechanism.
- [ ] 3b.8 Confirm and document the behaviour change: win32 npm now follows `node`'s
      override. Verify a `node` override at an installation lacking `node_modules/npm`
      degrades to `where` rather than failing the row.

## 4. Child-process PATH

- [ ] 4.1 Test: with a non-managed selection, a spawned child's PATH is prepended
      with the SELECTED bin dir and not the managed one.
- [ ] 4.2 Test: with no selection, child PATH construction is byte-identical to
      pre-change behaviour, and `process.env` is never mutated.
- [ ] 4.3 Update `prependManagedNodeToPath` and every spawned-child env builder named
      in `packages/shared/src/platform/AGENTS.md` (pi-session, pi-core-updater,
      headless, server-launcher).

## 5. Simplify check

- [ ] 5.1 Run `code-simplification`: confirm the family relationship is now expressed
      in FEWER places than before. If the four divergence sites from the proposal are
      still independently expressible, the change has not met its goal — say so
      rather than shipping.

## 6. Verify

- [ ] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` + grep the summary.
- [ ] 6.2 Build + restart per the `implement` skill matrix (shared/server/client all
      touched → `npm run build` then `POST /api/restart`).
- [ ] 6.3 Manual: select a non-managed Node, confirm all three rows follow it and a
      spawned session's `node --version` matches.
- [ ] 6.4 `openspec validate add-node-runtime-family-selection --strict`.

## 7. Docs

- [ ] 7.1 Delegate `docs/` prose to DocScribe (caveman style) — architecture entry
      for the selection flow.
- [ ] 7.2 Add `packages/shared/src/node-installs/AGENTS.md` via `kb dox init`; update
      the `platform/` and `tool-registry/` rows with `See change:` markers.
