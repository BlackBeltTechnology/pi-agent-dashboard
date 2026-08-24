# Vendored assets

Every bundle below is pinned to an **exact** version — never a range — with a
content hash and licence. Two vendoring forms are used, per design decision D1.

- **Browser bundles** are the published pre-built artifacts, copied verbatim and
  hash-compared whole-file against the upstream distribution.
- **The Node pipeline** is a *single self-contained ESM module* bundled at
  vendoring time by `scripts/vendor.mjs`. It is a build output, so its **inputs**
  are hash-recorded (the published `dist/index.js` of each closure package)
  rather than the output being compared to a published file.

**Minimum host Node version: `20.12`** — the strictest `engines.node` in the
closure, declared by `bpmn-moddle` and `saxen`. (`bpmn-auto-layout` and
`moddle-xml` declare `>= 18`; `moddle` and `min-dash` declare none.)

Regenerate with `node scripts/vendor.mjs --rebuild`; verify with
`node scripts/vendor.mjs`. After any re-vendor, run `node scripts/fixtures.mjs`
and record the result before accepting the upgrade (upstream drift detector).

## Browser bundles (published artifacts, whole-file hash-compared)

| package | version | licence | file | sha256 |
|---|---|---|---|---|
| `bpmn-js` | 18.24.0 | bpmn.io License | `assets/bpmn-js/bpmn-navigated-viewer.production.min.js` | `e815dba42e3864eafc1621fab15e9c22e8ebcd07cf1e89650a9ca4ad2fe45f49` |
| `dmn-js` | 17.10.1 | bpmn.io License | `assets/dmn-js/dmn-viewer.production.min.js` | `0e3e4504b17bad6b570b93441807d4b322a1e10b33452b80497177499a8d72b9` |

Accompanying stylesheets and icon fonts are copied from the same package at the
same version: `assets/bpmn-js/{diagram-js.css,bpmn.css,bpmn-font/}` and
`assets/dmn-js/{diagram-js.css,dmn-js-shared.css,dmn-js-drd.css,dmn-js-decision-table.css,dmn-js-literal-expression.css,dmn-font/}`.

The **watermark-rendering source** lives inside the two `*.production.min.js`
bundles above; the whole-file hash match is the guarantee it is byte-identical to
upstream (bpmn.io License requirement, and viewer spec "Watermark source is
unmodified").

## Node pipeline (self-contained bundle — INPUTS hash-recorded)

Bundled output: `assets/lib/bpmn-pipeline.mjs` (exports `layoutProcess`,
`BpmnModdle`). Build tool: `esbuild@0.24.0`
(`--bundle --format=esm --platform=node --target=node20.12`).

| package | version | licence | input file | input sha256 |
|---|---|---|---|---|
| `bpmn-auto-layout` | 1.3.0 | MIT | `bpmn-auto-layout/dist/index.js` | `1443e3f710c45db7bf4cdcfcb960fe48a5e0cae8214a1451deca5784424e211e` |
| `bpmn-moddle` | 10.1.0 | MIT | `bpmn-moddle/dist/index.js` | `ece57e2fae965e1372cfb21b983fba06818c318ad0d35b6b8b8b6da2e27a0c9b` |
| `moddle` | 8.2.1 | MIT | `moddle/dist/index.js` | `fc20cb48373cf2a6e09143492626dbc77efb8d8e3660a9e132b5bc9dcb7a558c` |
| `moddle-xml` | 12.1.0 | MIT | `moddle-xml/dist/index.js` | `35480f3eb2f0baf57d1f07e812ae47b65df68217e273b427ed07f2d442e7da14` |
| `min-dash` | 5.1.0 | MIT | `min-dash/dist/index.js` | `0eacee75abc8df5349304a6c1a7377f3d36142cb182cbb95c2227ca8a3349a7c` |
| `saxen` | 11.1.1 | MIT | `saxen/dist/index.js` | `6303cae8a9787409db5671c958897ec8e5a3bf9e26f4b490c760b4d6d4257279` |

The closure parses BPMN and generic XML but carries **no DMN semantic parser**,
so DMN reference checks are structural only (XML namespace + `<decision>` count +
DRD-DI presence), never a semantic or rendering validation.

### YAML parser (self-contained bundle — INPUT hash-recorded)

Bundled output: `assets/lib/yaml.mjs` (exports `parse`, `parseDocument`,
`Document`). Used to parse `package.yaml` with **duplicate-key detection**
(`uniqueKeys: true` → `DUPLICATE_KEY` error). Same esbuild invocation, plus a
`createRequire` banner so the CJS closure's `require('process')` resolves under
ESM.

| package | version | licence | input file | input sha256 |
|---|---|---|---|---|
| `yaml` | 2.9.0 | ISC | `yaml/dist/index.js` | `2d58984e0ae80de4acbd8f009fab332f5ce77d9e1a5f138a3058a0ada6567fb9` |

## Licences

- **bpmn.io License** (`bpmn-js`, `dmn-js`): reproduced verbatim in
  `assets/LICENSE.bpmn-io.txt`. Grants free use; requires the bpmn.io watermark
  linking to https://bpmn.io to stay unmodified and fully visible, not visually
  overlapped.
- **MIT** (`bpmn-auto-layout`, `bpmn-moddle`, `moddle`, `moddle-xml`, `min-dash`,
  `saxen`).
- **ISC** (`yaml`).
- **Apache 2.0** — OpenForms schema contract, attributed when a form renders
  (`assets/openforms/`, populated once `add-openforms-mui-skill` ships its
  standalone IIFE build).

## Total payload

Approximately **1.4 MB** resident in `assets/`. The bundles exist **once** on
disk; generated packages symlink the shared asset root into their render root
(viewer spec "Single-origin serving"), so no bundle is duplicated per package.

## No version ranges

Every version above is exact. There is no `^`, `~`, `*` or range specifier in
this manifest or in `scripts/vendor.mjs` `PINS`.
