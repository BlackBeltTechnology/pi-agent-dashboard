# KB read discipline — trust verdicts + search guard

## Trust verdicts (kb_search hits)

`kb_search` hits on `doc_type: agents` carry a trust verdict. Labels: `FRESH` / `STALE` / `MOVED` / `GONE` / `UNVERIFIED`.

Verdict = worst-of over hit's DOX-row subject set (source files its rows document, first 8 rows).

Render form: `LABEL (n of m subjects checked)`.

Label-only. NEVER affects ranking. Order identical with verdicts on/off.

Per-hit subject cap: 8. Counts state checked AND total.

CLI: opt-in `kb search --verdicts`. Tool: always on for agents hits.

| Label | Meaning | Required agent action |
|---|---|---|
| `FRESH` | Exists. Content hash matches acknowledged hash. | Act without re-reading source. |
| `STALE` | Exists. Hash differs from acknowledged. | Verify row against source before acting. Repair: update row, then `kb dox triage --ack`. |
| `MOVED` | File absent. Git rename found successor path. | Use reported `movedTo` path. |
| `GONE` | Absent, no rename (non-git or undetectable degrades here). | Verify against source before acting. Prune or fix row. |
| `UNVERIFIED` | Exists. No acknowledged hash yet. | Common at first deployment. Not an error. Not trust. Ramp out: edit the AGENTS.md row or run `kb dox triage --ack`. |

Ack record (sidecar v2): `<cwd>/.pi/dashboard/kb/dox-staleness.json` = `{version: 2, files: {<relpath>: {sha256, size, mtimeMs}}}`. v1 (sha-only) reads fine. Matching stat baseline skips the read. Files >1048576 bytes or binary never hashed.

## Search guard (arm B)

Counts consecutive search actions with no kb consult. Fires at 3.

Search action = raw-search tool call, OR bash segment (split on `|`, `||`, `&&`, `;`, newline) leading with a search binary (`grep`, `rg`, `find`, `fd`, `ls`, …). `cat f | grep x` counts. `npm test` never counts. `timeout 60 rg` does NOT count — accepted gap (env prefixes `FOO=1 rg` also evade). Nudge, not sandbox.

Reset (clean slate, chain + firings): `kb_search` / `kb_neighbors` / `kb_get` tool calls, or bash leading with `kb`. Empty kb_search query still resets. Edits/writes never reset.

Ladder: firing 1 = warning, firing 2 = escalation, firing 3+ = block verdict ONLY in block mode.

Modes: `off` | `warn` | `block`. Config `readDiscipline.guard.mode` in `.pi/dashboard/knowledge_base.json`. Shipped default: `warn`. `block` never default; config-file edit required.

Env override `KB_GUARD_MODE`: may select `off` or `warn` only. Cannot enable `block`.

Suspension: `kb_guard_pause` tool, agent self-service, 1–20 model turns, clamped. Re-suspend keeps max. Ticks down per turn. Expiry = clean slate.

Guard failure = silent. Tool calls and results untouched.

## Code

Verdict core: `packages/kb/src/verdict.ts` (`enrichHits`). Guard core: `packages/kb-extension/src/guard.ts` (`createGuard`). Wiring: `packages/kb-extension/src/extension.ts`.

Latency numbers: `openspec/changes/add-kb-trust-verdicts-and-search-guard/measurements.md`. Post-archive: `openspec/changes/archive/<date>-add-kb-trust-verdicts-and-search-guard/measurements.md`.
