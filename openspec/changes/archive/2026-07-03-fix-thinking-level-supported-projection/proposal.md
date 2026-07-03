# Fix thinking-level supported-projection (sparse `thinkingLevelMap` misread)

## Why

The dashboard's thinking-level dropdown under-reports the levels a reasoning
model supports. For every frontier Opus model (`claude-opus-4-5/4-6/4-7/4-8`),
whose catalog metadata is `reasoning: true` + `thinkingLevelMap: { xhigh: … }`,
the dropdown renders **only `xhigh`**, while pi itself considers `off, minimal,
low, medium, high, xhigh` all valid. The status-bar trigger correctly shows the
session's live level (e.g. `high`) — but that level is absent from the dropdown,
so it looks un-selectable and the picker can only ever move the user to `xhigh`.

Root cause: `toModelInfo` in the bridge treats `thinkingLevelMap` as an
**allowlist** (keep only keys present with a non-null value):

```ts
Object.entries(map).filter(([, v]) => v !== null).map(([k]) => k)
```

But pi's contract is a **sparse override table**, implemented by
`getSupportedThinkingLevels` in `@earendil-works/pi-ai`:

```ts
if (!model.reasoning) return ["off"];
return EXTENDED_THINKING_LEVELS.filter((level) => {
  const mapped = model.thinkingLevelMap?.[level];
  if (mapped === null) return false;              // key present + null → disabled
  if (level === "xhigh") return mapped !== undefined; // xhigh only if declared
  return true;                                    // unmentioned level → supported
});
```

The dashboard projection only agrees with pi when the map densely lists every
level (the archived example `{ medium, high, xhigh: null }`). For a sparse map it
drops the implicitly-supported levels, and for a non-reasoning model it wrongly
falls through to "all six" instead of `["off"]`.

Because pi never clamps `high` on Opus (it is genuinely supported), the session
holds `thinkingLevel: "high"`; the dashboard's own dropdown is the only wrong
surface. This is a dashboard bug, not a pi bug and not a stale-persist bug.

## What Changes

- **Bridge `toModelInfo` (`packages/extension/src/provider-register.ts`)**:
  replace the hand-rolled `Object.entries(map).filter(v !== null)` projection
  with a local `deriveSupportedThinkingLevels` helper that mirrors pi's canonical
  `getSupportedThinkingLevels` rule verbatim, so `supportedThinkingLevels` is
  derived by the same sparse-override contract pi core uses to clamp.
  The rule is inlined rather than imported: pi-ai ships `.d.ts` files that
  re-export via explicit `.ts` extensions (`export * from "./models.ts"`), which
  the repo's base tsconfig (no `allowImportingTsExtensions`) cannot follow — so no
  pi-ai import path (main entry or `/compat`, 0.75.5 or 0.80.x) resolves the
  symbol at type-check. The spec pins the contract; the helper is a tiny stable
  pure function.
- **Spec `model-selector` — "Thinking-level selector filters per model"**:
  restate the projection rule to match pi's sparse-override semantics, and fix
  the scenarios (sparse reasoning map → all-but-disabled; non-reasoning → `off`).

No client-side change: `ThinkingLevelSelector` already renders exactly
`supportedThinkingLevels` (canonical order preserved), so correcting the source
array is sufficient. No protocol change: `ModelInfo.supportedThinkingLevels`
keeps its shape.

## Impact

- Affected spec: `model-selector` (one requirement modified).
- Affected code: `packages/extension/src/provider-register.ts` (`toModelInfo`).
- Behavior: Opus dropdown shows `off, minimal, low, medium, high, xhigh`; the
  live `high` becomes selectable; non-reasoning models correctly show only `off`.
- Risk: low. Local pure helper, no new dependency, no pi-ai import (avoids the
  `.ts`-extension-barrel resolution trap in pi-ai's shipped `.d.ts`). Requires
  reload of connected pi sessions to re-emit `models_list` with the corrected
  projection.
