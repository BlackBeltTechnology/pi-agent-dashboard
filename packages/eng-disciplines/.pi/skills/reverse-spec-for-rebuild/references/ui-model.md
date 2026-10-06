# UI model — screen record format

One JSON file per screen or dialog: `<PKG>/ui/screens/<id>.json`. Forms produced by
`scripts/ui-extract/forms.mjs` live in `<PKG>/ui/forms/`. Every cite is `file:line` or `file:a-b`, relative
to the application root. `scripts/ui-extract/gate.mjs` checks every rule marked **[gate]**.

```jsonc
{
  "id": "SCR-order",                      // SCR-* for routed screens, DLG-* for dialogs [gate: unique]
  "kind": "route|modal|panel",
  "name": "Orders",
  "route": "/order",                       // or null
  "template": "html/order.htm",            // [gate: file exists]
  "controller": "OrderController",         // or null
  "opener": { "trigger": "…", "cite": "js/tasks.js:842" },   // dialogs: where it is opened, else null
  "scope": [                               // inventory rows this record must account for [gate: coverage]
    { "file": "html/order.htm" },
    { "file": "js/tasks.js", "from": 836, "to": 870 }
  ],
  "forms": [                               // config-driven forms (forms.mjs output) [gate: ui/forms/<form>.json exists]
    { "form": "FRM-order-line--plb", "region": "new order lines", "cite": "html/order.htm:18-60" }
  ],
  "fields": [                              // template-defined inputs not covered by a forms/ record
    { "key": "realTaskStart", "label": "…", "type": "text|date|number|checkbox|select|textarea",
      "binding": "$scope.realTaskStart", "required": true, "default": "…", "cite": "…", "covers": ["html/x.htm:3"] }
  ],
  "actions": [{
    "id": "ACT-order-save",                // [gate: unique]
    "label": "Save",                       // visible text or str() key
    "trigger": { "kind": "ng-click|opbar|context-menu|key|modal-button|auto", "cite": "…" },   // opbar = toolbar item enabled by code (adapter `toolbar` hook)
    "handler": { "name": "save", "cite": "js/order.js:400-460" },   // [gate: name occurs in cited lines]
    "guards": ["BR-244"],                  // refusals before any effect (lock, time domain, rights) — NOT input validation [gate]
    "effects": [                           // traced call chain = BPMN service tasks
      { "kind": "validate|call|write|read|navigate|open-dialog|notify|export|state", "step": "Check order-line fields",   // step: 2-5 word business name, used as the BPMN task name
        "target": "…", "cite": "…", "refs": ["BR-115"] }
    ],
    "refs": ["BR-…", "QUIRK-…", "GAP-…", "spec:<cap>#<Requirement name>"],   // [gate: resolve in package]
    "covers": ["html/order.htm:12"]        // inventory rows explained by this action [gate: real inventory rows]
  }],
  "dialogs": [{                            // modals and native alert/confirm/prompt reachable from this record
    "id": "DLG-…", "kind": "modal|alert|confirm|prompt", "message": "str key or text",
    "buttons": ["OK", "Cancel"], "cite": "…", "from": "ACT-…", "covers": ["…"]
  }],
  "navigation": [{ "to": "SCR-…|DLG-…|/route", "trigger": "…", "cite": "…", "covers": ["…"] }],
  "unmapped": [{ "at": "file:line", "reason": "…" }],   // inventory rows deliberately not modelled
  "confidence": "confirmed|inferred"
}
```

Rules:

- Describe only what the cited code does. No invented labels, fields, buttons or effects.
- Link to existing `BR-`/`QUIRK-`/`GAP-`/`spec:` ids instead of restating behaviour; when the
  package has nothing, say so in the effect `target` text and do not invent ids.
- Every effect has a `step`: a 2–5 word business-level name (verb + object, no code identifiers).
- A `spec:` ref ends at `;` or end of string; use the exact `### Requirement:` name.
- Every in-scope inventory row (`_inventory.json`, kinds other than template/controller/
  directive/component/factory/service) must appear in some `covers` or in `unmapped`.
