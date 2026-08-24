---
session: 019f4460
week: 2026/W28
type: other
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (8 user prompts)"
upgrade_status: pending
---

# How we did it: Install the invoice-bot pi extension — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a one-liner: *"Install the pi-invoice-bot checkout as extension to pi"*. The
real objective, once the follow-ups clarified it, was broader: register the local
pi-package `@blackbelt-technology/invoicebot` **globally** so its LLM tools (`ib_query`,
`ib_review`, `ib_setup`, `ib_rules`) and Hungarian invoice skills load in every pi
session — *without* breaking the already-installed global `@blackbelt-technology/pi-flows`
engine — then verify it loads, restart the dashboard so live sessions pick it up, and
finally document the install method in this repo's `docs/`.

## 2. TL;DR playbook

1. **Inspect the package first.** `ls -la pi-invoice-bot && cat ../pi-invoice-bot/package.json` — confirm it's a local pi-package and check whether `node_modules` exists.
2. **`npm install` inside the package.** Local-path pi installs do **not** auto-run it, and invoicebot needs its bundled `file:../pi-flows` dependency: `cd ../pi-invoice-bot && npm install`.
3. **Register globally with an absolute path.** `pi install <invoicebot-checkout>` — writes the entry into `~/.pi/agent/settings.json`.
4. **Smoke-test headless.** From `/tmp`: `timeout 60 pi -p "List your tools that start with 'ib_', then stop."` — confirms the extension loads and tools resolve.
5. **If tools collide, filter the bundled pi-flows.** Convert the settings entry to object form so invoicebot loads only its own extension and reuses the existing global pi-flows: `"extensions": ["!node_modules/**"]`.
6. **Re-run the smoke test** — `ib_query/ib_review/ib_setup/ib_rules` should now register cleanly.
7. **Restart the dashboard** so live sessions get it: `curl -X POST http://localhost:8000/api/restart`, then poll `/api/health` until `ok` and a stable PID.
8. **Document it** via a general-purpose subagent (caveman style) into `docs/<topic>.md` + a `docs/AGENTS.md` index row; commit **only** the doc files.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & scope.** The AI read the package dir and `package.json`, noticed
there was no `node_modules` and that the bundled `pi-flows` dep needed installing, then
paused to confirm scope (global vs project). *Why it worked:* it surfaced the two
non-obvious facts (missing deps, local-path installs skip `npm install`) before acting.
**Decision point:** the human chose **global**.

**Phase 2 — Install & first smoke test.** `npm install` in the package, then
`pi install <abs-path>`, then a headless `pi -p` probe from `/tmp`. The probe immediately
exposed a **load conflict**: a standalone global `@blackbelt-technology/pi-flows` was
already registered, and invoicebot bundles its own copy that re-registers the same
`flow_*`/`ask_user`/`skill_read` tools.

**Phase 3 — Fix the conflict.** The AI converted the settings entry to object form with
`"extensions": ["!node_modules/**"]`, so invoicebot loads only its own extension and reuses
the existing pi-flows engine. A re-run confirmed the four `ib_*` tools registered with no
errors. *Why it worked:* it treated the smoke test as the source of truth and made the
**minimal** config change rather than uninstalling the global pi-flows.

**Phase 4 — Verify running system.** Steering prompts ("check is it running", "is the
invoice-bot extension?") drove `/api/health` probes: dashboard up (PID, mode, uptime,
bridge count), `flows` plugin loaded. The AI clearly distinguished a **pi extension**
(loads into agent sessions, tools into the model) from a **dashboard plugin** (renders UI,
appears in `/api/health` `plugins[]`).

**Phase 5 — Restart.** "restart pi-dashboard server" → `POST /api/restart`, then polled
health until a stable new PID (no restart loop) and all 13 bridges reconnected.

**Phase 6 — Document & commit.** The AI routed the doc write through a general-purpose
subagent in caveman style (per repo protocol — main agent never edits `docs/` directly),
added the `docs/AGENTS.md` index row, then committed **only** the two doc files, explicitly
excluding unrelated pre-existing changes.

## 4. Prompts that worked

