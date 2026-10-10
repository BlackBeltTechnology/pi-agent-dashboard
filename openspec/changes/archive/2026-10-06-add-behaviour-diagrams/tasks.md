## 1. Tests first
- [x] 1.1 sequences: sequence-from-ui draft (guard alt, effect lifelines by cite file) passes; dangling participant/ref/cite refused; collaboration numbering
- [x] 1.2 state machines: valid passes + mermaid/SCXML; unknown field, bad value, two initials, unknown target, missing cite, unreachable refused
- [x] 1.3 objects: synth passes check; bad attr, link without relation, multiplicity refused; from-db masking + join gate; _local only with --local
- [x] 1.4 build-site embeds behaviour + backlinks data; behaviour export files

## 2. Implementation
- [x] 2.1 scripts/behaviour.mjs + diagrams.mjs commands + site.mjs embedding
- [x] 2.2 catalog views + backlinks; render.sh
- [x] 2.3 reverse-spec-for-rebuild prompts + SKILL phase; docs, AGENTS rows

## 3. Pilot
- [x] 3.1 Pilot app: sequences (drafts + deepened), state machines, synthetic + masked-real objects; catalog verified in browser

## Notes

- Pilot (the pilot app): 3 sequences (2 deepened by subagents to `plandb` via DBWorker/ADODB), 3 state machines by subagents (Task.status 4/12, ProdOrder.status 4/7, Process.locked 3/79), 2 synthetic + 1 masked real object diagram (plb_db.json, leak check: no source string in output); all gates pass with `--app`; all 12 Mermaid diagrams parse; backlinks verified in the browser.
- Fixed during the pilot (each test-first): multi-location UI cites → first location per message; 1:1 relation fan-out; diagram labels clipped at 40 chars; `:` in state-diagram labels breaks Mermaid's grammar → `꞉`.
- Host caps concurrent subagents at 2 → pitfall added to reverse-spec-for-rebuild.
