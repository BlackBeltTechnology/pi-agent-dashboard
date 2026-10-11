# .pi/skills/rebuild-package-diagrams/scripts/ifml.mjs — index

UI model → IFML 1.0: `buildIfml(ui)` → `{elements, flows}` (Window/Form/fields/ValidationRule/events/ActivationExpression/Action/ActionEvent/NavigationFlow, trace per element), `ifmlToXmi` (XMI 2.5, ns `http://www.omg.org/spec/IFML/20140301`, flows owned by InteractionFlowModel, trace `Annotation`), `checkIfmlXmi` (vs `references/ifml-metamodel.json`; minimal tag scanner, no XML lib). See change: add-catalog-ifml. Dot-separated trace ids (`xid`), `ActivationExpression` nested in event, `layoutIfml` + `diagramXml` (IFML-DI), `withTrace` opt-in annotations, editor `ifmlIds` aliases; `parseIfmlXmi` (uml:name, element-valued primitives via `foldPrimitive`, entity decode `xmlUnesc`); checker skips DI except `modelElement`. See change: add-ifml-render-roundtrip.

`ifmlIdErrors(ui)`: ids/keys outside `[A-Za-z0-9_-]` refused by `ifml`, `ifml-parts`, `ifml-diff` (xid lossy otherwise). PR #817 review.
