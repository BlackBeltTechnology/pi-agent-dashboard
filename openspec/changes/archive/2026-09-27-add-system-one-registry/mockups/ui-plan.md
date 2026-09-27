# UI plan — add-system-one-registry

Mockup: `index.html` (+ `mockup.css`, `mockup.js`). Serve with `serve_mockup{dir}`; append `?theme=light` for light.
Token authority: repo `ui-contract.md` → `packages/client/src/index.css`, copied verbatim into `tokens.css` (no drift, checked by name diff).
No raw hex in `mockup.css` / `mockup.js`. One literal: `white` text on `--accent-primary-strong` fills (switch-on knob, primary button), which maps to Tailwind `text-white` as used in the client today. No token exists for it.

The "Mockup controls" strip (dashed border) is demo-only: theme, managed runtime (`ok` / `uv-missing` / `windows`), Jev key source (`none` / `file` / `env`), force the next save to get a 409.

## Surfaces → tokens → states

| # | Surface (spec area) | Real component to build / reuse | Tokens | States in mockup |
|---|---|---|---|---|
| S1 | Where data may go: `allowOffMachine` switch | new; `role="switch"` + `aria-checked` | switch: `--bg-surface` / `--border-strong` off, `--accent-primary-strong` on | off (default): effect text names 127.0.0.1 · on: effect text names Jev + cloud chat roles |
| S2 | Preset selector + no-usable warning | radio cards (native radios) | card: `--bg-tertiary`; checked ring `--accent-primary`; warning: severity-warning recipe | local-only active · hosted + off → warning with 2 fixes (allow / switch to local-only) |
| S3 | Default chain editor | adapt `blackhole-plugin/src/client/ChainEditor.tsx` (button reorder, boundary controls disabled, not absent) | inset panel recipe | reorder · remove (not on last entry) · add · unusable entries struck through with a text reason |
| S4 | Backend catalog | new rows | inset panel; egress badge: severity-success (on) / severity-warning (off) + icon + words | http hosted (Jev) · managed ready / starting (progress vs 120 s budget) / failed (port-in-use) · http loopback user-declared · llm role → cloud model · uv missing · Windows |
| S5 | Key entry (Jev) | new inline form, not a Save Bar source | input recipe, `type=password` | not set · set in file (Replace) · set in env (no input, "change it in your shell") |
| S6 | Consumers | `<details>` rows, same shape as blackhole subcards | inset panel; policy chip | selftest · fail-open + llm (warning chip + callout) · incompatible filter (hidden count, reveal toggle with reason) · fixtures missing (Test unavailable + path) |
| S7 | Per-consumer Test | new | progressbar `--status-working`; table on `--border-subtle` | idle · running (n / N, Cancel) · results (accuracy, AUC, p50, p90, chars, estimated cost) · save shadow / enforce |
| S8 | Enforce confirm | dialog recipe | scrim `--bg-overlay` + card recipe | names consumer, backend, model; focus lands on Cancel; Escape closes; focus trapped |
| S9 | Host Save Bar | existing `useSettingsDraftSource` host bar | default + severity-error | dirty "1 page: Decision models" · 409 conflict: explains cause, Reload / Discard |
| S10 | Add backend | dialog | dialog recipe | kind: managed / http / chat role; http URL live-classified on vs off machine |

## Cited rules driving the design

- **Visibility of system status** (Nielsen H1): managed status shows state + PID + RSS + uptime + last health (spec: managed-backends), and first-run start shows progress against the 120 s budget.
- **Match between system and real world** (H2): the switch is titled by its effect ("Where data may go"). The description states where text goes in each position. It is not labelled with the config key.
- **Error prevention** (H5): off-machine backends are disabled in pickers and Test, not refused after the fact. Incompatible backends are hidden by default. Enforce needs a confirm that names backend and model (spec: per-consumer Test).
- **Help users recover from errors** (H9, NN/g error-message guidelines): each callout says what happened and gives the fix. Examples: no-usable-backend offers two actions, 409 offers Reload, uv missing shows the install command, Windows suggests an HTTP endpoint.
- **Recognition over recall** (H6): presets show their chain inline. Consumers show the declared `requires`, fixtures path and calibration state, so the user doesn't need to open files.
- **Progressive disclosure** (NN/g): consumers collapse to one line (id, policy, chain source, mode). "Show incompatible" is opt-in.
- **Hick's Law** (lawsofux.com/hicks-law): the consumer picker lists only compatible backends by default and shows a count of the hidden ones.
- **Consistency** (H4 + Jakob's Law): the chain editor follows blackhole's `ChainEditor`, and the switch follows the WAI-ARIA APG Switch pattern. Save uses the host Save Bar, except key entry, which saves on its own and says so.
- **Color not the sole channel** (WCAG 1.4.1, contract invariant 4): egress badges use an icon and words; managed status uses a shape and words (StatusShapeBadge pattern); chain entries that can't be used are struck through and give a reason in text.
- **Target size** (WCAG 2.5.8 + contract): at 375 px every control is ≥ 24 px and icon buttons are 44 × 44.

## Test results (`node ux-probe.cjs <url> <outDir>`, run from repo root)

SCORE **68/68**. That covers 34 checks × 2 themes, plus 2 at 375 px.

- axe WCAG 2.2 AA: 0 violations in base, hosted warning, 409 bar, incompatible shown, confirm dialog, uv missing and add-dialog states, dark and light.
- Test-plan rows exercised: F1 dirty bar · F2 409 · F3 gating + warning · F4 filter + reveal · F5 password input, cleared after submit, key absent from DOM, env has no overwrite control · F6 results + confirm names backend/model, cancel writes nothing · F7 llm warning · F8 keyboard (reorder keeps focus on the moved item, dialog trap/Escape).
- 375 px: no horizontal overflow, no target < 24 px. Console clean.

The probe caught one bug, now fixed: after moving an item to the top, focus fell to "Add to chain". It now stays on the moved item's other arrow.

## Spec gaps surfaced by the mockup

Resolved into `specs/system-one-settings-ui/spec.md` and design D13 (1–4, and 5 as read-only display). Threshold derivation stays a design Open Question.

1. **Is `@fast` on-machine?** The no-usable-backend warning and the `llm` egress badge need `LlmCaller.isLocal(role)` on the client. `GET /api/system-one/config` (or a status route) must return the classification per backend. The spec only defines it inside the adapter.
2. **Override seeding.** "Override for this consumer" starts from the preset chain *minus* backends incompatible with that consumer. The spec is silent on this.
3. **Test on a stopped managed backend.** The mockup disables it ("not running"). The spec only forbids off-machine backends.
4. **Managed Start/Stop/Log are immediate**, like key entry, and are not Save Bar sources. The spec doesn't say.
5. **Thresholds** in the save-calibration panel are shown read-only, derived from the run. The spec doesn't define how they're derived or whether they're editable.
