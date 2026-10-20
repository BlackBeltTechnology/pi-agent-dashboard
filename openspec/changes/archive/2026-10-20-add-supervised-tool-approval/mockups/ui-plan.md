# UI plan — add-supervised-tool-approval

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`.
Board: `index.html` (serve the `mockups/` dir). Toolbar: theme (base dark / base light / nord dark), frame (375 / 768 / full), view (both / as-built / proposed).

| File | Purpose |
|---|---|
| `index.html` | Board: A mode control (5 states), B approval card (8 states), C settings section (2 states). Change-local recipes inline, tokens only. |
| `tokens.css` | Copied from `align-ui-contract-recipes` (generated from `index.css` + nord dark). |
| `mockup.css` | Copied from `align-ui-contract-recipes` (board chrome + contract button/pill/panel recipes). |
| `probe.js` | Contrast + size probe (`tests/e2e/helpers/computed-contrast.ts` rules), copied from `add-tailscale-cert-tls`. `__probeAll()` → `{}` = pass. |
| `icons.js` | Generated from `@mdi/js`. |

## Surfaces → tokens → states

| Surface | Lands in | Tokens | States |
|---|---|---|---|
| A · Mode chip + menu | `CommandInput.tsx` settings row via `toolbarExtra` (beside thinking chip); folds into ⋯ below `@[44rem]` | chip: `--text-secondary`, hover `--bg-hover`; supervised: `--accent-soft` fill + `--accent` border + `--text-primary`; menu: `p-panel`/`p-opt` (`--bg-surface`, `--border-strong`, `--accent-primary` inset tick) | a-full · a-menu · a-supervised · a-mobile · a-gateway |
| B · `ToolApprovalCard` | `interactive-renderers/ToolApprovalCard.tsx`, chosen by a `SelectRenderer` branch on `metadata.kind` (design D3); same shell as `ConfirmRenderer` (`bg-hover`, `border-secondary`, `rounded-lg`, `mx-4`) | badge `--severity-warning-*`; command `--bg-code` + `--border-subtle`; diff `--tint-green-*` / `--tint-red-*`; Allow once `--accent-solid`; Deny `tint-action-red`; countdown `--text-secondary` → `--severity-warning-fg` ≤ 30 s; resolved rows `--severity-{success,error,warning}-fg` | b-bash (vs as-built confirm) · b-edit · b-edit-open · b-write · b-agent · b-reason · b-expiring · b-pathgate (enriched path-gate prompt, D14) · b-resolved |
| C · Settings section | `SettingsPanel.tsx` Security tab, next to `AgentPathGateSection` (design D10) | `SelectField` / `NumberField` recipes; token chips `--bg-tertiary` + `--border-secondary`; error `--severity-error-fg` | c-section · c-invalid |

## Copy rules (spec "UI does not claim isolation", task 8.38)

- Never: "safe", "sandbox(ed)" as a claim, "isolated", "protected". "Not a sandbox" (negation) is allowed and used.
- Coverage caveat in the mode menu: agent tool calls only; the user's own `!` commands never ask (D1); YOLO never answers supervised approvals (D15).
- Card titles are verb questions: Run this command? / Edit this file? / Create|Replace this file? / Start a subagent?
- `Agent` card states that the subagent's own calls are not approved one by one (D2, Q5).
- Resolved rows name the surface (`answeredSurface`), never a person (D11).

## Interaction decisions

- Labels Allow once / Deny (path-gate parity). No preselection or autofocus; a stray Enter must not allow. No Cancel button (same meaning as Deny).
- Countdown uses the gate's single clock (D10, `supervised.approvalTimeoutSeconds`, default 120). Screen-reader announcement once at 30 s, not per tick.
- Deny with a reason: an inline textarea; the text becomes the block `reason`.
- Gateway-spawned session with the gateway guard active: toggle absent; static note "Gateway policy" with tooltip (D12, F11).
- Supervised approvals never appear in chat channels (D17); answered on dashboard or terminal only.
- Config key `supervisedMode.{default, timeoutSeconds, tools}` (design D10).
- ≤ 520 px card: buttons stretch to 44 px rows; body loses its 32 px indent.

## Resolved questions (user-approved 2026-10-19)

1. **Q1 — Session list indicator.** No Supervised badge in v1; a pending approval sets `awaitingToolApproval` → existing "Needs you" label + toast (design D16).
2. **Q2 — Diff default.** Collapsed by default with a +/− summary; expand on demand.
3. **Q3 — Timeout floor.** Minimum 10 s; lower values (incl. `0`) rejected. No "wait forever" (fail-closed).
4. **Q4 — Risky-tool editor.** Editable chips in Settings.

## Verification (this pass)

- `__probeAll()` → `{}` in base dark, base light, nord dark at 1440 and 375.
- Agent-browser screenshots checked (Playwright chromium missing for `score_mockup`).
