# Add Node runtime family selection

## Why

`node`, `npm`, and `npx` are one artifact — a Node distribution ships all three in a
single `bin/` — but the tool registry models them as three independent tools with
three independent strategy chains and **three unrelated override keys**. The
invariant "these three come from the same installation" is not expressible anywhere
in the system, so nothing detects or prevents its violation.

That gap has already produced four independent divergences:

1. `npx` omitted `managedRuntimeStrategy`, so a managed Node was visible to `node`
   and `npm` but not `npx`.
2. Windows `npm` anchors `npm-cli.js` on `process.execPath` instead of the resolved
   `node`, pairing one installation's `node` with another's `npm`. **Moved into this
   change** from `fix-node-family-resolution-gaps` — see "Absorbed: Windows npm
   anchoring" below.
3. Setting `node` + `npm` overrides leaves `npx` untouched, because
   `overrideStrategy(toolName)` reads only its own key. A user can configure a
   mismatched family and get no warning.
4. `prependManagedNodeToPath` unconditionally prepends the **managed** runtime to
   every spawned child's PATH. If a user selects a non-managed Node, children still
   receive the managed one first.

`fix-node-family-resolution-gaps` patches 1 and makes 3 visible. Neither that change
nor any per-tool patch prevents a *fifth* divergence, because the missing piece is a
concept, not a line: there is no notion of "the selected Node installation".

## Absorbed: Windows npm anchoring

Divergence 2 was originally scoped into the hotfix and moved here after adversarial
review showed it is not a surgical change. `npmCliBesideNodeStrategy`
(`definitions.ts:614-627`) is documented as resolving node "via the global registry
hook" but reads `process.execPath`. Fixing it requires infrastructure this change
must build anyway:

- **A peer-resolution seam.** `StrategyCtx` is `{overrides, platform, env}` — no
  registry, no `resolve()`. Strategies cannot consult a peer today.
- **A production wiring decision.** `getDefaultRegistry()` calls
  `registerDefaultTools(defaultRegistry)` with **no deps** (`index.ts:36`), and it is
  the only non-test construction in the repo. A `StrategyDeps`-only seam would be
  injected in tests and `undefined` in production — green tests over an unfixed
  defect. The binding site must be named explicitly.
- **A re-entrancy guard at the binding site.** `resolve("npm") → resolve("node")` is
  acyclic only because nothing in `node`'s chain consults a peer. The registry cache
  is written *after* the strategy loop (`registry.ts:203`), so a re-entrant call finds
  no partial entry and fully re-loops — a cache check alone cannot stop it. The guard
  needs an in-flight set owned by the binding, not by either strategy.
- **`deps.exists` threading.** The strategy also probes via raw `existsSync`, not the
  injected seam, leaving test isolation half-broken even after `execPath` is fixed.

Note for the design phase: an earlier draft rejected the global-registry option on
the false premise that `LazyRegistry` lacks `resolve()`. It does not —
`runner.ts:95-99` declares `resolve`, the global slot holds a full `ToolRegistry`
(`index.ts:29-37`), and `runner.ts:207` already resolves through it in production.
Re-evaluate that option on its actual merits (determinism and test isolation), not on
the stated shape.

The defect's real impact is also narrower than first stated: `makeNodeScriptToArgv`
(`definitions.ts:489-500`) already pairs `resolve("node")` with the resolved script,
so the executed argv is `[resolvedNode, npmCliFromElsewhere]`. The harm is that the
npm *code* selected can belong to a different installation than the node running it,
and that the Tools row reports it as the active npm.

The user-facing consequence is the one actually reported: a user expected a Node
selector in Settings → Developer options and found only three unrelated text fields,
so switching Node versions appeared not to work.

## What Changes

- **ADD** a `node-installs` module that enumerates candidate Node *installations*
  (bundled `<resourcesPath>/node`, managed `<managedDir>/node`, PATH-resolved,
  and version-manager roots such as `~/.nvm/versions/node/*`), mirroring the
  locations the family's strategy chains already walk — so "what you can pick" and
  "what can be resolved" stay the same set.
