# add-deck3d-presentation-package

## Why

Our slide decks today are flat PPTX built by hand-rolled python-pptx scripts. The explore-mode strategy lab (`openspec/changes/add-deck3d-presentation-package/mockup/deck3d-strategy-lab.html`) proved that the same markdown slide source can become a cinematic, self-contained 3D deck — extruded Hungarian titles, PBR materials, mirror floor, slide-reactive background scenes, and Mermaid `flowchart` / `sequenceDiagram` blocks lifted into animated 3D objects — without writing a parser or layout engine of our own. That knowledge lives only in one 800-line mockup and this session; it needs a home as a reusable, deterministic package.

The user's key constraint shapes the design: **the converter must be deterministic code shipped with the skill, but the LLM must keep room to fine-tune the converted result.** Neither a pure LLM ("write me three.js") nor a black-box CLI ("here is your HTML, take it or leave it") satisfies that.

## What Changes

- **New workspace package `packages/deck3d`** — `@blackbelt-technology/pi-dashboard-deck3d`. Publishable pi package with a `deck3d` CLI and a `deck3d` skill (same shape as `packages/video-production`: TypeScript engine + `pi.skills` + bin).
- **Two-stage, IR-in-the-middle pipeline.** The deterministic engine never goes markdown → HTML in one leap:
  1. `deck3d parse <deck.md> -o deck.json` — markdown slides (+ ```mermaid blocks, harvested at build time in headless chromium) → a documented **Deck IR** (`deck.json`): slides, palette, per-slide `diagram` (graph IR: nodes/edges/groups with layout), background-scene choice, camera rail, per-slide overrides.
  2. `deck3d render deck.json -o deck.html` — Deck IR → single self-contained HTML (three.js + subset Poppins TTF + assets as base64). Same IR ⇒ byte-identical HTML.
- **The LLM's tuning surface is the IR, not the code.** The skill instructs the agent to run `parse`, then *edit `deck.json`* (rename a scene, pin a camera, swap a node shape, move a label, adjust depth relief, override palette/mode per slide, reword a diagram label the harvest got wrong), then `render`. Every IR field is JSON-schema validated (`deck3d validate`), so a bad edit fails loud before rendering. `parse` is re-runnable: user-edited fields live under `overrides` and survive a re-parse (same mechanism the lab persists to `localStorage` today).
- **Deterministic engine contents** (ported from the lab, tested): markdown slide grammar → slide IR; Mermaid harvest (`diagram.db` semantics + rendered-SVG dagre layout → graph IR, v11 id scheme pinned); 3D builders — flowchart (shape → primitive, edge → tube + pulse, subgraph → glass plate, rank → depth relief), sequence (actors, time-as-depth staircase, ordered message lighting), and the three built topologies (`brain`, `loop`, `swarm`); background scene library keyed by slide semantics; Poppins TTF → opentype.js → ExtrudeGeometry for titles, canvas-with-inverted-outline labels for diagram text; `document.hidden`-tolerant render loop.
- **Skill `deck3d`** — when to use, the parse → inspect/tune IR → render → screenshot-verify loop, the IR field reference (what each knob does visually), and pitfalls (mermaid harvest needs a browser; typeface.json fonts corrupt `ő ű`; bloom threshold vs label glow).
- **Content-related 3D props.** Slides and diagram nodes can be illustrated with reusable glTF models. Division of labour follows the same rule: the **LLM searches and picks** (`deck3d props search <keywords>` lists candidates with thumbnail, licence, triangle count, size from Poly Pizza's API and a vendored CC0 Kenney/Quaternius subset; fallback `deck3d props generate --from-image` via the free Hunyuan3D‑2 HF space), then writes the choice into `overrides` (source, id, licence, sha256, role `hero|illustration|ambient|node:<id>`, `restyle: palette|original`, animation preset). **Code fetches, caches, hash-pins, normalises scale/grounding, restyles to the deck palette, animates and base64-embeds** — and auto-generates a credits slide for CC‑BY props. `render` refuses a prop whose cached hash ≠ IR, so output stays byte-identical and offline.
- **Machine-checked fit and legibility.** `deck3d check` opens the rendered deck headless and measures the scene graph (not pixels) per slide and viewport: content inside a safe margin, label height ≥ 14 px, no label overlap, no occlusion, ≥ 3:1 contrast — at rest and at animation peaks. Each finding names the object and the `overrides` key that fixes it, so the LLM tunes from a report, not by squinting at screenshots. `build` runs it; `--strict` gates.
- **Runtime-only viewer, build-time browser.** Output HTML loads no mermaid.js and hits no network. Mermaid harvesting uses the already-present Playwright/agent-browser chromium.
- Existing PPTX pipelines untouched; deck3d sits alongside them as an alternative target for the same markdown slide source.

## Capabilities

### New Capabilities
- `deck3d-ir`: the Deck IR contract — `deck.json` schema, `parse` determinism, `overrides` survival across re-parse, `validate` failure modes. This is the LLM's tuning surface.
- `deck3d-mermaid-harvest`: converting ```mermaid `flowchart` and `sequenceDiagram` blocks to graph IR — semantics from `diagram.db`, layout from the rendered SVG, supported shape/edge vocabulary, unsupported-diagram fallback.
- `deck3d-render`: IR → self-contained HTML — determinism, offline/self-containment, 3D builder mapping (shape → primitive, edge → tube), Hungarian glyph guarantee, label legibility, hidden-tab render loop.
- `deck3d-props`: reusable 3D models as content-related illustrations — search/generate CLI, IR placement contract, hash-pinned cache, normalisation + palette restyle, placement roles incl. replacing a diagram node, licence credits.
- `deck3d-skill`: the pi skill + CLI surface — commands, exit codes, the tune loop the agent follows.

### Modified Capabilities
- (none — no existing spec's requirements change)

## Impact

- **New:** `packages/deck3d/` (src, `.pi/skills/deck3d/`, `bin/deck3d`, fixtures, vitest), workspace + release wiring (`pnpm-workspace.yaml` already globs `packages/*`; Release workflow publishes every non-private workspace).
- **Deps:** `three` (pinned), `opentype.js`, `mermaid@11` (build-time only, pinned — id scheme `<renderId>-flowchart-<id>-<n>` is version-sensitive), `ajv` for IR validation, `playwright` reuse for the headless harvest, `three/examples` `GLTFLoader` + `meshoptimizer`/Draco decoder for props. Network at `props search|fetch|generate` time only: Poly Pizza REST (free key, `POLY_PIZZA_KEY`), HF Space `tencent/Hunyuan3D-2` via `gradio_client` (python3, optional). Vendored `assets/props/` CC0 subset (Kenney/Quaternius) with a manifest. Poppins-Bold TTF vendored under OFL and subset at render time.
- **Docs:** `packages/deck3d/AGENTS.md` + `README.md`, row in `packages/AGENTS.md`, `docs/architecture.md` pointer. `openspec/changes/add-deck3d-presentation-package/mockup/deck3d-strategy-lab.html` is retired once the package reproduces its slides (its `deck.json` export becomes the first fixture).
- **No server/client/extension code is touched.**

## Discipline Skills

- **`scenario-design`** — fixture decks per diagram type / palette / mode; edge cases: unsupported mermaid type, empty subgraph, label with `ő ű`, re-parse after override, hidden-tab render.
- **`doubt-driven-review`** — the IR schema is a public contract the skill teaches agents to edit; get its shape (where `overrides` live, what is stable vs derived) right before it stands.
- **`review-code`** — standard pre-commit pass on a non-trivial change.
- **`security-hardening`** — `props fetch` downloads third-party binaries from URLs the LLM chose: hash pinning, size caps, glTF-only, no script/extension execution, path-safe cache names.
- Not triggered: `security-hardening` for the markdown→HTML core (author-owned input, static offline output), `performance-optimization` (no latency budget; `--quality` flag is a rendering knob, not a measured regression), `observability-instrumentation` (CLI, no runtime service).
