# CRUD matrix

Who creates (C), reads (R), updates (U) and deletes (D) each entity, from the UI model's data
effects. Code: `scripts/crud.mjs`. Records are classified by a gated subagent; matrices,
findings and exports are deterministic.

## Steps

1. `diagrams.mjs crud-draft PKG <SCR-id> <out.json>` — every `write` / `read` / `export` / `call`
   effect of the screen (`effect` = `<ACT-id>#<index>`), with `candidates` from an alias index of
   `model.md`: entity name, plural, `CONF.db.tables.<key>`, `table <name>` and
   `collection <name>` in `Persistence`, matched on identifiers and their camelCase / snake_case
   parts. Hints only: prose over-matches, data-layer functions hide the entity.
2. Classifier (`reverse-spec-for-rebuild` `prompts/crud-classifier.md`, one subagent per screen
   batch) writes `PKG/diagrams/crud/<SCR-id>.json`:
   `{screen, entries: [{effect, entity, op, note}], unmapped: [{effect, reason}]}`.
3. Gate `check-crud PKG [--complete]`: screen / action / effect index exist, entity is a
   `model.md` heading, op ∈ C R U D, no duplicate `(effect, entity, op)`, every data effect of the
   screen classified or unmapped with a reason; `--complete`: a record for every screen with data
   effects. `build-site` runs the same gate.
4. `crud PKG <outDir>` → `crud.csv` (entity × use case), `crud-screens.csv` (entity × screen),
   `crud-findings.md`. `render.sh` writes them to `PKG/diagrams/crud-matrix/`.

## Assembly

- Use-case actions: the use case's UI actions (`ui:` lines of its flows), else every action of
  its `screens`. A use case with neither has an empty column.
- Cell = the ops of all entries of those actions, in C R U D order.
- Findings, over `model.md` entities marked persistent: **never written** (touched, no C/U/D),
  **never read** (no R), **created but never deleted** (C without D), **untouched** (no entry).
  Each is a question for the domain expert, not a defect.

## Catalog

**CRUD** header button: matrix by use case / by screen (sticky header, coloured C/R/U/D badges,
rows link to entities, columns to use cases / screens), findings with entity chips. Entity
pages list their CRUD entries (op, action, effect, note); use-case pages their entity chips.
