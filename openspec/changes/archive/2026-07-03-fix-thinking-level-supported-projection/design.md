# Design

## Decision: inline pi's `getSupportedThinkingLevels` rule instead of the old projection

The bridge must produce the same "supported levels" set that pi core uses to
clamp thinking level (`clampThinkingLevel` → `getSupportedThinkingLevels`).
Re-deriving it with a *different* rule (the old allowlist filter) is what caused
the divergence. The fix reproduces pi's exact rule as a local pure helper.

Why not import pi's function directly? No pi-ai import path type-checks under the
repo's tsconfig:

- pi-ai ships `.d.ts` files that re-export via explicit `.ts` extensions
  (`export * from "./models.ts"`, and `/compat` uses `export * from "./index.ts"`).
  Following a `.ts` extension requires `allowImportingTsExtensions`, which the
  base tsconfig does not set (and cannot set globally without breaking the
  declaration emit for package builds). So the project `tsc` sees **none** of
  pi-ai's main-entry exports (`TS2305` for `getSupportedThinkingLevels`, and even
  for `getProviders`/`Type`).
- The `/compat` subpath only exists in 0.80+, not the pinned devDep 0.75.5
  (`TS2307`), and its `.d.ts` hits the same `.ts`-barrel trap anyway.

The rule is a tiny, stable pure function; inlining it (with the contract pinned
in this spec) is lower-risk than a global tsconfig change or a dependency bump.

```ts
// packages/extension/src/provider-register.ts
const EXTENDED_THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh"] as const;

function deriveSupportedThinkingLevels(
  reasoning: boolean,
  thinkingLevelMap: Record<string, unknown> | null | undefined,
): string[] {
  if (!reasoning) return ["off"];
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh") return mapped !== undefined;
    return true;
  });
}
```

## `thinkingLevelMap` contract (why the old projection was wrong)

`thinkingLevelMap` is a **sparse override**, not an allowlist:

| map entry | meaning |
|-----------|---------|
| key absent | level supported by default (reasoning models) |
| key → string | level supported, remapped to a vendor value |
| key → `null` | level explicitly disabled |
| `xhigh` | special: supported only if the key is present (any non-null value) |

pi's rule:

```
!reasoning                → ["off"]
reasoning                 → keep every EXTENDED level unless map[level] === null,
                            except xhigh which needs map[xhigh] !== undefined
```

Old dashboard rule (`Object.entries(map).filter(v !== null)`) enumerates only the
**declared** keys — correct only for a dense map, wrong for sparse maps (Opus).

## Fallback / undefined semantics

`supportedThinkingLevels` stays **optional**. The client's `ThinkingLevelSelector`
renders all six canonical levels when the field is `undefined` or empty. To
preserve that fallback for pre-0.72 pi (models with neither `reasoning` nor
`thinkingLevelMap`), `toModelInfo` emits the field only when the model exposes
thinking metadata; otherwise it omits it. Rationale: forcing `["off"]` on a model
whose metadata is simply unknown would over-restrict; the existing "show all"
fallback is the safer default there.

## Non-goals

- No change to the persisted thinking level or to pi's clamp behavior (pi is
  correct). No re-clamp on model switch is added — pi already does that.
- No change to the `set_thinking_level` / `model_update` protocol or to the
  two-surface propagation requirement.
- No UI redesign of the trigger label. Once the dropdown is correct, `high`
  becomes a member of the supported set and the perceived inconsistency is gone.

## Edge cases / test matrix

| model metadata | expected `supportedThinkingLevels` |
|----------------|-------------------------------------|
| `reasoning:true, map:{ xhigh:"xhigh" }` (Opus) | `[off, minimal, low, medium, high, xhigh]` |
| `reasoning:true, map:{ medium, high, xhigh:null }` | `[off, minimal, low, medium, high]` |
| `reasoning:false` | `[off]` |
| `reasoning:true`, no map | `[off, minimal, low, medium, high]` (xhigh excluded — needs an explicit map entry) |
| no reasoning flag, no map (pre-0.72) | `undefined` → client shows all six |
