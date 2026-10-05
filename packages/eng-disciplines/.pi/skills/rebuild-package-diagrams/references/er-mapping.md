# ER mapping — model.md → er.json → Mermaid

## Entity classes

| class | put on the ER diagram | typical signals in `model.md` |
|---|---|---|
| domain | yes | persisted business rows (orders, items, stock, plan events), or the in-memory aggregate that owns them and is rebuilt from them |
| config | no (optional appendix) | `CONF.*`, config JSON, rule/definition tables read only at startup |
| ui | no | screen/modal/grid state, drag objects, view descriptors |
| test | no | test cases, assertion registries |
| technical | no | base classes, DB drivers, factories, logs, caches |

Definition tables that business rows reference (e.g. product groups, task types,
changeover types) are **domain** when a domain row's field points at them.

## er.json schema

```json
{
  "entities": [
    { "name": "Order", "fields": [
      { "name": "id", "key": "PK" },
      { "name": "itemnum", "key": "FK", "comment": "-> Product" },
      { "name": "deadline", "type": "date" }
    ] }
  ],
  "relations": [
    { "from": "Product", "to": "Order", "cardinality": "1:N", "label": "ordered as",
      "confidence": "inferred", "evidence": "one Product by itemnum" }
  ]
}
```

- `name` — exact `## <Entity>` heading; `fields[].name` — exact field name from `model.md`.
- `key` — `PK`, `FK`, `UK` or `PK, FK`; `type` overrides the model type (one word).
- `cardinality` (from → to) — one of `1:1`, `1:0..1`, `1:N`, `1:1..N`, `0..1:N`, `0..1:1`,
  `N:1`, `N:0..1`, `N:M`.
- `confidence` — `confirmed` only when the cited model text states both ends; otherwise
  `inferred` (dashed line).
- `evidence` — verbatim substring of either endpoint's `Relationships:` text
  (case-insensitive) or an exact field name on either endpoint.

## Cardinality from model text

| model wording | cardinality |
|---|---|
| "many X", "has many", `X[]`/array field, "grouped by" | 1:N |
| "one X", "belongs to one", scalar FK field | N:1 (from the holder) |
| "may be parent of", nullable self FK | 0..1:N self |
| "optionally", nullable FK | N:0..1 |
| composite key of two refs | N:M via the row entity (draw two N:1) |

## Notation

Mermaid crow's foot: `||` exactly one, `o|` zero or one, `}o` zero or many, `|{` one or
many. `--` solid = confirmed, `..` dashed = inferred. Keep the overview to keys only;
details live in the cluster diagrams.