- **ADD** per-member entry files on each candidate (`nodeEntry`, `npmEntry`,
  `npxEntry`) rather than a bare directory, matching the `pi-installs` precedent
  where a directory is illegal for the consumer.
- **ADD** a Settings → Developer options Node runtime picker that writes all three
  override keys from ONE selection via the existing atomic
  `registry.setOverrides()` (already built for the `pi` family's two-key fan-out,
  explicitly to avoid the two-write crash window).
- **ADD** family-coherence reporting: when the three resolve into different
  installations, the UI SHALL say so.
- **CHANGE** spawned-child PATH construction so children inherit the *selected*
  installation, not unconditionally the managed one.
- **FIX** `npmCliBesideNodeStrategy` to anchor on the resolved `node` via the peer
  seam built above, falling back to the injectable `execPath` seam — never a direct
  `process.execPath` read. Thread `deps` into the strategy (it is currently the only
  strategy in the file constructed without them) and route its existence probe through
  `deps.exists`.

## Design constraints

- **Partial families are legal.** On Debian/Ubuntu `nodejs` and `npm` are separate
  packages; a Node installation with no `npm` is a normal state. Enumeration MUST
  probe each member independently and surface a partial candidate rather than
  discarding it or synthesising a missing path.
- **Per-tool overrides remain.** Users deliberately mix (corepack, volta, pnpm
  shims). The picker is a convenience that writes the three keys; it MUST NOT
  remove the ability to set one member independently, and a hand-set member must
  be reported as a deviation rather than silently overwritten.
- **Consolidate policy, not lookup.** The selector decides *which installation
  wins*; per-binary existence probing and the per-tool `tried[]` diagnostic trail
  stay exactly as they are. The trail is the diagnostic surface that made the
  originating bug report tractable and must not be collapsed.
- **No spawning to probe versions.** Follow `pi-installs`' filesystem-only rule
  (`no pi --version is ever spawned`); read the version from the installation's
  own metadata.

## Open questions

- Does the family invariant justify its cost on correctness grounds alone? npm is
  broadly tolerant of being run by a mismatched `node`, so the strongest
  justification here is UX (a selector the user already expects) rather than
  observed breakage. If review disagrees, the honest fallback is to ship only
  `fix-node-family-resolution-gaps` and close this.
- Should version-manager enumeration cover only nvm, or also fnm/asdf/volta? Each
  added root is more surface to keep aligned with the strategy chains.
- Migration: existing `tool-overrides.json` files carry independent per-tool keys.
  Does the picker adopt a coherent existing trio as "selected", or start unset?
- Where does the peer-resolution binding live — `registerDefaultTools`, the registry
  constructor, or a factory? Binding inside `registerDefaultTools` gives every test
  caller a live `registry.resolve` unless it injects its own, which is hidden coupling
  that must be decided deliberately rather than fallen into.
- Post-fix, win32 `npm` starts following `node`'s **override**. A user who pins a
  `node` override at an installation lacking `node_modules/npm` shifts npm's
  resolution from execPath-anchored to override-anchored (miss → `where`). Intended,
  but currently undisclosed behaviour change — confirm it is wanted.

## Discipline Skills

- `doubt-driven-review` — this change introduces a new concept and a persisted
  selection; the "is the invariant load-bearing?" question above should be settled
  adversarially BEFORE the module lands, while reversal is still cheap.
- `code-simplification` — the win condition is fewer places expressing the family
  relationship, not more. If the selector lands and the four divergence sites remain
  independently expressible, the change failed its own goal.
- `review-code` — multi-package change (`shared`, `server`, `client`).
- `security-hardening` — the picker writes absolute paths that become spawn targets;
  validate that a selected entry is a file within the chosen root before persisting.
