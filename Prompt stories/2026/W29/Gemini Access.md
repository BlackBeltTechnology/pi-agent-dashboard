---
session: 019f6161
week: 2026/W29
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [add-google-oauth-provider]
proposal_excerpt: "Gemini (Google Workspace / Google account) is currently only reachable in pi via a hand-created static API key. Users want to authenticate through the system browser (\"Login with Google\") and have pi call Gemini with…"
---

# How we did it: Browser-based Google OAuth for the Gemini provider — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **`openspec-explore` mode** — a thinking stance, not an
implementation task. The operator's real question surfaced through the first steering
turns: *"Can I authenticate to Gemini over the system browser ('Login with Google')
instead of pasting a hand-created static API key — and can pi/pi-dashboard drive that
OAuth handshake?"* The true objective was never "write code"; it was **to explore the
feasibility honestly, discover the right integration slot, and capture the design as a
validated OpenSpec change** ready to build later.

## 2. TL;DR playbook

1. **Enter explore mode** (`openspec-explore`) so the AI reasons and captures artifacts but does not implement.
2. **Ground the claim in vendor docs first** — fetch Google's live OAuth + API-key pages before theorizing about token flows.
3. **Force the reframe**: OAuth yields an *access token (Bearer)*, not an API key. Make the AI state that split explicitly.
4. **Map the repo's real integration surface** — grep pi's bundled `pi-coding-agent` / `pi-ai` sources for the auth/provider contract *before* designing anything custom.
5. **Discover the native slot**: pi ships a first-class `OAuthProviderInterface` (Anthropic/Copilot/Codex reference impls) + `authStorage {type:"oauth"}` with auto-refresh. Design *reuses* it — no hand-rolled flow.
6. **Scaffold the change** via `npx openspec` and write all four artifacts: `proposal.md → specs/…/spec.md → design.md → tasks.md`, validating after each.
7. **Commit only the change directory** (`git add openspec/changes/<name>/`), leaving unrelated working-tree edits untouched, with a `docs(openspec):` message.

## 3. How the collaboration unfolded

**Phase 1 — Ground the question (Discovery).** The AI's first instinct was to fetch
Google's docs rather than theorize. `ctx_fetch_and_index` hit a disk error, so it fell
back to `curl` into `/tmp`, then cleaned the temp HTML out of the repo. *Why it worked:*
grounding the answer in freshly-fetched vendor docs pre-empted a plausible-but-wrong
"OAuth gives you an API key" answer.

**Phase 2 — The reframe.** The AI delivered the key correction up front: *you cannot
OAuth your way to an API key.* API keys are static, minted by hand; browser OAuth mints
a 1-hour Bearer access token + a refresh token. Steering turn #1 ("What is OAuth
expiration of vertex?") pulled out the concrete lifetimes (access = 3600s; refresh = 7
days while the consent screen is in *Testing*, non-expiring in *Production/Internal*).

**Phase 3 — Feasibility of a browser-driving skill.** Steering turn #2 asked whether a
skill could drive the system browser + dashboard through the handshake. The AI read the
repo's own `browser` skill OAuth/SSO guidance and split the ask into three problems:
handshake (✅ easy — loopback + PKCE), driving the browser (⚠️ trap — just *open* the URL,
let the human click; never autofill Google's login), and the consent screen (⚠️
semi-manual, Google-gated).

**Phase 4 — Discover the native slot (the pivotal moment).** Steering turn #3 ("integrate
to settings/provider, hand over to auth-library") pushed the AI to grep pi's bundled
sources. Big finding: pi already bundles `google-auth-library` + `@google/genai`, and its
leaked `model-registry.ts` exposes a first-class `OAuthProviderInterface` with three
working reference implementations. The operator's instinct was the *intended* extension
point — no custom flow needed.

**Phase 5 — Capture as OpenSpec (Generate + Verify).** With "1" and "go on" the operator
unlocked scaffolding all four artifacts. The AI scaffolded via `npx openspec`, wrote
`proposal.md`, `specs/google-oauth-provider/spec.md` (5 requirements, WHEN/THEN),
`design.md` (D1–D5 + risks), and `tasks.md` (5 groups, 20 checkboxes, spike-first),
running `openspec validate` after each until **valid**. "commit" landed only the change
dir with a `docs(openspec):` message.

## 4. Prompts that worked

- **The goal prompt** (explore-mode preamble): effective because it set a *stance* —
  "think, don't implement, but you MAY capture OpenSpec artifacts." That single framing is
  what let the session end with a validated proposal instead of premature code.
