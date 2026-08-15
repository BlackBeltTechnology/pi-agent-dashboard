# Licensing obligations

Two licences apply to a rendered package. Both are satisfiable simultaneously.

## bpmn.io License — `bpmn-js` and `dmn-js`

The vendored viewers are distributed under the **bpmn.io License** (full text in
`assets/LICENSE.bpmn-io.txt`). It grants free use with one condition beyond plain
MIT:

> The source code responsible for displaying the bpmn.io project watermark that
> links back to https://bpmn.io as part of rendered diagrams MUST NOT be removed
> or changed. When this software is being used in a website or application, the
> watermark must stay fully visible and not visually overlapped by other
> elements.

This is an **acceptance criterion**, not a note:

- The watermark renders at `position:absolute; bottom:15px; right:15px` inside
  **every** mount that draws one — the `bpmn-js` canvas **and** the `dmn-js`
  decision-table view (which injects the logo at `table.before`).
- The viewer shell reserves the **lower-right** region of the main canvas and of
  the side panel, so no toolbar, switcher, legend, diagnostics region, panel
  chrome or form content overlaps a watermark. Overlays are `pointer-events`
  transparent and positioned top / bottom-left, never bottom-right.
- At narrow viewports the panel **replaces** the canvas rather than overlaying
  it, so only one watermark-bearing mount is shown at a time — a permitted swap,
  not a prohibited hiding.
- The vendored `*.production.min.js` bundles are byte-identical to the published
  artifacts (whole-file hash in `assets/VENDORED.md`), so the watermark-rendering
  source is unmodified.

Attribution ("Diagrams by bpmn.io", linking to https://bpmn.io) is rendered in
the shell footer, clear of every watermark region.

## Apache 2.0 — OpenForms schema contract

The optional form renderer (OpenForms) is Apache 2.0. When a form actually
renders, the shell shows an OpenForms attribution alongside the bpmn.io footer.
Until the standalone renderer is vendored (`assets/openforms/`), `kind: form`
bindings render a placeholder and no OpenForms attribution is shown.

## MIT / ISC — the Node pipeline

`bpmn-auto-layout`, `bpmn-moddle`, `moddle`, `moddle-xml`, `min-dash` and `saxen`
are MIT; the `yaml` parser is ISC. These run only at generation/validation time
and render no watermark. Versions, hashes and licences are in
`assets/VENDORED.md`.
