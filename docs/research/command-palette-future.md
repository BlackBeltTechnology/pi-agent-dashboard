# Command Palette — Future Slash Commands

Aspirational `/` slash-command surface for the dashboard chat input. Captured
here so it can be designed and implemented later. **Nothing in this document
is implemented today** — it is a forward-looking spec, not a description of
current behavior.

Context: a subset of these commands is referenced in
[`docs/research/plano-pi-integration.md`](./plano-pi-integration.md) as part of
the broader Plano routing/orchestration integration. This file isolates the
*command-palette UX* concern from the routing concern so the autocomplete
work can ship independently.

## Target command list

| Command | Description | Status today |
|---|---|---|
| `/flows` | Manage flows (new, edit, delete) — opens picker | Intercepted on send in `App.tsx`, **not** in autocomplete |
| `/flows:new` | Design & run a new flow | Intercepted on send, **not** in autocomplete |
| `/flows:edit` | Edit an existing flow | Requires `pi-flows` extension to register the command |
| `/flows:delete` | Delete a flow | Requires `pi-flows` extension to register the command |
| `/roles` | Assign model roles (per-role model picker) | Requires extension to register the command |
| `Ctrl+A` | Toggle auto-routing on/off | **Not wired** — no keybinding, no setting, no server state |

## Why Tab-completion does not work for these today

Two layers cooperate to drive the dropdown — and they disagree:

```
┌─────────────────────────────────────────────────────────────┐
│ CommandInput.tsx — controls the dropdown                    │
│   BUILTIN_COMMANDS = [compact, reload, new]                 │
│   + session.commands (extension-provided)                   │
│   = the autocomplete pool                                   │
└─────────────────────────────────────────────────────────────┘
                         vs.
┌─────────────────────────────────────────────────────────────┐
│ App.tsx — intercepts on send (Enter)                        │
│   BUILTIN_SLASH_COMMANDS = {                                │
│     /flows, /flows:new, /flows:edit, /flows:delete,         │
│     /compact, /reload, /new, /model, /roles                 │
│   }                                                         │
└─────────────────────────────────────────────────────────────┘
```

`BUILTIN_SLASH_COMMANDS` ⊋ `BUILTIN_COMMANDS`, so several first-party
commands are typeable-and-handled but not discoverable via Tab. Anything
gated on `M0.some(c => c.name === "flows:edit")` additionally requires the
`pi-flows` extension to push the command into `session.commands`.

## Implementation directions (not chosen)

1. **Lift first-party commands into `BUILTIN_COMMANDS`.** Add `/flows`,
   `/flows:new`, and conditionally `/flows:edit` / `/flows:delete` /
   `/roles` to `BUILTIN_COMMANDS` so they autocomplete with no extension
   installed. Conditional entries need a way for App to push availability
   down (e.g. a `dynamicBuiltins` prop derived from session state).
2. **Single source of truth via extension.** Remove the App.tsx interceptors;
   require `pi-flows` (or a bundled equivalent) to register every flow
   command. Autocomplete and behavior stay in sync by construction. Cost:
   the extension becomes mandatory for flow UX.
3. **"Install this to enable" hint.** When the user types `/flo` and nothing
   matches, render a one-line dropdown row pointing at the package browser.
   Cheaper than option 1; better than the current silent dropdown collapse.

## `Ctrl+A` auto-routing

Out of scope for the command-palette work. Belongs to the Plano integration
(see `plano-pi-integration.md`). When that lands it should:

- bind `Ctrl+A` somewhere global (App-level keydown, mirroring `Ctrl+L` etc.)
- toggle a per-session `autoRouting: boolean` carried on `Session`
- surface state in `SessionHeader` (badge) and in the model picker
  (override label)

Until then this row should be omitted from any in-app help that lists the
above commands — showing it implies it works.

## Cross-references

- `packages/client/src/components/CommandInput.tsx` — autocomplete logic,
  `BUILTIN_COMMANDS`
- `packages/client/src/App.tsx` — `BUILTIN_SLASH_COMMANDS`, `wrappedHandleSend`
- `docs/research/plano-pi-integration.md` — broader routing/orchestration plan
  that motivates `/roles` and `Ctrl+A`