- **"What is OAuth expiration of vertex?"** — a laser follow-up that forced concrete
  numbers (token lifetimes, consent-screen states) instead of hand-waving.
- **"integrate to settings / provider … hand over to auth-library. Maybe some spike"** —
  the highest-leverage prompt. It redirected the AI from "build a browser-automation skill"
  toward "find pi's existing provider slot," which flipped the whole design.
- **"1" / "go on" / "commit"** — minimal unlock tokens that advanced scaffolding →
  artifacts → commit once the design was agreed.

*Rewrite for next time:* replace the vague "Research" in turn #2 with **"Before designing,
grep the bundled pi-coding-agent/pi-ai sources for an existing OAuth/provider interface —
reuse it if one exists."** That gets to Phase 4 in one hop.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer feasibility from theory | fetch Google's live docs first | Say "ground in vendor docs before theorizing" in the goal prompt |
| Conflate "OAuth login" with "get an API key" | ask the expiration/token question | State the access-token-vs-API-key split up front as a known fact |
| Reach for a custom browser-automation skill | "integrate to provider / hand to auth-library" | Ask it to search for pi's native provider interface *first* |
| Consider autofilling Google's login form | (design chose to only *open* the URL) | Make "never autofill 3rd-party login; human clicks" an explicit non-goal |
| Risk committing unrelated working-tree edits | "commit" → AI staged only the change dir | Always `git add openspec/changes/<name>/`, never `git add -A` |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted — this was an **explore-then-capture** session whose
durable output is the OpenSpec change itself. The reusable asset is
`openspec/changes/add-google-oauth-provider/` (proposal + spec + design + tasks), which
encodes the through-line: *system-browser login → loopback+PKCE → `google-auth-library`
→ `registerProvider({ oauth })` → pi owns storage/refresh/`/login`/settings → Bearer
Gemini calls, no static key.*

*Recommended skill to create:* **"discover-pi-native-provider-slot"** — a short procedure
that greps the bundled `pi-coding-agent`/`pi-ai` sources for `OAuthProviderInterface`,
`authStorage`, and `registerProvider` before anyone designs a custom auth flow. It would
remove the ~15-minute grep-and-discover phase and prevent the "hand-roll OAuth" dead end.

## 7. Pitfalls & dead ends

- **`ctx_fetch_and_index` / `ctx_execute_file` disk errors** → fall back to `curl -sL --max-time`
  into `/tmp`, then delete any HTML copied into the repo before it pollutes git status.
- **`npx openspec change new …` failed** → the working CLI path was scaffold-then-inspect:
  `npx openspec new change <name>` (or manual dir + `.openspec.yaml`), then
  `npx openspec instructions <artifact> --change <name>` for each artifact's format, then
  `npx openspec validate <name>` to confirm. Validation *requires a spec delta* — a proposal
  alone won't validate; add `specs/<cap>/spec.md` with WHEN/THEN scenarios.
- **The "drive the browser through Google's login" trap** → don't. Open the auth URL and let
  the human click; only the loopback redirect catcher is yours to automate.
- **Committing everything** → the tree had unrelated edits (CommandInput, video-transcription,
  package-lock). Stage *only* `openspec/changes/add-google-oauth-provider/`.

## 8. Reproduce it faster — checklist

- [ ] Start in `openspec-explore` mode (think + capture artifacts, don't implement).
- [ ] Fetch Google's OAuth + API-key docs live (`curl` fallback if `ctx_fetch` errors).
- [ ] State the reframe: OAuth → 1-hour Bearer access token (+ refresh token), never an API key.
- [ ] Grep bundled `pi-coding-agent`/`pi-ai` for `OAuthProviderInterface`, `authStorage`, `registerProvider` — reuse the native slot.
- [ ] Scaffold the change; write `proposal.md`, `specs/<cap>/spec.md`, `design.md`, `tasks.md`; `openspec validate` after each.
- [ ] `git add openspec/changes/<name>/` only; commit with a `docs(openspec):` message.

**Inputs to have ready:** a Google Cloud project + OAuth consent screen (Testing vs
Production changes refresh-token lifetime); pi with bundled `google-auth-library` +
`@google/genai`. **Artifacts produced:** `openspec/changes/add-google-oauth-provider/`
(`proposal.md`, `specs/google-oauth-provider/spec.md`, `design.md`, `tasks.md`) — committed
on `develop` (5 files, +183). Start building from `tasks.md §1` (the spike).

---

_Generated from session `019f6161` · `pi-agent-dashboard` · 2026-07-14. Source extract: session-to-guideline facts sheet._
