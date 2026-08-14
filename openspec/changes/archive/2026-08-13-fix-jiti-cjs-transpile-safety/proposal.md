## Why

[Issue #408](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/408):
with the bridge installed, **every** start of a Bun single-file host
(`bun build --compile`) dies before the agent runs:

```
ResolveMessage: NameTooLong while resolving package
'data:text/javascript;base64,ZXhwb3J0IGRlZmF1bHQgKGFzeW5jIGZ1bmN0aW9uIChleHBvcnRzLCByZXF1aXJlLCBtb2R1bGUs…'
from '/$bunfs/root/pi-pbt'
```

Extension-load failure is fatal, so the host cannot start at all without `-ne` —
which disables the bridge, losing dashboard visibility for exactly the unattended
runs (git-hook campaigns, watch daemons) worth observing.

### Mechanism (verified, not inferred)

jiti transpiles TS to **CommonJS** and evaluates it in a `vm` function wrapper.
Only when that throws a **`SyntaxError`** does jiti fall back to native ESM,
which it performs by base64-encoding the module into a `data:text/javascript`
specifier. Raw `import.meta` in a CJS wrapper is such a `SyntaxError`.

jiti's babel plugin erases `import.meta`, but the erasure is **defeated by a
TypeScript cast** — the discriminator is the cast, not whether the property is
called. Measured against jiti's real `transform()`:

| Source shape | jiti emits | Raw `import.meta` left? |
|---|---|---|
| `import.meta.url` | inlined `"file:///…"` literal | no |
| `import.meta.resolve(id)` | `jitiESMResolve(id)` | no |
| `const m = import.meta.resolve` (uncalled) | `jitiESMResolve` | no |
| `(import.meta as any).env` | `process.env` | no |
| **`(import.meta as unknown as {…}).resolve`** | **`import.meta.resolve`** | **yes** |

The cast changes the member expression's `object.type` from `MetaProperty` to
`TSAsExpression`, so jiti's visitor never matches. Exactly one file in the repo
hits this in code position:
`packages/shared/src/tool-registry/strategies.ts:87`.

Corroboration, each checked by hand:

- The issue's payload prefix decodes to
  `export default (async function (exports, require, module,` — jiti's
  **ESM-fallback wrapper**, not an ordinary transpile.
- The reporter's decoded payload contains `bareImportStrategy` /
  `managedRuntimeStrategy` — it *is* `strategies.ts`.
- Reachability: `bridge.ts` → `command-handler.ts` (also `process-scanner.ts`)
  → `shared/tool-registry/index.js` → `strategies.ts`.
- Node accepts a `data:` specifier; Bun's compiled-binary resolver treats it as a
  package name against the embedded filesystem, and a ~10 KB "name" exceeds the
  filename limit. jiti *has* an oversized-payload guard, but it keys on
  `err.code === "ENAMETOOLONG"` and Bun throws a `ResolveMessage` with no such
  `code`, so it misses.

### The non-obvious part: step 2 has never run

`defaultResolveModule` resolves in three steps — `createRequire` → ESM
`import.meta.resolve` → filesystem dir-walk. **Step 2 has never produced a value
in production.** Because `strategies.ts` is itself loaded through the data:-URL
ESM path, its `import.meta.resolve` has no file base:

```
data:-URL module → import.meta.resolve("acorn") → ERR_UNSUPPORTED_RESOLVE_REQUEST   (Node v24)
```

So step 3 has silently carried the entire load since both steps landed together
in `43a730368`. Naively "fixing" the cast would therefore **switch step 2 on for
the first time**, ahead of the step that actually works — a behaviour change in
the code path that finds pi itself.

Worse, the existing suite cannot see it. Under vitest `import.meta.resolve`
exists but throws, so step 2 stays dead before *and* after the fix — "tests still
green" would be a **vacuous signal** (cf. the repo's `detect-vacuous-perf-test`
skill).

The two resolvers genuinely disagree on package shape (measured against fixture
`node_modules` trees):

| Package shape | step 2 (ESM) | step 3 (dir-walk) |
|---|---|---|
| no `exports`, has `module` + `main` | `main.js` | `mod-field.js` |
| `exports["."]` with nested `node` / `default` | `node-esm.js` | `browser.js` |
| `exports` with subpaths only, no `"."` | throws `ERR_PACKAGE_PATH_NOT_EXPORTED` | `main.js` |

