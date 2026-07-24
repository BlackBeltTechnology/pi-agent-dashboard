---
session: 019f4485
week: 2026/W28
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (21 user prompts); large facts sheet (~14316 tok)"
upgrade_status: pending
openspec_changes: [add-invoicebot-rest-plugin]
proposal_excerpt: "The InvoiceBot React app (Board / Opened-invoice / Ask / Settings surfaces) has no backend. Every screen calls a typed `InvoiceBotClient` whose methods are stubs. InvoiceBot's logic already exists as four role-scoped…"
---

# How we did it: an InvoiceBot REST API design — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator wanted to give the InvoiceBot React app a real backend. The kickoff
prompt (via `/skill:openspec-explore`):

> *"I would like to add REST API for pi-invoicebot plugin (../pi-invoice-bot) to expose
> rest API. It handle CWD, because the database, events, operations related to CWD
> sessions currently."*

The prompt carried a hand-drafted **middleware contract**: the React app never talks to
a backend directly — every screen calls one typed `InvoiceBotClient` whose methods are
stubs, and those stubs route to **two planes** (a REST *data* plane inside pi-dashboard
and a WebSocket *conversation* plane). The **real objective**, once steering clarified
it, was an **explore-mode OpenSpec change** — proposal + design + spec + tasks + a
complete, client-buildable `api-contract.md` — that resolves one load-bearing question:
how does a *directory-scoped* invoice engine (DB keyed by CWD, not session) get served
by a *single* dashboard plugin process. No code was implemented; the deliverable is a
validated, committed design.

## 2. TL;DR playbook

1. Enter explore mode: `/skill:openspec-explore` with the goal **and** any hand-drafted
   contract pasted inline.
2. **Ground before designing** — read both codebases in parallel (`ctx_batch_execute`):
   the pattern-to-mirror (`packages/automation-plugin`) and the engine to expose
   (`../pi-invoice-bot`). Find the one load-bearing fact — here, `STATE_DIR` in
   `_store.ts` is a `process.cwd()`-derived **module-load const** with an `IB_STATE_DIR`
   override.
3. State the single decisive constraint back to the user and let their domain knowledge
   resolve it ("directory-keyed + open-per-call + WAL ⇒ one process serves all CWDs").
