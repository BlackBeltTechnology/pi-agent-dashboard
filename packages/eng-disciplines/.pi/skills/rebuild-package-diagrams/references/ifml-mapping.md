# UI model → IFML 1.0 mapping

Target: OMG Interaction Flow Modeling Language 1.0 (formal/2015-02-05), namespace
`http://www.omg.org/spec/IFML/20140301`, serialized as XMI 2.5 (`http://www.omg.org/spec/XMI/20131001`).
Implemented by `scripts/ifml.mjs` (`buildIfml`, `ifmlToXmi`, `checkIfmlXmi`).

| UI model | IFML element | Owner / feature |
|---|---|---|
| screen record (`SCR-*`, `DLG-*`) | `Window` (`isModal` = kind `modal`, `isLandmark` = kind `route`) | `InteractionFlowModel.interactionFlowModelElements` |
| screen `dialogs[]` (modal, alert, confirm, prompt) | `Window` `isModal=true` | `InteractionFlowModel.interactionFlowModelElements` |
| `forms[].form` (form record) | `Form` | `Window.viewElements` |
| template `fields[]` of a screen | `Form` "<screen> fields" | `Window.viewElements` |
| field `type: select` / other | `SelectionField` / `SimpleField` | `Form.viewComponentParts` |
| field validation condition | `ValidationRule` (`language` javascript, `body` = condition) | `Element.constraints` |
| action with a `validate` effect on a screen with a form | `OnSubmitEvent` | first `Form.viewElementEvents` |
| other action | `ViewElementEvent` | `Window.viewElementEvents` |
| action `guards[]` | `ActivationExpression` (`body` = guard ids joined by AND) | nested in the event as `activationExpression` (IFML-tooling form; OMG declares the feature as a reference) |
| action with effects | `Action` + `ActionEvent` "done"; effect steps in the trace annotation | `Window.actions`, `Action.actionEvents` |
| event → action | `NavigationFlow` | `InteractionFlowModel.interactionFlowModelElements` |
| dialog `from` action | `NavigationFlow` from the action's `ActionEvent` (or event) to the dialog `Window` | same |
| screen `navigation[].to` (known record) | `NavigationFlow` Window → Window | same |
| trace | dot-separated `xmi:id`: `W.<screen>`, `F.<screen>.<form>`, `P.<screen>.<form>.<field>`, `VR.<screen>.<form>.<field>.<n>`, `E`/`A`/`AE`/`X.<screen>.<action>` | — (`Annotation`s opt-in: `ifmlToXmi(…, {withTrace: true})`; IFML editors draw them as shapes) |

Flows are owned by the `InteractionFlowModel` (an `InteractionFlow` is an
`InteractionFlowModelElement`), the placement IFML tooling reads. `NavigationFlow` has no name:
`InteractionFlow` is not a `NamedElement` in IFML 1.0.

Not mapped (no source in the UI model): `DataFlow`/`ParameterBinding` (field ↔ domain
binding), `DomainModel`, `List`/`Details` components.

## Diagram geometry (IFML-DI)

`layoutIfml` places screens in a left column (forms with field rows inside, events as 20×20
circles on the form/window border), guards in a gap column, actions (with their `done`
`ActionEvent` on the right border) in a column aligned to their event, opened dialogs in a
right column; connections are orthogonal. Serialized as `ifmldi:IFMLDiagram` with nested
`IFMLNode` (`dc:Bounds`) and `IFMLConnection` (`dc:Point` waypoints), namespaces
`http://www.omg.org/spec/IFML/20130218/IFML-DI` and `http://www.omg.org/spec/DD/20100524/DC`.

## Reverse and round-trip

- `parseIfmlXmi` reads any producer's XMI: names as `name` or `uml:name`, primitive features as
  attributes or child elements (`<body>…</body>`, `<isModal>true</isModal>`), XML character
  references decoded, DI and annotations ignored.
- `graphToUi` (`ifml-to-ui`): windows → screen records (childless windows reached from an
  action's `done` event → that screen's dialogs), forms/fields → form records or template
  fields, events → actions (`OnSubmitEvent` → a `validate` effect, target `Action` → a `call`
  effect, nested guard → `guards`), window→window flows → navigation. Ids from the trace ids,
  else from names; editor ids kept per screen in `ifmlIds` so a re-export reuses them.
- `ifml-diff` compares element by element (type, name, owner, `body`, `isModal`, `isLandmark`)
  and flows by endpoints. `--apply` merges additions, renames, guard and validation changes;
  never deletes; an imported stand-alone window whose id is an existing dialog is that dialog.
- Field types other than selection are not carried by IFML: an imported field is `text`.


## Metamodel reference

`ifml-metamodel.json` = classes of the normative OMG file
`https://www.omg.org/spec/IFML/20140301/IFML-Metamodel.xmi` (ptc/14-03-16): per class
`abstract`, `supers`, `features {type, many, composite}`. Extracted once by reading each
`packagedElement xmi:type="uml:Class"` with its `generalization/general` and
`ownedAttribute` (`name`, `type`, `upperValue`, `aggregation`). `check-ifml` validates
against it: known concrete metaclass, feature declared on the class or a superclass, child
class conforms to the feature type, reference ids resolve, single-valued features not
repeated.

## Interoperability (checked 2026-10-06)

- `ifml-moddle` 0.3.1 / `ifml-js` 0.3.0 (engine of ifml.io and the VS Code ifml-io extension):
  a 39-screen pilot export imports with 0 warnings and renders (173 shapes). Re-saved unchanged
  by the `ifml-js` modeler it diffs as "no differences" (regression fixture
  `src/__tests__/fixtures/ifml-js-modeler-resave.xmi`); a modeler edit (rename an action,
  delete an event) diffs as exactly that.
- Deviation from strict OMG XMI, chosen for tooling: `activationExpression` is serialized as a
  nested element (OMG: non-composite reference), because IFML tooling crashes on the reference
  form. `check-ifml` accepts both.
