# @blackbelt-technology/pi-dashboard-hermes-memory-plugin

Dashboard settings surface for the [`pi-hermes-memory`](https://www.npmjs.com/package/pi-hermes-memory)
pi extension. Contributes a **settings-section** (General tab) that reads and
writes the extension's on-disk `~/.pi/agent/hermes-memory-config.json` through
two validated server routes:

- `GET /api/plugins/hermes-memory/config` — returns, per `MemoryConfig` field,
  the effective value (on-disk when set, else the resolved default), the
  default, and an `isDefault` flag, plus the resolved file path + `exists`.
- `PUT /api/plugins/hermes-memory/config` — validates the submitted config
  (unknown-key allowlist, type/enum/numeric-bound checks, regex compilation)
  and, on success, atomically writes the full resolved config as pretty JSON.

The client renders a grouped accordion form over **every** settable field
(including the four correction-regex arrays), with a per-field DEFAULT badge +
Reset, inline validation, a sticky save bar, a raw-JSON view, and an "applies to
new sessions" notice (hermes reads config once at extension load).

The plugin declares `requires.piExtensions: ["pi-hermes-memory"]`, so the
section and routes activate only when the extension is installed. It does **not**
depend on the external package — the `MemoryConfig` shape + defaults are
re-declared in `src/shared/hermes-config.ts` (mirrors goal-plugin's treatment of
pi-goal-hermes).

See change: `add-hermes-memory-settings-plugin`.
