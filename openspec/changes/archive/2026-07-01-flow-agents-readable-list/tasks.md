## 1. pi-flows: emit structured catalog in `details` (dependency, separate repo)

- [x] 1.1 In `../pi-flows`, create a linked OpenSpec change for the `flow_agents op:"list"` details contract (its own repo/spec). — change `flow-agents-list-details` created (proposal/design/specs/tasks).
- [x] 1.2 In `extensions/flow-engine/tools/flow-agents.ts` `op:"list"`, build `details = { count: catalog.length, agents: catalog.map(a => ({ name, description, source_type, source_path?, tools?, inputs?, outputs?, use_when: a.architect?.use_when ?? a.description })) }` and return it alongside the existing `content[0].text` (text unchanged).
- [x] 1.3 Add/extend a pi-flows test asserting `op:"list"` returns a non-empty `details.agents` array with `name`+`description`+`source_type` per entry, and `details.count` equal to the catalog length. — 3 new tests, 13/13 pass, tsc clean.
- [x] 1.4 `npm run reload` to refresh connected sessions with the new tool output. — reload sent to all sessions.

## 2. Dashboard tests first (TDD) — `packages/flows-plugin/src/__tests__/authoring-renderers.test.tsx`

- [x] 2.1 Failing case: `op:"list"` with `toolDetails={{ count:2, agents:[{name,description,source_type:"local"}, …] }}` and a TRUNCATED `result` → assert one row per agent renders (name + description + source badge) and "2 agents", with NO "Show full output" needed. Verify it fails.
- [x] 2.2 Failing case: expanding a row whose entry has `tools/inputs/outputs/use_when` reveals a detail block listing each present field; a field absent from the entry is NOT shown.
- [x] 2.3 Case: rows are collapsed by default (no detail block until a row is expanded).
- [x] 2.4 Fallback case: no `toolDetails`, valid text catalog array → rows still render from parsed text (older-pi-flows path).
- [x] 2.5 Regression: truncated `result` + no `toolDetails` → still "output truncated — expand", never "0 agents" (prior-change invariant intact).

## 3. Dashboard implementation — `FlowAgentsToolRenderer.tsx`

- [x] 3.1 Define a local duck-typed `AgentListEntry` interface (all fields optional: `name, description, source_type, source_path, tools, inputs, outputs, use_when`).
- [x] 3.2 Extend `deriveListCatalog(result, toolDetails)` to return full `AgentListEntry[]` (not just names): prefer `toolDetails.agents`; else parse `result` text into entries (normalize `use_when ?? architect?.use_when ?? description`); else truncation-marker guard.
- [x] 3.3 Replace the flat `names.join(" · ")` render with a per-agent row list: chevron + mono `name` + `description` + `source_type` badge. Keep the header count.
- [x] 3.4 Add a local `useState<Set<string>>` of expanded agent names; clicking a row toggles it; render a detail block (tools/inputs/outputs/use_when) only for expanded rows, omitting absent fields. Rows collapsed by default.
- [x] 3.5 Keep the truncation-marker "output truncated — expand" branch for the no-details+truncated case; keep genuine-empty → "0 agents".

## 3b. Bridge live-path fix (discovered during verification)

- [x] 3b.1 In `packages/extension/src/bridge.ts` enriched `tool_execution_end` handler, lift `event.result.details` onto `event.details` (when result is an object with `details` and no top-level `details`) so the client reducer populates `toolDetails` LIVE, not only on replay. — implemented, probe-confirmed `event.result` = `{content,details}`, `hasDetails:true`.

## 4. Verify

- [x] 4.1 `HOME=$(mktemp -d) npx vitest run packages/flows-plugin` — all new cases pass, no `authoring-renderers` regressions; `npx tsc --noEmit -p packages/flows-plugin/tsconfig.json` exit 0.
- [x] 4.2 `npm run build` + `POST /api/restart`; with the pi-flows change reloaded, run `flow_agents op:"list"` and confirm the card shows an always-visible per-agent list, each row expandable to tool/input/output detail, no "Show full output" required. — VERIFIED LIVE: card shows "list · 7 agents", 7 rows (name+description+built-in/local badge); expanding test-analyzer revealed tools:read / inputs:focus / outputs:notes / use_when. Screenshot captured.
