# UX plan — keysync surfaces

Mockups: `provider-accounts.html`, `add-account.html`, `pool-admin.html`. Tokens lifted verbatim from `packages/client/src/index.css`; no raw hex outside `tokens.css`.

## Architecture these screens assume

keysync is a proxy: pooled provider sign-ins live on the server and never reach a member's machine. These screens therefore manage a **remote** pool, and nothing on them writes a credential locally. Two consequences shape the copy throughout:

- **There is no "checking" or "unverified" state.** The server issues every upstream call, so a rate limit is observed first-hand rather than reported by a client and verified afterwards. An earlier revision of these mockups carried an `Unverified` badge; it was removed because the state it displayed no longer exists.
- **Withdrawal is immediate, not TTL-bounded.** Unsharing and key revocation take effect at the affected member's next request, so the copy says "next request" rather than naming a delay.

## The central problem

Three attributes attach to one account row and look alike. Conflating them is the most likely failure on this screen.

| Attribute | Nature | Cardinality | Control shape |
|---|---|---|---|
| **Serving now** | derived; changes without the user | 1 per provider | green rail + pill — an *indicator*, never clickable |
| **Primary** | a preference | 1 per provider | radio — enforces "exactly one" structurally |
| **Shared** | a lending decision affecting others | any number | checkbox — independent per row |

Rendering all three as checkboxes would imply three independent booleans, wrongly suggest the user can set what is in use, and hide that primary is exclusive. Control shape carries the semantics before any label is read.

Grounding: Nielsen #6 *recognition over recall* — the legend states the three concepts once at the top rather than expecting users to infer them per row. Nielsen #4 *consistency and standards* — radios mean single-choice, checkboxes mean independent; the mapping is not reinvented here.

## Decisions per screen

### provider-accounts.html

- **The green rail is the answer to "what am I running on right now?"** — one glance, no reading. Nielsen #1 *visibility of system status*. Colour is not the only carrier: the rail is paired with a "Serving now" pill, so it survives colour-blindness and greyscale (WCAG 1.4.1 *use of colour*).
- **Provenance is always on the row** — "Yours" vs "Shared by Kata". Because selection mixes a member's own accounts with team ones and cannot distinguish them (design D3), a user must be able to see whose subscription is being spent without opening anything.
- **One exhaustion state, not two.** `Ran out · 38 min left` is a fact the server observed, so there is no provisional variant to distinguish it from. This is the visible half of dropping the `suspect` state.
- **Countdowns are concrete** ("38 min left") rather than relative-vague ("cooling"). Nielsen #1 again: a user deciding whether to wait or switch needs the number.
- **Team-owned rows disable the controls the viewer does not own** — the primary radio is disabled and sharing shows "Kata's". Nielsen #5 *error prevention*: an ineffective control is worse than an absent one.
- **A private account says so in words** ("not shared — only your sessions can use it") rather than relying on an unchecked box. An unchecked checkbox is ambiguous between "off" and "not applicable".
- **A dead account keeps its row** instead of vanishing, with the reason and a recovery action. A silently disappearing account reads as data loss.
- **The rotation switch states its own off-consequence** ("your session stops when it runs out") rather than being a bare labelled toggle. This is the one control on the page whose downside is invisible until it bites, so the cost is written next to it, not discovered later.

## The rotation switch, and why it has two failure modes on screen

Rotation is gated by an admin switch AND a member switch (design D14). That produces a state most toggle UIs get wrong: **a member's switch that is on but has no effect**, because an admin turned rotation off globally.

Rendering that as a normal checked box would be a straightforward lie about system state. The mockup instead shows the member control *disabled*, in the warning style, naming who turned it off and when — and stating that the member's own preference is preserved and returns when the admin re-enables. Three separate Nielsen heuristics converge here: #1 *visibility of system status*, #5 *error prevention* (an ineffective control is worse than an absent one), and #9 *help users recognise and recover* — a member seeing hard 429s needs the explanation on this page, not in a support conversation.

On the admin side the switch is deliberately worded as an incident control ("Use this if an account gets flagged") with its blast radius spelled out, because its purpose is to be found quickly by someone under pressure who has never used it before.

### The unshare confirmation

Unsharing is the only action on these screens whose consequences land on *other people*, so it is the only one gated by a confirmation.

- It **names the affected people** ("Kata and Bence are using this account right now") rather than warning abstractly. A generic "are you sure?" trains dismissal.
- It **states the consequence and the timing** — lost at their next request, switch to another account, and stop if none is available. That last clause is the part users would otherwise discover from a broken session. The timing is immediate here because there is no lease to expire.
- The safe option is worded as an action (*Keep sharing*), not *Cancel*, which is ambiguous about which state cancelling produces.

Grounding: Nielsen #5 *error prevention*, and the destructive-action convention of confirming by consequence rather than by generic prompt.

### add-account.html