- **Goal prompt** — *"Install the pi-invoice-bot checkout as extension to pi"*. Concise and
  actionable; it named the exact path. It *would* have been stronger with the scope baked in:
  *"Install the pi-invoice-bot checkout globally as a pi extension; it bundles pi-flows which I already have installed globally — don't double-register."*
- **High-leverage follow-ups:**
  - *"Save the installation method to docs"* — turned a one-off fix into a durable artifact.
  - *"is the invoice-bot extension?"* — forced the useful extension-vs-plugin clarification.
  - *"commit"* → *"commit staged files"* — kept the commit scoped to the real change.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Proceed before confirming install scope | (AI paused and asked) — good instinct; reinforce it | State **global** vs **project** in the goal prompt |
| Conflate `flows-plugin` (in-repo dashboard plugin) with `pi-flows` (external engine) | *"Is flows-plugin lives outside dashboard project?"* | Name both explicitly; the extension depends on the **external** `pi-flows` |
| Leave "installed" unverified | *"check is it running"* / *"restart pi-dashboard server"* | Always end an install with a headless smoke test + health poll |
| Risk sweeping unrelated working-tree changes into the commit | *"commit"* then *"commit staged files"* | Inspect `git status` and stage **only** the files you authored |

## 6. Skills, tools & memory created — and why they're effective

Two **memories** were saved (no skill):

- **tool-quirk / failure memory** — *invoicebot fails to load when the standalone global
  `@blackbelt-technology/pi-flows` is also installed, because its bundled pi-flows
  re-registers the same tools.* Reusable because this collision is invisible until a
  headless smoke test, and the fix is a specific one-line settings filter.
- **install-procedure memory** — *(1) `npm install` in the local package first (local-path
  pi installs skip it), (2) `pi install <abs-path>` to register globally, (3) filter the
  bundled pi-flows with `"extensions": ["!node_modules/**"]` if pi-flows is already global.*
  Effective because it removes all three failure modes from the next attempt.

**Recommend creating a skill** if this recurs for other bundled-dependency pi packages: a
generic *"install a local pi-package that bundles an already-global dependency"* procedure
(inspect → npm install → pi install → smoke test → filter node_modules → restart).

A **general-purpose subagent** was spawned for the doc write, honoring the repo rule that
all `docs/` writes go through a subagent in caveman style — keeps the main agent out of
`docs/` and the prose style consistent.

## 7. Pitfalls & dead ends

- **`pi install` doesn't `npm install` local paths.** If the package's bundled deps are
  missing, load fails silently — run `npm install` in the package first.
- **Duplicate pi-flows tool registration.** If `ib_*`/`flow_*` tools don't appear or the
  session errors on load, a global `pi-flows` is clashing with the bundled copy → set
  `"extensions": ["!node_modules/**"]` on invoicebot's settings entry.
- **Extension ≠ dashboard plugin.** Don't expect invoicebot in `/api/health` `plugins[]`;
  it loads into agent sessions, not the dashboard UI. It also loads **per-session at start**,
  so existing sessions won't have it until `/reload` or a restart.
- **Commit hygiene.** The working tree held unrelated changes (`.pi/settings.json`
  `editFlow` flag, generated `plugin-registry.tsx`, stray `b05_*.txt`). Stage only your own
  files — inspect `git status --short` and `git diff` before `git add`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** absolute path to the local package; knowledge of whether its
bundled deps are already installed globally; dashboard running on `localhost:8000`.

- [ ] `ls -la <pkg> && cat <pkg>/package.json` — confirm it's a pi-package
- [ ] `cd <pkg> && npm install`
- [ ] `pi install <absolute-path>`
- [ ] `cd /tmp && timeout 60 pi -p "List your 'ib_' tools, then stop."`
- [ ] If tools collide → add `"extensions": ["!node_modules/**"]` to the settings entry, re-test
- [ ] `curl -X POST http://localhost:8000/api/restart` → poll `/api/health` for stable PID
- [ ] Doc write via subagent (caveman style) → `docs/<topic>.md` + `docs/AGENTS.md` row
- [ ] `git add` **only** the doc files → commit

**Artifacts produced:** edited `~/.pi/agent/settings.json` (global package entry);
`docs/install-invoice-bot-extension.md`; `docs/AGENTS.md` index row; commit `3b87174cd`.

---

_Generated from session `019f4460` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-09. Source extract: deterministic facts sheet._
