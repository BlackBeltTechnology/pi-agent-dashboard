# DOX — packages/deck3d/src/runtime

Browser runtime, bundled by esbuild into `dist/runtime.js` and inlined into `deck.html`. See change: add-deck3d-presentation-package.

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `index.ts` | Bundle entry + engine. Reads `window.__DECK` (merged IR) + `window.__DECK_FONT` (base64 TTF); builds one `THREE.Group` per slide (title/slab/diagram/background), rail camera + dolly/swing/fade transitions, hash deep-link (1-based, clamped), rAF loop with `setTimeout` fallback on `document.hidden`. Exposes `window.__deck3d` (`gotoSlide`, `setTime`, `ready`, `measure`, `peaks`, `effects`, `debug.titleGlyphs`, `current`). Deterministic clock when `setTime` is used. |
| `types.ts` | `RuntimeDeck`/`SlideConfig`/`Deck3dApi`/`Measurement` + `window.__DECK`/`__DECK_FONT`/`__deck3d` global augmentation. |
| `palette.ts` | `PALETTES` (blackbelt/zenit/dapp) + `resolvePalette` (mode-aware; `custom` derives bg/text from the card colour). |
| `quality.ts` | `qualityProfile(low|medium|high)` → `{ bloom, mirror, shadowMapSize, particles }` (D6). |
| `materials.ts` | `diagramMaterial` (glass/metal/matte; accent vs second) + `titleMaterial`. |
| `text.ts` | `loadFont` (opentype parse from base64), `ttfShapes`, `wrap`, `buildTitle` (extruded, reports missing glyphs), `buildLabel` (canvas plane, `P.bg` outline, `toneMapped:false`), `bulletTexture`. Real TTF only — no corrupt `typeface.json` fallback. |
| `node-geometry.ts` | `nodeGeometry(shape, w, h)` → three.js primitive (rect/stadium/round/circle/doublecircle/diamond/hexagon/cylinder). |
| `builders.ts` | `buildDiagram` dispatch. `buildFlowchart` (layout → staircase, tubes, arrow-heads, group plates, node overrides), `buildSequence` (actor slabs, time staircase, `1.1 s` message pulse), `buildBrain`/`buildLoop`/`buildSwarm`. Returns `{ g, tick, nodes, labels }`. |
| `backgrounds.ts` | Scene library `tokens`/`rings`/`swarm`/`particles` (+ `backgroundFor`); deterministic seeded RNG. |
| `camera.ts` | `anchorFor(i)` rail anchor (40-unit spacing) + `CULL_RADIUS` (52). |
| `scene.ts` | `createSceneRig`: renderer (ACES tone map), scene, camera, `EffectComposer` (bloom pass only when the quality profile enables it), RoomEnvironment PMREM, key/fill/rim lights, ONE global floor (Reflector mirror + radial-alpha veil), `applyLook` (mode-aware bloom/fog/lights/shadows), `render`/`resize`/`updateFloor`. |
| `rng.ts` | Deterministic LCG so no scene layout uses `Math.random`. |
