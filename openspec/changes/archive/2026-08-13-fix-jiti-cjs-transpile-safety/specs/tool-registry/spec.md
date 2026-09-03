## ADDED Requirements

### Requirement: `defaultResolveModule` SHALL order its strategies `createRequire → dir-walk → ESM resolve`

`defaultResolveModule` — the default module resolver behind `bareImportStrategy`
— SHALL attempt resolution in this order, falling through on failure:

1. `createRequire(from).resolve(id)` — CJS resolver, `"require"` condition.
2. `resolvePackageEntryByDirWalk(id, from)` — filesystem walk for
   `node_modules/<id>/package.json`, entry derived from
   `exports["."]` (`"import"` / `"default"`) `?? module ?? main`.
3. `import.meta.resolve(id)` — ESM resolver, `"import"` condition, anchored at
   this module's URL. Only a `file:` result is accepted; anything else falls
   through to `null`.

The ESM step SHALL be **last**, and SHALL be understood as an **inert guard**:
retained for shape-correctness and defence in depth, not because it is expected
to fire. It is specified as unreachable-in-practice rather than as a live
fallback, and no requirement below depends on it producing a value.

Two independent facts make it unreachable today, both verified against source:

- **The dir-walk and the ESM step share an anchor.** The ESM step resolves
  against *this module's* `import.meta`, ignoring `from`; the dir-walk walks from
  `from`. They coincide because the **sole** production caller of
  `defaultResolveModule` — `bareImportStrategy` at `definitions.ts:290` — lets
  `anchor` default to `import.meta.url` (`strategies.ts:468`). Both steps
  therefore search the same `node_modules` chain from the same origin, and if the
  package is absent from that chain, both fail.
  (`definitions.ts:333` and `:697` also call something named `resolveModule`, but
  it is their own `createRequire` wrapper with no dir-walk and no ESM step — they
  never reach `defaultResolveModule`. An earlier draft cited them in support of
  this argument; they are irrelevant to it, and had they reached it they would
  have *broken* the shared anchor, since they pass `definitions.ts`'s
  `import.meta.url`.)
- **The dir-walk almost never returns `null`.**
  `readEntryFromPackageJson` computes
  `fromExports ?? json.module ?? json.main ?? "index.js"` (`strategies.ts:150`),
  so once the manifest is found the result is always a string and the following
  `typeof rel !== "string"` guard can never fire. The dir-walk yields `null` only
  for an unparseable manifest, a non-`file:` anchor, a package missing from the
  walk, or a package directory present **without** a `package.json`
  (`existsSync` at `strategies.ts:136` gates the read).

  Of those, only the first and third also defeat the ESM step. The requirement
  does **not** claim the ESM step fails in every case — an earlier draft did, and
  it was self-contradictory: the ESM step ignores `from`, so a non-`file:` anchor
  breaks the dir-walk while leaving the ESM step able to resolve. Likewise a
  package directory with no manifest resolves under Node's legacy index lookup
  but returns `null` from the dir-walk. Unreachability rests on the preconditions
  below, not on an exhaustive-failure claim.

Both facts are **contingent, not structural**, and the requirement records the
preconditions so a future change cannot silently void them:

- `bareImportStrategy` exports a public `anchor` parameter. A future caller
  passing a non-default anchor would make the dir-walk search that tree while the
  ESM step still searches this module's — the anchors diverge and unreachability
  no longer holds.
- The `from` anchor must be a valid `file:` URL. A non-`file:` anchor makes the
  dir-walk bail at `strategies.ts:119-123` while the ESM step, which ignores
  `from`, still resolves — the guard fires.
- The package must ship a `package.json`. A package directory without one is
  resolvable by Node's legacy index lookup but yields `null` from the dir-walk's
  `existsSync` gate — the guard fires.
- Unreachability holds for **bare package specifiers only**. For a subpath id
  (`pkg/sub`) the dir-walk's literal `node_modules/<id>/package.json` join does
  not exist, so it returns `null`, while `import.meta.resolve("pkg/sub")` can
  resolve a subpath export — a genuine case where the guard fires. Today every
  registered id is a bare package name, but this change's own reasoning leans on
  the registry being extensible, so the precondition is stated rather than
  assumed.

Any change that registers a subpath id, or passes a non-default `anchor`, SHALL
re-evaluate the inert-guard requirement and the preemption scenario below before
landing.

The order is therefore justified by **behaviour preservation**, not by capability:
the dir-walk already answers every step-1 miss in production today (the ESM step
has never executed, because this module is itself loaded through jiti's
`data:`-URL ESM fallback, where `import.meta.resolve` of a bare specifier throws
`ERR_UNSUPPORTED_RESOLVE_REQUEST`). Keeping the dir-walk ahead of the ESM step
preserves that exact behaviour. Placing the newly-repaired ESM step first would
hand every lookup to a resolver that has never run in production.

