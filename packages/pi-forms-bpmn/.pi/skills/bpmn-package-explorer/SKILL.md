---
name: bpmn-package-explorer
description: >-
  Generate, validate and view BPMN 2.0 process packages from a prose
  description, and render existing .bpmn / .dmn files. Turns a described
  business process into plain vendor-neutral BPMN semantics, auto-lays it out
  with a verifying layout guard (never emits a corrupt diagram), wires
  decisions (.dmn), forms (.form) and sub-processes through a sidecar
  package.yaml manifest, and serves a buildless offline bpmn-js / dmn-js viewer
  on the canvas. Use when the user wants to "model a business process", "make a
  BPMN diagram", "generate a process from this description", "draw the workflow",
  "view / open a .bpmn or .dmn file", "build a decision table", or asks in
  Hungarian to "csinálj egy folyamatábrát", "rajzold meg a folyamatot",
  "BPMN ábra", "folyamat modellezés", "döntési tábla", "nézd meg ezt a .bpmn
  fájlt", "folyamatcsomag".
---

# BPMN Package Explorer

Generate and view BPMN 2.0 process **packages**: a process plus the decisions its
rule tasks evaluate, the forms its user tasks present, and a manifest binding
them — kept as plain, vendor-neutral BPMN 2.0. **Buildless and offline**: it
vendors pre-built viewers and a self-contained Node layout bundle; generating or
rendering a package needs no `npm install`, no bundler and no network. Requires
**Node ≥ 20.12** and a browser.

## When to use

Model a business process from a prose description; make/view a BPMN diagram or a
DMN decision table; build a cross-linked process package. Hungarian triggers:
„csinálj egy folyamatábrát”, „rajzold meg a folyamatot”, „döntési tábla”,
„nézd meg ezt a .bpmn fájlt”.

## The two guarantees

- **Never a corrupt diagram.** A language model can author correct BPMN
  *semantics* but not a readable coordinate set. `bpmn-auto-layout` fills that
  gap but **fails silently** on sub-processes, pools and lanes (all outputs stay
  schema-valid). A **layout guard** verifies every laid-out diagram against its
  own semantics and **aborts** on any corruption, in strict mode.
- **Vendor-neutral.** The `.bpmn`/`.dmn`/`.form` files carry no engine
  extension. A sidecar `package.yaml` holds the link graph (`bindings`, `roles`),
  so a package opens in Camunda Modeler, Signavio or any conformant tool.

## Generation workflow

The agent authors the artifacts (guided by the references); the pipeline runs the
mechanical steps, each failing loudly:

1. **Author semantics** — one or more semantics-only `.bpmn` (no geometry),
   applying the authoring envelope and identifier rules. Emit
   `<bpmn:incoming>`/`<bpmn:outgoing>` on every connected flow node.
2. **Author artifacts** — the `.dmn` decisions and `.form` schemas.
3. **Write `package.yaml`** — the `bindings` and `roles`.
4. **Validate the manifest** — `node scripts/generate-cli.mjs <packageDir>`
   runs the envelope check, manifest validation, layout + guard, and assembles a
   render root; it **stops before serving** on any error.
5. **Serve + canvas** — serve the printed render-root path with `serve_mockup`
   and open the URL on the canvas (never `file://`).

## Display / view workflow

- Package: `node scripts/generate-cli.mjs <packageDir>` → `serve_mockup` →
  `canvas`.
- Standalone file (no manifest): `node scripts/view-cli.mjs <file.bpmn|.dmn>`.
  A file with DI renders as authored; a semantics-only `.bpmn` is laid out into a
  **separate** render artifact (the source is never overwritten). A DI-less file
  containing a rejected construct is refused with that construct's diagnostic.

## Canvas / sandboxed-iframe rendering (if the viewer shows blank)

The dashboard opens a loopback `canvas(kind:"url")` target inside a
`sandbox="allow-scripts"` iframe with **no `allow-same-origin`** (opaque origin),
proxied under `/live/<id>/`. The vendored bpmn-js / dmn-js viewers are buildless
and offline, so they usually render fine — but if the canvas comes up **blank**
or **404s**, it is almost always one of these, not a viewer bug:

- **Absolute asset paths.** Anything the served page references with a
  leading-slash path (`/vendor/...`, `/main.js`) resolves to the dashboard root
  under the `/live/<id>/` prefix → 404. Keep every path in the render root
  **relative** (`./vendor/...`). Serve the render root with `serve_mockup` (never
  `file://`) and open the returned URL on the canvas.
- **ES-module `<script type="module">` without CORS.** In the opaque-origin
  iframe a module is fetched with `Origin: null`, so the server must send
  `Access-Control-Allow-Origin: *` or the module is blocked. The vendored viewers
  use classic scripts to avoid this; if you add a module entry, the static server
  must set CORS headers.
- **Self-verify** by iframing your served render root with
  `sandbox="allow-scripts"` and screenshotting before trusting the canvas — that
  reproduces the exact dashboard sandbox.

Full rationale, the CORS static-server pattern, and adjacent pitfalls (IPv6-only
dev binds → `ECONNREFUSED`, `kill %1` not persisting across tool calls) are in
the **`canvas-webapp`** skill (bundled with the pi-dashboard extension).

## Rejected constructs → manifest substitutions

Inline `subProcess` → `callActivity` + separate `.bpmn` + `kind: process`
(drill-down). Pools (`collaboration`) → one `.bpmn` per participant +
`kind: participant` (switcher). `laneSet` → manifest `roles` (markers + legend).
`messageFlow` → unrepresentable (rejected). ≥2 boundary events on one activity →
rejected. See `references/authoring-envelope.md`.

## Verify the toolchain

- `node scripts/fixtures.mjs` — layout regression suite (catches upstream drift).
- `node scripts/selftest.mjs` — envelope / identifier / manifest / guard /
  workflow unit tests.
- `node scripts/vendor.mjs` — verify vendored bundle hashes
  (`--rebuild` re-vendors from pinned inputs).

## References

- `references/authoring-envelope.md` — generation contract + rejected constructs.
- `references/identifiers.md` — deterministic ids, Hungarian deburring,
  uniqueness errors, authoring-vs-ingestion.
- `references/package-manifest.md` — the `package.yaml` contract, reconciliation.
- `references/layout-envelope.md` — the measured fixtures and outcomes.
- `references/licensing.md` — the bpmn.io watermark obligation and Apache 2.0.
- `assets/VENDORED.md` — pinned versions, hashes, the Node floor (20.12).