The anxiety this flow must defuse is **"will signing in again destroy my current login?"** — a reasonable fear, since that is exactly what `/login` does normally. A second anxiety is specific to the proxy shape: *where does this credential end up?* Each state answers it explicitly rather than leaving the user to assume.

- The reassurance is **placed before the button**, not in a success message afterwards. It is only reassuring if it arrives before the risky click.
- Every state repeats the invariant in its own words — *nothing has changed yet*, *your existing accounts are unchanged*. Repetition is justified here because the user may only read one state.
- **The duplicate case is a first-class state**, not an error. Signing in with an account you already hold is a likely mistake (the browser is still logged in) and it deserves the actionable remedy: sign out in the browser first.
- **Failure states assert what did *not* happen.** After a failed capture the important fact is not the failure but that nothing was damaged.
- Share and primary offers appear **after** capture, not before, so the user decides with the account's identity visible. Deciding to share before knowing which account was captured invites mistakes.

### pool-admin.html

- **Keeper health is four numbers at the top**, including "Refresher: Running · sole writer · no rival instance" — surfacing the single-refresher invariant (design D7), whose violation is the highest-severity failure in the system and would otherwise be invisible until damage was done.
- **The pool section states the trust model in plain words**: "The keeper makes every upstream call itself, so it sees a rate limit first-hand." One sentence explaining why there is no verification step to look for.
- **The audit table reads as a narrative**, including the keeper's own actions alongside members'. Under the proxy, attribution is native — every forwarded request carries the key that authorised it — so the record is genuinely complete rather than reconstructed.
- Revocation is worded as **"Revoke key"** rather than "Revoke access", because that is literally the mechanism and it makes the immediacy credible.
- Revocation is offered per member with a visible revoked state and restore path — Nielsen #3 *user control and freedom*.

## Language

Implementation vocabulary is avoided in the member-facing UI: no *lease*, *projection*, *TTL*, *forward*, *credential*, *token*. Those are correct in `design.md` and wrong on screen. The UI says *serving now*, *shared by Kata*, *ran out*, *sign-in expired*, *stop sharing*. Nielsen #2 *match between system and the real world*.

The admin surface is allowed slightly more precision (*Cooling*, *Member keys*, *sole writer*) because its audience is the person who deployed the keeper.

## Deliberately rejected

- **A single "rotate now" button.** Rotation is a reaction to exhaustion, not a user chore. A manual control would invite pre-emptive rotation and burn accounts faster.
- **Showing token values, even masked.** Nothing on these screens requires them, and a masked secret still invites a reveal affordance.
- **A combined "account strength" or quota-percentage meter.** Providers do not publish remaining quota; any number would be invented. Only observed facts are shown — limited, verified, recovering.
- **Auto-sharing newly added accounts.** Sharing must be a deliberate act every time, so the checkbox starts unchecked in every state.
- **Toasts as the only switch signal.** A switch is shown inline and durably in the audit record; a toast alone would vanish before a user returned to their screen.
- **Framing a switch as a warning.** Under the proxy the request is re-sent on another account and succeeds, so the notice reports a fact ("nothing was lost") in the informational style rather than the warning style. Styling a successful recovery as a problem would train users to fear a mechanism that is working.

## Not yet resolved

- Where these surfaces live: extending the existing `ProviderAuthSection` versus a dedicated plugin settings page. The mockups are deliberately layout-compatible with the existing settings panel so either can be chosen without redrawing.
- How to surface models that pooled OAuth credentials cannot route (`model-proxy/oauth-compat.ts`). Currently unrepresented on any screen, and the likeliest source of an opaque failure for a member.
- Whether the accounts screen should show a keysync-unreachable state. Under this architecture an outage stops all work, and the screen that explains why is the one a member will open first.
- Whether a 429 that reaches the client *because* rotation is off deserves its own inline explanation, distinct from an ordinary rate limit. The two are indistinguishable to a member otherwise, and the remedy differs — one is waiting, the other is a setting.
- Whether a rotation notice belongs on the session card as well as in settings — it is session-scoped information appearing in a global surface.

## Verified

Captured at 375px and 1440px in both themes and corrected in place:

- **Account identity was truncating on mobile** (`robson@semmi...`). The email is the row's whole subject, so `truncate` was replaced with `word-break: break-word` — the row grows rather than hiding the one fact it exists to show.
- **Controls floated above the badges on mobile**, breaking reading order. Rows now stack as identity → status → detail → controls, with the control cluster divided by a hairline. The status rail stays vertical at every width.
- **Touch targets on the primary/shared controls were below 44px.** `min-height: 44px` on mobile only, so desktop density is unchanged.
- **Retired rows sat at `opacity: .65`**, which dipped body-text contrast in the light theme. Raised to `.8`, still visibly de-emphasised.

Severity and status colours derive from the `--severity-*` tokens, which are `color-mix` against `--text-primary`, so they re-resolve per theme rather than being restated.
