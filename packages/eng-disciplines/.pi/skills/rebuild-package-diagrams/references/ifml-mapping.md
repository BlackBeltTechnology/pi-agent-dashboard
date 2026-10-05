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
| action `guards[]` | `ActivationExpression` (`body` = guard ids joined by AND); referenced by `Event.activationExpression` | `InteractionFlowModel.interactionFlowModelElements` |
| action with effects | `Action` + `ActionEvent` "done"; effect steps in the trace annotation | `Window.actions`, `Action.actionEvents` |
| event → action | `NavigationFlow` | `InteractionFlowModel.interactionFlowModelElements` |
| dialog `from` action | `NavigationFlow` from the action's `ActionEvent` (or event) to the dialog `Window` | same |
| screen `navigation[].to` (known record) | `NavigationFlow` Window → Window | same |
| trace (screen, action, form, field, dialog, steps, message) | `Annotation.text` `trace: SCR#ACT …` | `Element.annotations` |

Flows are owned by the `InteractionFlowModel` (an `InteractionFlow` is an
`InteractionFlowModelElement`), the placement IFML tooling reads. `NavigationFlow` has no name:
`InteractionFlow` is not a `NamedElement` in IFML 1.0.

Not mapped (no source in the UI model): `DataFlow`/`ParameterBinding` (field ↔ domain
binding), `DomainModel`, IFML-DI diagram geometry, `List`/`Details` components.

## Metamodel reference

`ifml-metamodel.json` = classes of the normative OMG file
`https://www.omg.org/spec/IFML/20140301/IFML-Metamodel.xmi` (ptc/14-03-16): per class
`abstract`, `supers`, `features {type, many, composite}`. Extracted once by reading each
`packagedElement xmi:type="uml:Class"` with its `generalization/general` and
`ownedAttribute` (`name`, `type`, `upperValue`, `aggregation`). `check-ifml` validates
against it: known concrete metaclass, feature declared on the class or a superclass, child
class conforms to the feature type, reference ids resolve, single-valued features not
repeated.

## Interoperability (checked 2026-10-05)

- `ifml-moddle` 0.3.1 (npm, MIT): Plantifier export loads with 0 warnings, 242 typed
  elements, all 32 `NavigationFlow` ends resolved.
- Difference: `ifml-moddle` models `Event.activationExpression` as containment, the OMG
  metamodel as a plain reference. The export follows OMG, so that reader loads the
  `ActivationExpression` elements but does not link them to their events.
