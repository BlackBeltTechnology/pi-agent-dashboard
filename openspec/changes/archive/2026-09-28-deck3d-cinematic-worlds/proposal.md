# deck3d-cinematic-worlds

## Why

The first real deck built with `deck3d` (`presentations/business-next-5-years/`, 23 slides) shipped flat: 17 slides on the parser's `particles` fallback, zero props, no built 3D object on any non-mermaid slide, no way to step through slides, and no on-screen controls. The original strategy-lab mockup (`openspec/changes/archive/2026-09-18-add-deck3d-presentation-package/mockup/`) promised topic-reactive backgrounds, built topologies (`brain`/`loop`/`swarm`) on ordinary slides, and a `⚙` configurator — the package ported the code but left three of them unreachable and de-scoped the fourth. The skill's tune loop also never forces a styling pass, so an agent can declare a deck "clean" while it is visually bare.

The governing constraint stays: **deterministic converter, LLM tunes the result.** This change adds one new deterministic lever — an LLM-authored, hash-pinned, per-deck effect module embedded at render — so topic-specific visuals no longer depend on the corpus having anticipated the topic.

## What Changes

- **Built diagrams become reachable.** `overrides.slides["<id>"].diagram.kind` accepts a built topology (`brain`, `loop`, `swarm` + new business set `bars`, `funnel`, `timeline-rail`, `globe`, `orbit-cluster`, `stack`) and optional `data` (labels/values). `parse` assigns a built kind from a deterministic keyword table when a content slide has no mermaid block. Today the three builders in `runtime/builders.ts` are dead code.
- **Local effects (`fx/` beside `deck.md`).** An ES module per effect implementing the corpus factory `(ctx, params) → { object?, tick?, dispose }` plus a sibling `.meta.json` card. Referenced as `{ id: "local:<name>", sha256, params? }` in `overrides.slides[].effects`. `render` inlines the source (escaped) and refuses on hash mismatch / missing file (same rule as props; verification is render-time, `check` measures the output). The corpus `FxContext` grows to `{ THREE, palette, mode, quality, rng, slide }` for corpus and local effects alike. Local modules run with non-deterministic and I/O globals **shadowed** (`Math.random`→`ctx.rng`, `Date`/timers/`fetch`/DOM → `undefined`) and `check` blocks + reports any network request the deck attempts, so "offline + deterministic" is measured, not assumed. `fx scaffold`, `fx hash`, `fx preview` (accepts `local:` ids), `fx promote --source <url> --licence <spdx>`.
- **Topic-world backgrounds in the corpus.** New background effects with real 3D scenery, not only cubes and points: `globe-arcs`, `city-grid`, `neural-mesh`, `vault-glyphs`, `server-racks`, `market-tape`, `orbit-agents`, `paper-stack`. Meta cards gain a new `tags.topic[]` list (`ai`, `agents`, `geo`, `trust`, `security`, `compute`, `data`, `money`, `work`, `timeline`, `sales`, `process`) — existing `content` tags untouched — and `parse` defaults route by topic, so a bare build already varies per section. `overrides.deck.autoStyle: false` (or front-matter `autoStyle: false`) restores the v1 fallback routing for decks that must not change.
- **Palettes.** Add `midnight`, `ember`, `arctic`, `forest`, `mono`, `neon` (dark + light variants) beside `blackbelt`/`zenit`/`dapp`/`custom`.
- **Background-world props.** `props search --role ambient` filters for low-triangle, silhouette-friendly models and prints an `ambient` entry with `count` + `anim: float`; `props generate --prompt <text>` adds a text path to the existing Hunyuan3D fallback via a free text-to-image hop (optional dep, exits non-zero with install hint when absent).
- **Live navigation** — keyboard (`ArrowRight`/`ArrowLeft`/`Space`/`Home`/`End`), click-to-advance, live `hashchange`, hash kept in sync. Implements the existing `deck3d-render` "Navigation and slide model" requirement, which shipped unimplemented. (Code already on the tree, folded here.)
- **Authoring server (`deck3d serve`).** Watches `deck.md` + `fx/` + `deck.json`, rebuilds on change, and live-reloads the open browser onto the slide the author was already on. The configurator gains **Save** (writes `overrides.json` beside the deck) and **Apply to deck** (merges into `deck.json` under the `overrides apply` grammar), closing the export round trip: the download path alone is unreliable, since a sandboxed iframe without `allow-downloads` drops it silently. `--check` runs the fit check per rebuild out of band and surfaces findings in the panel. Authoring-only: `build` output stays self-contained and offline.
- **On-deck configurator (re-scopes a v1 non-goal).** Lab-style `⚙` panel hidden by default (`C` key / gear button): slide counter, deck scope + this-slide scope, mode, palette, quality, transition, effects toggle list, autoplay; overridden controls marked; **Export `overrides.json`** downloads the live overrides for the agent to merge. Runtime-only state; never mutates the embedded IR.
- **Skill: mandatory Style pass.** The tune loop gains step 4 "Style": for every slide choose a corpus effect *or* scaffold a local one, pick a built diagram for content slides without mermaid, run `props search` per section (`hero`, `illustration`, `ambient`). `check --style` warns on any slide that still runs on parse defaults only; `build` prints the style summary.
- Fixture: `presentations/business-next-5-years/` is restyled with the new machinery and becomes the package's second fixture deck.

