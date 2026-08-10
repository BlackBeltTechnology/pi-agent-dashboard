# Tasks — steer agents to kb tools

## 1. Root AGENTS.md gate
- [x] 1.1 Replace the prose "STOP — Docs-First Gate" READ portion with the
      substitution table (design.md canonical form), naming the symbol-lookup
      case and adding `kb_neighbors` / `kb_get` rows.
- [x] 1.2 Keep one short imperative for the how-to/build path (`grep docs/faq.md`
      first); drop the rest of the "STOP / you violated" scare framing.
- [x] 1.3 Keep the explicit fall-through + WRITE-discipline loopback (grep on tree
      miss → add the missing row).
- [x] 1.4 Verify byte size did not balloon (AGENTS.md loads every turn) — table
      should be net-neutral or smaller than the prose it replaces.

## 2. project-init seeded READ discipline (dox-doctrine.md)
- [x] 2.1 Add the substitution table to the `<!-- dox:read:kb -->` block
      (`kb agents` / `kb_search`).
- [x] 2.2 Add a degraded same-shape table to the `<!-- dox:read:manual -->` block
      (walk directory `AGENTS.md` chain; no `kb_search`).
- [x] 2.3 Preserve the delimiter markers so the seeder still composes the block.

## 3. Coding profile template
- [x] 3.1 In `profiles/coding/AGENTS.md.tmpl`, change "Never speculate about code
      you have not opened. Read the file first." → "…consult the doc tree
      (`kb agents <path>` / `kb_search`) first, then read the specific file."
- [x] 3.2 Add a one-line pointer to the seeded READ discipline.

## 4. Review & validate
- [x] 4.1 `openspec validate steer-agents-to-kb-tools --strict`.
- [x] 4.2 `doubt-driven-review` pass: confirm the table cannot be read as "kb
      replaces all grep"; fall-through stays explicit.
- [x] 4.3 Grep the three edited files to confirm no remaining "read the file
      first" anti-pattern and no orphaned "STOP/violation" prose.

## 5. Automated seed verification
> project-init seeding runs through the deterministic composer
> `seed-doctrine.ts` `buildDoctrineBlock({ kbWired })` — asserted directly in
> `packages/extension/src/__tests__/project-init-seed-doctrine.test.ts` (no
> docker/Playwright: the skill's browser path drives a model, not this content).
- [x] 5.1 Assert `buildDoctrineBlock({ kbWired: true })` carries the kb
      substitution table (symbol-lookup row, `kb_neighbors`/`kb_get`,
      explicit fall-through).
- [x] 5.2 Assert `buildDoctrineBlock({ kbWired: false })` carries the degraded
      same-shape table (chain-walk rows, explicit fall-through, no kb tooling).
