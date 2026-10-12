# summaries.json — the authored layer

The only non-deterministic input to the atlas. One entry per skill id; the build never
writes it, `stamp` only adds/updates `descHash`.

## Schema

```json
"my-skill": {
  "id": "my-skill",
  "oneLiner": "<= 9 words, no trailing period",
  "summary": "2-4 sentences: what it concretely does, which files/tools/CLIs it drives.",
  "useWhen": "One sentence.",
  "dontUse": "One sentence, or \"\".",
  "category": "Research | Knowledge & memory | Rigor & review | Spec workflow | Frontend & design | Coding | Media & docs | Workspace & tooling",
  "keySteps": ["3-5 imperative bullets, <= 12 words each"],
  "cost": "free | tokens | credits",
  "descHash": "written by `atlas.mjs stamp` — do not invent"
}
```

- `category` must be one of the eight exactly; it overrides the scanner's keyword guess.
- `cost`: `credits` = spends a paid API allowance (Firecrawl, Gemini, Soniox, Veo…);
  `tokens` = subagent fan-out or long loops; otherwise `free`.
- `check` rejects unknown categories/costs, empty fields, and an `id` that differs from the key.

## Writing rules

1. Write from the `todo` output (description, headings, first body lines). Open the full
   `SKILL.md` only when the body excerpt is truncated before the procedure is clear.
2. Describe what the skill **does**, not its trigger phrases — the router text is already in
   the description; the summary is for a human deciding whether to use it.
3. Plain English. Backticks only for real paths, commands, file names, schema ids.
4. Never invent behaviour, flags, or costs that are not in the `SKILL.md`. If unclear, say less.
5. For a STALE entry, keep what is still true and change only what the new description or
   body contradicts or adds. `todo` prints the current entry for comparison.
6. Name a better alternative in `dontUse` when one exists in the atlas.

## Staleness model

Two stamps per entry, both written only by `stamp <ids>` (or `stamp --all`; never by hand):

- `descHash` — sha256 prefix of the frontmatter `description`.
- `bodyHash` — sha256 prefix of the body (frontmatter stripped), plus a snapshot of that body
  in `<dir>/.stamps/<id>.md` so later changes can be shown as a line diff.

| Bucket | Trigger | Blocks `check`? | Fix |
|---|---|---|---|
| missing | skill has no entry | yes | write it, `stamp <id>` |
| stale | description changed | yes | rewrite what it contradicts, `stamp <id>` |
| redo | `redo <id>` was run | yes | rewrite from scratch, `stamp <id>` |
| drifted | body changed: headings changed **or** ≥ 10 % of lines | yes | review diff, edit if needed, `stamp <id>` |
| minor drift | smaller body change | no (still listed by `todo`) | review diff, `stamp <id>` |
| unstamped | entry lacks `descHash` or `bodyHash` | no | review once, `stamp <id>` |
| invalid | schema violation, or an unsafe skill id (path characters) | yes | fix the field; unsafe ids are never stamped |
| orphans | entry for a skill no longer installed | no | leave, or delete the entry |

Reviewing drift usually ends in "still accurate" → `stamp` alone, with no prose change, so
the page hash only moves when a summary genuinely needed to.

Calibration (2026-10-06, first run): of 9 body-only changes since the entries were written,
4 were drifted (new sections/flags/modes — all needed edits) and 5 minor; 4 of the minor ones
were cosmetic, but `pi-dashboard` (+9/−3 lines, hide/unhide → archive/unarchive) made its
summary wrong. That is why `todo` includes minor drift by default (`--major-only` skips it).