## Capabilities

### New Capabilities
- `deck3d-serve`: authoring server — watch/rebuild, position-preserving live reload, configurator write-back to `overrides.json` / `deck.json`, optional out-of-band check findings. Loopback-only because it writes files.
- `deck3d-local-effects`: LLM-authored per-deck effect modules — file layout, `local:` id grammar, hash pinning, sandbox rules, scaffold/preview/promote CLI, render embedding, determinism guarantee.
- `deck3d-configurator`: the on-deck `⚙` panel — visibility, scopes, controls, export format, no-IR-mutation invariant, keyboard shortcut.

### Modified Capabilities
- `deck3d-ir`: `overrides.slides[].diagram.kind` + `diagram.data` (atomic replace — a named exception to object deep-merge); `defaults.palette` enum grows; `defaults.autoStyle`; `overrides.slides[].effects[]` / `overrides.effects[]` accept `local:` ids with `sha256`; "Overrides survive re-parse" gains the mermaid-wins-over-`diagram.kind` scenario and the `overrides apply` merge scenario; "IR is schema-validated" gains local-effect referent checks (file, hash, card, kind, size).
- `deck3d-render`: "Navigation and slide model" gains click, live `hashchange`, clamping, hash sync, HUD-focus suppression; "Diagram builders map IR to 3D" lists the six new topologies; "Browser fit-and-legibility check" gains `style-defaults`, `local-fx-error`, `local-fx-network` findings and their byte-equality class; "Render is deterministic and self-contained" gains the local-effect embedding scenario; "Build runs check" prints the style summary line.
- `deck3d-effects`: "Effect corpus with metadata cards" — `FxContext` grows (`rng`, `slide`), cards gain `tags.topic[]`, `source` admits the literal `local`; "v1 corpus content" grows (topic-world backgrounds); "Deterministic defaults, agent overrides" routes content slides by topic with `autoStyle` opt-out (title and diagram slides keep v1 routing); "Composition rules and budget" — local cards enter conflict/mode/budget gating; "Generated catalogue with previews" — `fx preview` accepts `local:` and `--palette`; "Corpus contribution procedure" gains `fx promote`.
- `deck3d-props`: "Prop search lists candidates" — `--role ambient`; "Generate fallback" — `--prompt`.
- `deck3d-skill`: "CLI commands" enumeration grows (`fx scaffold|hash|promote`, `overrides apply`, `check --style`, `props search --role`, `props generate --prompt`); "Skill teaches the tune loop" gains the mandatory Style pass.

## Impact

- `packages/deck3d/src/runtime/` (index navigation + configurator UI, builders for new topologies, palette table), `src/fx/` (new corpus modules + cards, local-effect loader), `src/ir/schema.json` + `types.ts`, `src/parse/` (built-kind + topic defaults), `src/render/` (embed local fx, configurator template), `src/check/` (`--style`), `src/props/` (ambient filter, prompt path), `src/cli.ts`, `.pi/skills/deck3d/SKILL.md` + `reference/`.
- Deps: none new for core. `props generate --prompt` optional python path only.
- Behaviour change for existing decks: `validate` is unaffected. Render changes only for slides that (a) fall to the `particles` fallback today and carry no `effects` override, or (b) are `content` slides without a supported mermaid block that match the built-kind table and carry no `diagram.kind` override (a slide tuned only via `diagram.scale`/`offset` gains a built object). `overrides.deck.autoStyle: false` restores v1 for both.
- Output size: configurator HTML/CSS ≈ +15 KB; each local effect adds its own bytes — counted in the existing build budget.
- New: `packages/deck3d/src/serve/` (watch server, SSE, write endpoints). Node built-ins only (`node:http`, `node:fs.watch`) — no new deps.
- `deck3d serve` binds loopback only and writes files under the served deck's directory; see `## Discipline Skills`.
- No dashboard server/client/extension code touched. (The dashboard's `LiveServerViewer` lacking `allow-downloads` is filed separately.)

## Discipline Skills

- **`scenario-design`** — local effect hash mismatch, sandbox token rejection, built-kind on a slide that later gains mermaid, configurator export round-trip, navigation clamping, topic default routing.
- **`security-hardening`** — `deck3d serve` accepts browser-driven filesystem WRITES: loopback-only bind, path confinement to the served deck's directory, IR validation before any write, no partial write on rejection. Also: local effects are LLM-written JS embedded into the deck: token blocklist, no `import`/network/DOM, hash pin, size cap; configurator export must not leak file paths.
- **`doubt-driven-review`** — the `local:` id + sandbox contract and the configurator export format are public surfaces the skill teaches agents to use.
- **`review-code`** — non-trivial change.
- Not triggered: `performance-optimization` (cost budget already bounds effects; no measured regression), `observability-instrumentation` (CLI + static output).
