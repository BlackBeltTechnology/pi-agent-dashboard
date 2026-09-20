# UI plan — add-access-grant-dialog

Surfaces → tokens → states. Token authority is `packages/client/src/index.css`
(`:root` dark + `[data-theme="light"]`); shell authority is
`packages/client-utils/src/Dialog.tsx`. No raw hex in component work.

## Surfaces

| # | Surface | Spec it serves | New or modified |
|---|---|---|---|
| S1 | Grant dialog — **held** variant | `access-grant-dialog`, `file-read-containment` | new |
| S2 | Grant dialog — **deferred** variant | `access-grant-dialog`, `network-denial-ring-buffer`, `trusted-networks`, `server-cors` | new |
| S3 | Settings → Access — pending + verdicts list | `access-settings-tab` | modified (parent change ships the grant list) |
| S4 | Settings → Access — capability banners | `access-settings-tab` | modified |
| S5 | Settings → Access — prompting toggle row | `access-grant-dialog` | modified |
| S6 | YOLO indicator + activation card + auto-allow ledger | `access-grant-yolo` | new |

**Where each YOLO surface lives:** full activation card → Settings → Access page;
inline "stop asking" → the grant dialog (S1); pre-scoped action → the directory
settings page; active indicator → **sidebar header row 1** (compact pill beside
`TunnelButton`, conditional), session surfaces in scope, and the Access page —
three peers, no fallback ordering. The app-root banner stack was the alternative
and was not taken; `design.md` D13 names the resulting mobile gap.

## Reuse, not reinvention

S1/S2 are `Dialog` (`client-utils`) at `size="md"`, `icon` set, non-flush — so
they inherit `bg-black/60` backdrop, `z-dialog`, focus trap, `aria-modal`,
escape-stack dismissal, and the built-in ✕ for free. Verdict buttons are
`Dialog.Action` with existing intents: `neutral` for *Allow once*, `primary`
for *Allow always*, and `Dialog.Cancel` for *Deny*. **No new button component.**

## Token map

| Role | Token |
|---|---|
| dialog panel / page bg | `--bg-primary` |
| card, list row, subject chip | `--bg-tertiary` |
| badge, elevated control | `--bg-surface` |
| title | `--text-primary` |
| body | `--text-secondary` |
| label / meta | `--text-tertiary` |
| divider, control border | `--border-primary` |
| primary verdict | `--accent-primary` |
| held/waiting state | `--severity-info-bg` / `--severity-info-fg` |
| degraded (report mode, prompting off) | `--severity-warning-bg` / `--severity-warning-fg` |
| granted | `--severity-success-bg` / `--severity-success-fg` |
| denied / revoke | `--severity-error-bg` / `--severity-error-fg` |
| subject monospace | `--bg-tertiary` fill, `--text-primary` ink |

## States per surface

- **S1 held**: waiting (timer running) · settling · settled-by-another-client
  (dialog removes itself, no interaction) · expired.
- **S1 ancestor ladder**: rungs exactly as carried by the denial, **narrowest
  preselected**, no free-text entry, boundary stated under the last rung
  ("stops below your home directory" / "highest rung is the checkout root"). A
  denial with no ancestors renders no ladder control at all — not an empty or
  disabled one.
- **S2 deferred**: waiting · settled. **`Allow once` is absent**, not disabled —
  there is nothing in flight to allow once (spec: `trusted-networks`).
- **S3**: pending rows (answerable inline) · recent verdicts with the store each
  wrote · empty state.
- **S4**: host-gate `report` (held prompts unavailable) · prompting disabled ·
  both at once.
- **S6**: inactive (duration picker, nothing selected beyond the shortest) ·
  active (undismissable bar, countdown, End now) · env-activated (no countdown,
  "until the process ends") · ledger showing auto-allowed **and** the two things
  YOLO did not do — an out-of-scope path prompted normally, a forbidden subject
  refused, a network denial untouched.
  Severity is **warning**, never error: it is a deliberate operator state, not a
  failure.
- **S5**: off (default) · on · force-disabled by env var (toggle reads as off and
  is not interactive, with the env var named).

## UX rules this mockup is asserting

1. **The subject is the headline.** The path / CIDR / origin renders monospace at
   the top of the body, not buried in a sentence — the operator's whole decision
   is "is this subject mine?".
2. **The consequence is stated before the button.** Each dialog names the store
   an *Allow always* answer writes, so the persistent verdict is never a guess.
3. **`Allow always` is never the default focus** and carries no danger styling
   either — it is `primary` but sits *after* `Allow once`, so the least-privilege
   answer is the one the eye reaches first.
4. **Dismiss = deny**, stated in the dialog footer rather than implied.
5. **Held vs deferred is visible, not inferred.** A held dialog shows a live
   "request waiting" pill; a deferred one says the verdict applies to the next
   attempt. Same component, different truth.
6. **Degradation is announced, never silent.** S4 exists because a `report`-mode
   deployment silently losing held prompts is indistinguishable from a bug.
7. **Widening is offered, never invented.** The ladder shows only rungs the
   server computed from the denied real path; there is no box to type a
   directory into. The narrowest rung is preselected, so the default answer is
   always the least privilege, and the selected subject sits next to the answer
   buttons so a widened answer cannot be given with the subject off screen.
8. **YOLO is scoped in the same vocabulary as a grant.** Roots are picked from
   the identical ancestor ladder a denial offers — same rungs, same boundary,
   same denylist, still no free-text box. The session `cwd` is the default, so
   not choosing yields the narrow session. "Everywhere" exists as a distinct,
   never-preselected choice in warning colour, and an active session names
   **every** root in the indicator.
9. **The active-state signal is never single-homed.** The sidebar pill is the
   cheapest always-on surface (same row as `TunnelButton`, same class of fact),
   but it vanishes with the sidebar on mobile — so session surfaces in scope
   carry the same signal as a peer, not as a fallback. Nothing about YOLO is
   visible in exactly one place.
10. **The escape hatch sits where the annoyance is.** "Stop asking in this folder"
   lives inside the prompt — as a dashed secondary affordance, never a fourth
   footer button — because the alternative route from *annoyed* to *relief* is
   clicking `Allow always`. It reuses the ladder already on screen and says
   outright that the denial in hand still needs an answer.
11. **Folders accumulate; they never become “everywhere.”** A live session can
   take a second folder — shown with its add time and an explicit *timer
   unchanged* note, because adding must not renew the countdown. The activation
   card says outright that adding never promotes to unscoped.
12. **YOLO shows its own limits.** The ledger deliberately lists a refused
   `~/.ssh` and an untouched network denial next to the auto-allows, so the
   scope of the mode is visible from the surface rather than only in the docs.
13. **A prompt-free path always exists.** Every pending request is answerable in
   S3, so the feature works with prompting disabled and is not the only road to
   a grant.
