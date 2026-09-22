# UX plan — prompt-driven provider sign-in

Mockup: `sign-in-pane.html` (all states on one page, `?theme=light` for light). Tokens copied verbatim from `packages/client/src/index.css` via `tokens.css`; no raw hex outside that file.

## Ground

Surface: the sign-in pane inside `ProviderAddDialog.tsx` (`AuthCodePane` / `DeviceCodePane`, lines ~347–470). Exact classes reused:

| Element | Shipped classes |
|---|---|
| body copy | `text-xs text-[var(--text-secondary)]` |
| primary button | `px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium` |
| secondary button | `px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-secondary)]` |
| input | `w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] font-mono` |
| device code | `text-lg font-bold tracking-wider` + copy icon |
| error | `text-xs text-red-400` under the pane, `data-testid="dialog-flow-error"` |
| fallback link | `text-[11px] text-[var(--text-muted)] break-all` |

## The problem this pane must solve

The provider redirects the browser to `http://localhost:53692/callback?code=…` — a URL registered on the **provider's** side that we cannot change. When the dashboard is reached through zrok/docker/LAN, that redirect lands on the *user's* machine where nothing listens, and today the pane spins forever ("Waiting for authorization…"). There is no way to finish.

The fix is not a better redirect (impossible) but a **second door**: the paste field. pi-ai already races its callback listener against a `manual_code` prompt; the server surfaces it as `pending: { kind: "manual_code" }` and the pane renders it **beside** the link, not after a timeout.

## Decisions

1. **Link and paste field are shown together, from the first poll.** Not "wait 30 s then offer paste". A remote user does not know they are remote; the pane must not make them diagnose it. Nielsen #1 *visibility of system status*, #9 *recognize and recover* — the recovery path is on-screen before the error happens. (`provider-auth-ui` › "Remote browser completes via paste")

2. **The paste instruction names the exact symptom the user will see.** "If the browser ends on a page that will not load, copy its address and paste it here." The user's mental state at that moment is *"it broke"*; the copy must match that, not say "callback URL". Nielsen #2 *match between system and real world*.

3. **Same-host success still auto-completes**; the paste field is a parallel door, never a required step. Pasting nothing is fine. The field accepts either the full URL or the bare `code` (pi-ai `parseAuthorizationInput`), so no format instruction is shown beyond the placeholder. Postel's law at the UI layer.

4. **The auth link is always a visible, copyable link — never only `window.open`.** Pop-up blockers and remote browsers both need it. Shipped fallback copy ("If the browser did not open, use this link:") is kept verbatim. (F9)

5. **One field for `manual_code` and `text`, one button per option for `select`.** The pending union maps to exactly three widgets; the pane never branches on provider id. `select` renders each option as a button (Hick's Law: ≤3 options, no dropdown for 2 choices — GOV.UK radios/buttons guidance). Codex's "Browser login / Device code login" is therefore two buttons with one-line descriptions.

6. **`device_code` pane is unchanged in shape** (code, copy, explicit "Open" button — never auto-opened, per the existing "requires explicit user action" requirement) and now serves every device-code provider. Adds the expiry countdown from `expiresInSeconds` (Nielsen #1).

7. **Cancel is a first-class action in every pending state** (`DELETE /flow/:id`). Today a stuck flow can only be abandoned by closing the dialog, which leaves it polling. Nielsen #3 *user control and freedom*.

8. **Start failure is a terminal state in the pane, not a poll.** 500 (port in use, names the port) and 504 (provider did not respond) render as an error row with *Try again*; no poll begins. (spec "Start failure is shown in the pane")

9. **Success row states what changed and where** ("Stored in `auth.json` on the server; connected pi sessions were notified"). For OpenRouter the expiry cell reads *No expiry* instead of a relative time (`expires: null`).

10. **Field is cleared after submit and disabled while the server is processing** (spec "manual_code text field cleared after submit"); a state-mismatch shows as the error row on the next poll, not inline.

## Accessibility notes

- Every input has a visible `<label>`; error rows use `role="alert"`; the countdown uses `aria-live="polite"`.
- Buttons ≥ 28 px tall in the dialog (shipped `py-1.5 text-xs`), which is the dialog's existing target size; no new smaller targets introduced.
- `text-red-400` on `--bg-tertiary` is the shipped error style; contrast verified in both themes in the scoring step.
- Colour is never the sole channel: success/error/pending rows each carry an icon + words.

## Out of scope for the mockup

Provider picker, API-key pane, custom endpoint pane — unchanged by this change.