For **today's** registry the disagreement is dormant: steps 2–3 run only when
`createRequire` fails, which in the live set is just
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` — both
`exports: { ".": { types, import } }`, on which both resolvers land on
`./dist/index.js`. That coincidence is a property of two manifests, not a
guarantee, and the registry is extensible.

## What Changes

**A — Fix the cast *and* demote the ESM step to last (order `1 → 3 → 2`), where
it is an inert guard.** `defaultResolveModule` calls `import.meta.resolve(id)`
directly (no cast, no `typeof` probe), and the ESM step runs **after** the
dir-walk. It fixes #408 (the `import.meta` is erased) without landing an
unverifiable resolution change in the path that finds pi.

The justification is **behaviour preservation, not added capability.** The
dir-walk already answers every step-1 miss in production today, because the ESM
step has never executed. Keeping it ahead preserves that exact behaviour;
promoting the newly-repaired ESM step would hand every lookup to a resolver that
has never run.

> **Corrected in doubt cycle 2.** An earlier draft justified this order as
> "monotonic by construction — the newly-live ESM step can only turn a `null`
> into a hit." Both halves were wrong. **(i)** In last position the ESM step is
> not merely safe, it is **unreachable**: `bareImportStrategy` anchors it and the
> dir-walk at the same URL (`strategies.ts:468`; the sole production caller of
> `defaultResolveModule` is `definitions.ts:290`), while
> `readEntryFromPackageJson` returns a string for every
> manifest it can parse (`strategies.ts:150` — the following `typeof` guard can
> never fire). The dir-walk therefore answers whenever the package exists, and
> when it does not, the ESM step fails on the same chain. **(ii)** "A `null`
> becoming a hit" is not unconditionally an improvement: `bareImportStrategy`
> runs *ahead of* `managedModuleStrategy` and `npmGlobalStrategy`
> (`definitions.ts:290-292`), so a new hit **suppresses** strategies that would
> otherwise have been consulted. The property was also asserted at the wrong
> layer — resolver-level, where it is a short-circuit tautology, rather than
> chain-level, where it has content.
>
> The order stands; its rationale and its spec scenarios were rewritten. The
> ESM step is now specified as an **inert guard**, and the scenario claiming it
> "recovers a case the dir-walk cannot" — along with the task requiring someone
> to demonstrate that recovery — has been deleted as unfalsifiable. A new test
> (2.3a) asserts the opposite: the ESM step is called **zero** times.

The step-ordering doc-comment is rewritten to explain the inversion and *why the
obvious order is the dangerous one*, so a later reader does not "restore" it.
It must also record that preservation holds **because step 2 was already dead**,
and a pre-existing defect this change does *not* fix: the dir-walk's entry falls
back to `"index.js"` with no existence check, so it can return a path that is not
on disk.
Two factual errors in that comment are corrected at the same time: it claims the
synchronous `import.meta.resolve` "does not take a parent specifier" (Node 20.6+
has the 2-arg form; not passing `from` is a deliberate choice, not an API limit),
and it cites an engines floor that does not exist.

**B — A repo-lint gate so the cast cannot come back.** A vitest guard walks the
jiti-loaded source set, runs jiti's real `transform()` over each file, and fails
on any module retaining `import.meta` **in code position**. Detection is
**AST-level, not textual** — verified necessary: transform output preserves
comments *and* string literals, so a substring check false-positives on
`packages/extension/src/model-tracker.ts:143`,
`packages/server/src/changelog/changelog-fs.ts:103,120` — which use
`import.meta` in **code** position in jiti-*erasable* shapes — and on any string
containing the token. Scope is a **derived
rule** — source directories loaded by jiti at runtime — not a hardcoded
workspace list, with explicit exclusions for Vite-only client code and build
output (`packages/electron/out` is gitignored, present after a local build, and
contains `.tsx` that legitimately retains `import.meta`).

The rule is derived from **package manifests plus one import walk**, seeded three
ways — and the criterion is *evaluated by jiti*, not *executed from source*:

1. **`pi.extensions` `.ts` entries.** Four, not one: `packages/extension`
   (`src/bridge.ts`), `packages/image-fit-extension`, `packages/kb-extension`,
   `packages/mockup-loop` (each `src/extension.ts`). `packages/mockup-loop`
   already uses `import.meta.url`, benign only because that shape is erasable.
2. **The dashboard server itself.** `packages/server` declares
   `main: src/cli.ts`, and `bin/pi-dashboard.mjs` re-execs Node with
   `--import <jiti-url> cli.ts` — so all of `packages/server/src/**` is
   jiti-evaluated. No `bin`-keyed limb can find it, because `bin` is the `.mjs`
   wrapper.
3. **`pi-dashboard-plugin` `server` / `bridge` `.ts` entries** — twelve across
   ten workspaces. `loader.ts:442` loads them with
   `await import(plugin.serverEntryPath)` over glob-discovered paths, so no
   static specifier exists and no walk can reach them.

The transitive walk (following `import` **and** `require`) then pulls in
`packages/dashboard-plugin-runtime/src/server/` — from seed 2, since
`packages/server/src/server.ts` imports it; the bridge has no edge to it.

Raw-`.ts` `bin` entries are **excluded**: each carries `#!/usr/bin/env node` and
runs under Node's native type-stripping as ESM, so there is no CJS wrapper and
the fault class cannot arise. Verified by executing the exact cast-wrapped shape
under `node` directly.

**C — Document the host-side escape hatch.** `JITI_ESM_EVAL_TEMP_FILE=1` in
`docs/faq.md`, keyed on the symptoms a user actually has: the `NameTooLong` /
`data:text/javascript` text **and** the bare `SyntaxError` variant — jiti's ESM
fallback is async-only, so on a sync load path the same defect surfaces as a
plain syntax error with no `NameTooLong` to search for.

### Explicitly rejected

**Shipping compiled `dist/*.js` from `packages/shared`** (the issue's fix 1).

To be accurate about it: this **would** fix #408. An earlier draft of this
proposal argued it would not, on the grounds that `packages/extension` publishes
`pi.extensions: ["src/bridge.ts"]` and so a Bun host transpiles bridge source
regardless. That argument is **wrong and is withdrawn** — `bridge.ts`'s own
`import.meta.url` is erasable, so a precompiled `shared` removes the only
offending module from the graph.

It is rejected on scope, not efficacy: it reverses a repo-wide invariant (every
workspace ships raw `.ts` with its exports map pointed at source; "no build step
— the server runs TypeScript via jiti" is documented architecture relied on by
the reload/restart workflow and the plugin-authoring contract), to fix a defect
whose actual cause is one line. The startup-cost case for precompiled output is
real and deserves its own change with its own blast-radius analysis — not a rider
on this one.

**Activating step 2 ahead of the dir-walk** was considered and rejected: it is
the only variant that can change an existing resolution, and no available test
can prove it does not. Making it honest would require a jiti-loaded integration
harness larger than the fix itself.

### Deferred

**An upstream jiti PR** teaching the `ENAMETOOLONG` fallback to also recognise
Bun's `ResolveMessage` / `NameTooLong`. It would fix every consumer, but it is
external and nothing here depends on it.

## Capabilities

### New Capabilities

- `jiti-cjs-transpile-safety`: no first-party TypeScript reachable from a
  jiti-loaded entry point may transpile to a module retaining `import.meta` in
  code position, because that forces jiti's native-ESM fallback and its `data:`
  URL hand-off — fatal on hosts whose resolver rejects `data:` specifiers.
  Carries the property, the AST-level gate that enforces it, and the documented
  host-side escape hatch.

### Modified Capabilities

- `tool-registry`: gains a requirement pinning `defaultResolveModule`'s strategy
  order to `createRequire → dir-walk → ESM resolve` and its ESM step to a direct
  `import.meta.resolve(id)` call. The capability currently says nothing about
  this resolver's internal steps. The contract is **behaviour preservation**:
  every package that resolves today resolves to the identical path, because the
  dir-walk — which already answers every step-1 miss in production — keeps its
  position ahead of the ESM step. The ESM step is specified as an **inert
  guard**, unreachable for the bare specifiers the registry actually uses.
  (An earlier draft made *monotonicity* the contract; see corrections 6–8.)

## Impact

- `packages/shared/src/tool-registry/strategies.ts` — reorder
  `defaultResolveModule` to `1 → 3 → 2`; direct `import.meta.resolve(id)` call;
  drop the `metaResolve` binding and `typeof` guard; rewrite the ordering
  doc-comment (incl. the two factual corrections above).
- `scripts/__tests__/` — new AST-level guard (B), alongside the existing
  workspace-wide manifest guards.
- `docs/faq.md` — the `JITI_ESM_EVAL_TEMP_FILE=1` entry (C), via DocScribe.
- `packages/shared/src/tool-registry/AGENTS.md` — `strategies.ts` purpose row
  gains `See change: fix-jiti-cjs-transpile-safety`.
- **Not changed:** `packages/shared/package.json` exports map and `files` list,
  the no-build-step architecture, every other workspace's published shape.

### Correction of record

Facts asserted in the first draft and since disproved, kept visible so the
verification trail is auditable:

1. "Behaviour is preserved" — false for the naive fix; step 2 is currently dead
   and would have gone live. Motivated the `1 → 3 → 2` reorder.
2. "engines floor `>=22.12`" — actual root engines is `>=22.19.0 <27`;
   `packages/shared` and `packages/extension` declare **none**.
3. "jiti erases a **called** `import.meta.resolve`" — an uncalled
   `import.meta.resolve` is erased too; the cast is the discriminator.
4. "dist wouldn't close the issue because the extension ships `bridge.ts`" —
   wrong; withdrawn above.
5. "existing tests staying green proves behaviour preservation" — vacuous; step 2
   is dead under vitest either way.

Added in doubt cycle 2 — claims made in the **second** draft and since disproved:

6. "The reorder is monotonic by construction; the newly-live ESM step can only
   turn a `null` into a hit." — In last position the ESM step is **unreachable**,
   not merely safe (shared anchor + a dir-walk that returns non-`null` for any
   parseable manifest). The order is justified by behaviour preservation instead.
7. "A `null` becoming a hit is never a regression." — `bareImportStrategy`
   precedes `managedModuleStrategy` / `npmGlobalStrategy`
   (`definitions.ts:290-292`), so a new hit suppresses later strategies. The
   property was also asserted at the resolver layer, where it is a short-circuit
   tautology, rather than at the chain layer where it has content.
8. "The ESM step recovers a case the dir-walk cannot." — No such case exists for
   a real installed package. The scenario and its task are deleted; a test now
   asserts the ESM step is invoked **zero** times.
9. Gate scope named one `pi.extensions` entry point. — There are **four**
   (`extension`, `image-fit-extension`, `kb-extension`, `mockup-loop`), plus a
   raw-`.ts` `bin` in `dashboard-plugin-skill` that no bridge-side package
   imports.

Added in doubt cycle 3 — claims made in the **third** draft and since disproved:

10. "`packages/dashboard-plugin-skill` is the raw-`.ts` `bin`." — There are
    **five** (`apple-tools`, `dashboard-plugin-skill`, `nano-banana`,
    `video-production`, `video-transcription`). This reproduced, in the `bin`
    limb, the exact undercounting that correction 9 had just fixed in the
    `pi.extensions` limb — evidence that enumerations written by hand decay even
    when the author has just been burned by one. The gate now derives and asserts
    the set.
11. "`model-tracker.ts` and `changelog-fs.ts` mention `import.meta` in comments
    only." — False, and asserted since the original 31-file sweep. All three
    occurrences (`model-tracker.ts:143`, `changelog-fs.ts:103`, `:120`) are in
    **code** position; they are green because jiti *erases* those shapes. They
    prove the erasure limb of the gate, not the comment limb.
12. "Every production call site passes `undefined` or `import.meta.url`
    (`definitions.ts:290`, `:333`, `:697`)." — `:333`/`:697` call their own
    `createRequire` wrapper and never reach `defaultResolveModule`. The citation
    was not merely surplus but self-undermining: those sites pass
    `definitions.ts`'s `import.meta.url`, so had they reached it they would have
    broken the shared-anchor claim.
13. Unreachability was stated as structural. — It is **contingent** on two
    preconditions now recorded in the spec and pinned by task 2.3b: bare (not
    subpath) specifiers, and the default `anchor`. A subpath id makes the dir-walk
    return `null` while `import.meta.resolve` succeeds — a real case where the
    guard fires.

Added in doubt cycle 4 — claims made in the **fourth** draft and since disproved:

14. Gate scope covered only the extension graph. — It missed
    `packages/server/src/**` (jiti-bootstrapped via `main: src/cli.ts`),
    `packages/dashboard-plugin-runtime/src/server/**`, and **twelve**
    `pi-dashboard-plugin` `server`/`bridge` entries loaded by dynamic `import()`
    at `loader.ts:442`. The gate would have left the majority of jiti-loaded
    first-party TypeScript unguarded — under-delivering on the capability's own
    wording.
15. "`dashboard-plugin-runtime/src/server/` is reached by the walk from
    `packages/extension/src/bridge.ts`." — False. The bridge has no edge to it;
    it is reached from `packages/server/src/server.ts`, a different process the
    rule never seeded.
16. "Raw-`.ts` `bin` entries are transpiled by the host, so the same fault class
    applies." — **Disproved by execution.** All five carry `#!/usr/bin/env node`
    and run under native type-stripping as ESM; a `.ts` file containing the exact
    cast runs cleanly under `node`. No CJS wrapper, no `SyntaxError`, no `data:`
    URL. The limb is dropped.
17. The erasure scenarios were vacuous. — They assert
    `packages/server/src/changelog/changelog-fs.ts` "SHALL NOT be reported", but
    under the previous scope rule the gate never opened that file. Cycle 3 fixed
    the *label* on this scenario; the scenario was broken one level deeper.
    Fixed by seed 2.

One cycle-2 recommendation was **rejected** rather than applied — and the
rejection was **wrong**. Reviewer 2 proposed excluding
`packages/dashboard-plugin-skill` as unreachable from the bridge graph. I
overrode it, reasoning that its raw-`.ts` `bin` is "transpiled at runtime and
carries the same fault class." Cycle 4 disproved that by execution (correction
16): native type-stripping, no jiti, no fault. The reviewer's conclusion was
correct and my override rested on reasoning I had not tested. Recorded because
the failure mode — overriding a correct finding with plausible untested
mechanism — is more instructive than the finding itself.

The original text of that rejection follows for the record: reviewer 2
proposed excluding `packages/dashboard-plugin-skill` as unreachable from the
bridge graph. Verified true as to reachability — but its `bin` is raw TypeScript
executed from source, so it is transpiled at runtime and carries the same fault
class. Excluding it would have reopened the bug the gate exists to close.

### Open question for the reporter

Ask #408 to confirm `JITI_ESM_EVAL_TEMP_FILE=1` unblocks their existing binary.
Green corroborates the ESM-fallback diagnosis on real Bun. Red is **not** proof
of a second `data:`-URL producer — it could equally be jiti-version drift, a
read-only `os.tmpdir()` inside the compiled binary, or a non-jiti transpiler in
their host — so a red result reopens investigation rather than redirecting it.

## Discipline Skills

`doubt-driven-review` (**cycles 1–4 complete** — cycle 1: step 2 is dead, 8
corrections; cycle 2: the ESM step is unreachable, voiding the monotonicity
contract; cycle 3: the raw-`.ts`-bin undercount, the false "comment-only" label,
a self-undermining citation — corrections 10–13; cycle 4: the gate missed
`packages/server/src`, the plugin `server`/`bridge` entries and the runtime, the
bin limb rested on an untested premise, and the erasure scenarios were vacuous —
corrections 14–17. **Every cycle found defects in text the previous cycle had
just written**, including two cases where a fix introduced a new instance of the
very class it was fixing. The structural response is that the gate now *derives
and asserts* each seed set rather than restating hand-written enumerations; a
cycle 5 is warranted only if these artifacts are substantially rewritten again) ·
`systematic-debugging` (if the reporter's probe comes back red) ·
`scenario-design` (`test-plan.md` — behaviour preservation, the inert-guard
preconditions, the gate's fails-closed proof, and the three divergence shapes) ·
`review-code` (before commit).
