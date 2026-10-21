# DOX — openspec/changes/add-access-provisioning/mockups

Static proposed board for change `add-access-provisioning` (task 3.1): `ProvisionPromptDialog` and the Access-page provisioning rows. Open `index.html`. No app code touched.

| File | Purpose |
|---|---|
| `AGENTS.md` | Per-file record for this dir. See change: add-access-provisioning. |
| `icons.js` | `ICON` map from `@mdi/js`. Copied from `improve-canvas-html-and-url-ux` plus 7 appended glyphs. See change: add-access-provisioning. |
| `index.html` | Board shell + inline renderers. Sections S0 line classes, S1 dialog 6 lines, S2 dialog 32 lines, S3 dialog remote only, S4 Access answerable, S5 Access read-only, S6 provisioned label + notices. Theme (base dark / base light / nord dark) and frame (375 / 768 / full) toolbar; query params `theme`, `width`. Defines `window.__probeMock()`. See change: add-access-provisioning. |
| `mockup.css` | Base reset, `.pill`, `.seg` recipes. Copied unchanged. See change: add-access-provisioning. |
| `probe.js` | Contrast + size probe, defines `window.__probeRoot`. Copied unchanged. See change: add-access-provisioning. |
| `prov.css` | Proposed recipes `dlg*`, `ln`, `pt`, `goal`, `csq`, `card`, `row`, `banner`, `tag`. Tokens only, no colour literal. Container queries. See change: add-access-provisioning. |
| `tokens.css` | Theme tokens (base dark, base light, nord dark). Copied unchanged. See change: add-access-provisioning. |
| `ui-plan.md` | Mode preserve, profile product-ui. Grounding, surface to token to state map, proposed copy, probe results, rubric, open questions. See change: add-access-provisioning. |
