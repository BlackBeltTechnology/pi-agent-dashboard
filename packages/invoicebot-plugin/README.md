# @blackbelt-technology/pi-dashboard-invoicebot-plugin

InvoiceBot REST plugin for pi-dashboard. Exposes the four `ib_*` selectors over
four `POST /api/plugins/invoicebot/*` endpoints (`query` / `review` / `setup` /
`rules`), keyed by `cwd`, behind an `InvoiceEngine` **port**. One process serves
every workspace; each request supplies its `cwd` (mirrors `automation-plugin`'s
`?cwd=` idiom).

Client contract: `openspec/changes/add-invoicebot-rest-plugin/api-contract.md`.

## Engine binding (port)

Routes depend only on the `InvoiceEngine` port (`src/server/engine/port.ts`).
Two bindings, selected at load (`src/server/engine/select.ts`):

- **`RealInvoiceEngine`** — imports the invoice-bot engine facade
  (`@blackbelt-technology/invoicebot/engine`) and wraps each op in
  `ibContext.run({ cwd })`. Bound when the facade resolves (local dev with the
  sibling repo present).
- **`FakeInvoiceEngine`** — fixtures matching the real tool `details` shapes.
  Bound when the facade is absent (CI, `release-cut`, git worktrees).

The two op classes:

- **Pure ops** (all `query` views; `review` note/cash/reconcile/assign/handoff;
  all `setup`; `rules` approve/reject/move/archive) — served straight through the
  port.
- **Flow-triggering ops** (`review` approve/repair/submit/partner-confirm,
  `rules` request) — the port does the DB effect, then the plugin dispatches
  `flow:run` into the workspace session (reuse a live `sessionId` or spawn), and
  returns the `sessionId`.

## Consent UI: domain events + inline prompts (change: add-inline-consent-ui)

- **Domain events reach the browser.** The extension bridge's EventBus catch-all
  forwards every `pi.events` channel to the browser. Consumed InvoiceBot events
  carry a **stable renamed protocol type** via `IB_EVENT_MAP`
  (`flow-event-wiring.ts`): `ib:approval-requested` → `ib_approval_requested`,
  `ib:approval-decided` → `ib_approval_decided` (payload preserved). Other `ib:*`
  still pass through under their raw channel name.
- **Consent prompts render inline.** A consent `ask_user` confirmation for a
  consequential action is not claimed as a widget-bar prompt, so it resolves to
  the prompt-bus **inline** default (`generic-dialog`) and renders in the chat
  transcript — it is not suppressed by `flow-question-routing`.
- **Flow discriminator.** Forwarded `flow_started` carries `data.flowName`, so a
  consumer can filter a run by flow (e.g. distinguish `invoicebot:add-rule`).

## ⚠️ Interim dependency (MUST CHANGE before release)

> **`TODO(release)`: unpublished — replace the `file:` link with a published npm
> range or a vendored in-monorepo package.**

`@blackbelt-technology/invoicebot` is `private: true` and **not published**. It is
declared as an **`optionalDependency`** `file:../../../pi-invoice-bot` so the
monorepo install succeeds even where the sibling is absent (CI / `release-cut` /
worktrees) — those environments bind `FakeInvoiceEngine`. Before release, retire
the `file:` link (publish or vendor); the port makes it a drop-in swap. Tracked
in `openspec/changes/add-invoicebot-rest-plugin/tasks.md` §8.