That caution is warranted because the two resolvers demonstrably disagree on
package shape: a package with no `exports` but a `module` field resolves to
`main` under ESM and to `module` under the dir-walk; a package whose
`exports["."]` nests `node` / `default` resolves to the `node` entry under ESM
and to the `default` entry under the dir-walk; a package whose `exports`
declares subpaths but no `"."` throws under ESM and resolves via `main` under
the dir-walk.

**Known pre-existing defect, deliberately not fixed here.** Because the entry
defaults to `"index.js"` with **no existence check**, the dir-walk can return a
path that is not on disk — specifically when a manifest declares neither a
usable `exports["."]`, nor `module`, nor `main`. (An earlier draft attributed
this to the `exports`-without-`"."` shape the current doc-comment cites; that is
imprecise — that shape falls through to `module ?? main` and usually resolves
correctly. The defect is the unchecked final fallback, not the missing `"."`.)
Correcting it changes live resolution behaviour and is out of scope for this
change, which is confined to making the module CJS-transpilable. It is recorded
so the next reader does not mistake the inert guard for its mitigation.

#### Scenario: No resolution that succeeds today changes value

- **GIVEN** any package that `defaultResolveModule` resolves to a path before
  this change
- **WHEN** `defaultResolveModule(id, from)` is called after the reorder
- **THEN** it SHALL return the identical path
- **AND** the assertion SHALL compare against paths captured from the
  pre-change chain, not against the post-change implementation's own output

#### Scenario: The inert ESM guard does not preempt a later strategy

- **GIVEN** `bareImportStrategy` runs ahead of `managedModuleStrategy` and
  `npmGlobalStrategy` in the chain assembled at `definitions.ts:290-292`
- **WHEN** `defaultResolveModule` returns a non-`null` path
- **THEN** `bareImportStrategy` SHALL report success and the managed-module and
  npm-global strategies SHALL NOT run
- **AND** therefore a `null` becoming a hit is NOT unconditionally an
  improvement — it suppresses strategies that would otherwise have been consulted
- **AND** because the ESM guard is unreachable (see above), this preemption
  SHALL NOT occur as a result of this change
- **AND** any future change that makes the ESM step reachable SHALL re-evaluate
  this scenario before landing

#### Scenario: Live registry packages resolve identically before and after

- **GIVEN** `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`, whose
  manifests expose `exports: { ".": { types, import } }` and therefore fail
  step 1
- **WHEN** `defaultResolveModule` is called for each
- **THEN** step 2 SHALL resolve `./dist/index.js` for both
- **AND** the resolved path SHALL equal the path resolved by the pre-change chain

#### Scenario: A throwing or non-`file:` ESM step is contained, not propagated

- **WHEN** step 3 throws, or returns a URL whose scheme is not `file:`
- **THEN** the error SHALL be caught at the call site
- **AND** `defaultResolveModule` SHALL return `null` to the caller
- **AND** SHALL NOT propagate the error
- **NOTE** the assertion of record is error containment; the `null` return is
  also the natural terminus of the chain, so a test that only asserts `null`
  would pass even if the guard were removed, and SHALL therefore assert that no
  exception escapes

### Requirement: The ESM step SHALL be written as a direct `import.meta.resolve(id)` call

Step 3 SHALL call `import.meta.resolve(id)` directly inside a `try`. It SHALL
NOT route the access through a TypeScript cast such as
`(import.meta as unknown as { resolve?: … }).resolve`, and SHALL NOT gate the
call behind a `typeof` probe.

The call shape is load-bearing, not stylistic: jiti erases `import.meta` only
when the member expression's `object.type` is `MetaProperty`. A cast makes it
`TSAsExpression`, the erasure is skipped, and the surviving `import.meta` forces
jiti's native-ESM fallback and its `data:` URL hand-off. See the
`jiti-cjs-transpile-safety` capability. Whether the property is *called* is
irrelevant — an uncalled `import.meta.resolve` is erased correctly; only the cast
defeats it.

A `typeof` probe is unnecessary because the surrounding `try` already routes a
missing or throwing resolver to the same `null` outcome. No workspace in this
repo declares an `engines` floor that guarantees `import.meta.resolve`
(`packages/shared` and `packages/extension` declare none; the repo root declares
`>=22.19.0 <27`), so the probe was never the thing providing safety — the
`catch` was.

The doc-comment at this call site SHALL record the constraint, and SHALL NOT
repeat two claims previously asserted there and since disproved: that the
synchronous `import.meta.resolve` cannot take a parent specifier (Node 20.6+
accepts a second argument; declining to pass `from` is a deliberate choice), and
that an engines floor of `>=22.12` applies.

#### Scenario: The module stays CJS-transpilable

- **WHEN** `strategies.ts` is passed through jiti's `transform()` in CommonJS mode
- **THEN** the emitted source SHALL contain `jitiESMResolve(`
- **AND** SHALL retain no `import.meta` in code position
- **AND** SHALL therefore not trigger jiti's native-ESM fallback

#### Scenario: Reintroducing the cast is caught

- **WHEN** the direct call is rewritten as a cast-wrapped member access
- **THEN** the `jiti-cjs-transpile-safety` gate SHALL fail naming this file