4. Scaffold the change **directly** (no `openspec change new` subcommand exists) by
   mirroring an existing change folder's structure; write `proposal / design / spec /
   tasks`.
5. Re-validate after *every* edit: `openspec validate <change> --strict`.
6. Write a **standalone `api-contract.md`** grounded in the actual `ib_*` tool + engine
   source — every endpoint, selector, request/response shape, typed `data`.
7. Track unresolved surface holes in a dedicated `gaps.md` (G1–G4), cross-linked from
   design + tasks + contract.
8. Make the contract a **living obligation** (proposal Impact clause + a checkable
   tasks.md enforcement row: contract updates land in the same commit as any route change).
9. Commit surgically (only the change folder), then push to the named remote branch.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / Grounding.** The AI loaded `openspec-explore`, then read the two
codebases in parallel before proposing anything. It located the crux immediately:
`STATE_DIR = process.env.IB_STATE_DIR ?? resolve(process.cwd(), ".pi/flows/invoicebot-state")`
— a const evaluated **once at import**, so it can't be flipped per request in a
long-lived process. It mapped the dashboard idiom (`automation-plugin` never touches
`process.cwd()`; the client sends `?cwd=` and the plugin forwards it) and confirmed there
is **no synchronous tool-call RPC** on the browser/bridge protocol — the conversation
plane is prompt-streaming only, which is *why* the design needs REST.

**Phase 2 — Design convergence (human-led).** The user supplied two insights that carried
the architecture: (1) the store is directory-keyed + open-per-call + WAL-multiwriter, so
**one process serves every workspace** with `cwd` as a request param — the AI's initial
"concurrency race" worry was wrong and it said so; (2) **pi-flows exposes run → sessionId**,
closing the invoice↔session seam. The design crystallized into ~26 **pure ops** (in-process,
store resolved per-call via `AsyncLocalStorage` → `stateDir()`, safe because the store is
synchronous) + 5 **flow-triggering ops** reusing the flows-plugin `flow:run`-into-session seam.

**Phase 3 — Packaging pivot.** The user asked to make it a separate monorepo package "like
the other plugins." That collided with a real constraint the AI surfaced: every existing
plugin is self-contained on in-monorepo deps, and `@blackbelt-technology/invoicebot` is
`private`+unpublished. Resolution went through an **engine port** (plugin codes against an
`InvoiceEngine` interface; Fake ships now, Real later), then — on the user's call — a direct
`file:../pi-invoice-bot` link marked loudly as **release-blocking tech debt** (it resolves
for local dev but not in CI/`release-cut`, which bind the Fake).

**Phase 4 — Session-seam hardening.** Successive steering upgraded the seam from a stub to a
real, reuse-first mechanism: `ctx.spawnSession({cwd, automationRun:{runId}})` + correlate by
**runId, not cwd** (a documented automation-plugin footgun), and — when a `sessionId` arrives
as a param — `ctx.emitEventToSession(sessionId, {eventType:"flow:run"})` to **reuse** a live
session instead of spawning, gated by a cwd-match/invoicebot-session validation.

**Phase 5 — Contract + gaps + closeout.** The AI wrote the 13-section `api-contract.md`
(grounded in source, not guessed), the "number → invoice_id → sessionId" recipes, the
"no session yet" first-class outcome, and a `gaps.md` (G1–G4) after the user dropped G5. It
made the contract a living obligation, validated `--strict` throughout, committed only the
change folder, and pushed to `private/invoicebot`.

## 4. Prompts that worked

- **The goal prompt** was strong because it (a) invoked `/skill:openspec-explore` to force
  explore-mode discipline, (b) named the exact sibling repo path, (c) flagged the *one hard
  problem* (CWD-scoping) up front, and (d) pasted the hand-drafted middleware contract inline
  so the AI had the intended shape from turn one. Reuse this pattern: **skill + repo path +
  the load-bearing constraint + any draft you already have.**
- **High-leverage follow-ups** — short prompts that unlocked a lot:
  - *"one process can serve all requests when the CWD is given as request parameter"* — a
    single domain fact that collapsed the whole concurrency design.
  - *"The flow result can be queried from pi-flow to get sessionId"* — closed the seam.
  - *"When sessionId travels as request parameter do not spawn session, reuse it. Is it
    possible?"* — turned a spawn-only design into reuse-first.
  - *"Use as direct file link and remark that it has to change"* — decisive scoping of the
    dependency debt.
- **Rewrite weak prompts.** *"where is api-contract?"* and *"add to api-contract"* worked only
  because context was fresh. A stronger reusable form: *"Write/update `api-contract.md` at
  `openspec/changes/<change>/` and print its path; keep it grounded in the actual tool source."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume a per-request cwd flip needs concurrency guarding ("race") | "DB is directory-keyed + open-per-call + WAL — one process serves all" | State the store's concurrency model up front; the AI over-worried a non-issue |
| Leave the invoice↔session seam a stub | "pi-flows gives run → sessionId"; "give sessionId back" | Name pi-flows' run→sessionId query as an available capability early |
| Default to spawning a new session per op | "if sessionId is a param, reuse it — is it possible?" | Ask reuse-first; host exposes `emitEventToSession`/`sendToSession` |
| Design a cross-repo npm dependency | "not released — use a direct `file:` link and mark it must-change" | Declare the dep is unpublished and pick the interim binding explicitly |
| Defer the engine-home decision indefinitely | "make it a separate package like other plugins" | Say the target packaging up front so the port/adapter split is chosen once |
| Over-track gaps (filed G5/OAuth as a gap) | "Ignore G5"; OAuth-on-WS is intended, not a gap | Distinguish *intended design* from *gap* before filing |
| Let the contract drift from implementation | "mention the contract in proposal to be updated when the API changes" | Encode a living-contract clause + a checkable enforcement task |

Quality bars the user imposed: **document detailed enough for another agent to build a
client** (drove the 13-section contract), and **surgical commits** (only the change folder;
leave the unrelated `.pi/settings.json` edit unstaged).

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were persisted this session. But two patterns are clearly repeatable
and worth capturing as skills next time:

- **"Design a dashboard REST plugin over a CWD-scoped engine."** Captures the reusable
  procedure: mirror `automation-plugin`'s `?cwd=` idiom; resolve a module-load `STATE_DIR`
  const to a per-request `AsyncLocalStorage` → `stateDir()`; split ops into pure-DB vs
  flow-triggering; reuse `spawnSession`/`emitEventToSession` and correlate by **runId, not
  cwd**. Invoke whenever a directory-scoped sibling engine needs a single-process dashboard
  backend.
- **"Living api-contract obligation."** Encode the contract as source-of-truth with a
  proposal Impact clause + a tasks.md enforcement row (contract change lands in the same
  commit; verified at the code-review gate). Invoke on any change that ships a client-facing
  API surface.

## 7. Pitfalls & dead ends

- **`openspec change new <name>` does not exist** — it failed. Scaffold by mirroring an
  existing `openspec/changes/*/` folder's file structure directly, then `validate --strict`.
- **Correlate flow ops by `runId`, not `cwd`** — a cwd-FIFO bind delivers `flow:run` to the
  wrong session (documented automation-plugin footgun).
- **`file:../pi-invoice-bot` resolves locally but NOT in CI/`release-cut`** (no sibling
  checkout there) — those builds must bind `FakeInvoiceEngine`; mark the `file:` dep as
  release-blocking everywhere it touches.
- **Repeated "stray property" edit failures** — three edit retries came from re-adding an
  extra key; re-do the edit cleanly rather than patching the patch.
- **Search returns `{ ids: [...] }`, not one hit** — number→invoice_id is a content match;
  confirm against `summary.invoiceNumber` before using the id.
- **A missing `sessionId` is normal, not an error** — "no chat session yet" is a first-class
  outcome; the client must not spawn a session just to view chat.
- **Don't over-file gaps** — OAuth-on-WS is intended design, not a gap; keep one explanatory
  line so no one re-files it.

## 8. Reproduce it faster — checklist

- [ ] Kick off with `/skill:openspec-explore` + sibling repo path + the load-bearing
      constraint + any hand-drafted contract pasted inline.
- [ ] Read the pattern-to-mirror plugin **and** the target engine in parallel; find the one
      module-load const / seam that decides the architecture.
- [ ] State the decisive constraint back; let the user's domain knowledge resolve it.
- [ ] Scaffold the change by mirroring an existing `openspec/changes/*/` folder (no
      `change new` subcommand); write proposal / design / spec / tasks.
- [ ] Split ops into pure-DB vs flow-triggering; resolve cwd per-request via `AsyncLocalStorage`.
- [ ] Reuse-first session seam: `emitEventToSession` when a `sessionId` is supplied, else
      `spawnSession` + correlate by **runId**.
- [ ] Bind an unpublished sibling via `file:` + mark release-blocking; Fake for CI.
- [ ] Write a standalone, source-grounded `api-contract.md`; track holes in `gaps.md`.
- [ ] Make the contract a living obligation (proposal clause + checkable task).
- [ ] `openspec validate --strict` after every edit; commit only the change folder; push to
      the named branch.

**Key inputs to have ready:** the sibling engine repo path; the store's concurrency model
(keying, open-per-call, WAL); the dashboard `ServerPluginContext` surface
(`spawnSession` / `emitEventToSession` / `onEvent` / `sessionManager.listAll`); pi-flows'
run→sessionId query.

**Final artifacts** (worktree `.worktrees/private-invoicebot-plugin`, committed `9f35c70ed`,
pushed to `private/invoicebot`):
`openspec/changes/add-invoicebot-rest-plugin/` → `proposal.md · design.md ·
specs/invoicebot-rest-api/spec.md · tasks.md · api-contract.md · gaps.md`.

---

_Generated from session `019f4485` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-09. Source extract: `/tmp/session_facts_1784847817N.md`._
