# Close the project-init → Initialize handoff with a bus-client spawn+verify (optional, degradable)

## Why

`project-init` scaffolds a bare directory into a configured pi project: it writes
`AGENTS.md`, `.pi/settings.json` (with a `worktreeInit` hook), prompts, and
optionally seeds DOX / runs `openspec init`. When it finishes it writes the
`worktreeInit` hook and **stops** — the directory flips from state ①
(unconfigured) to state ② (configured + hook, unprovisioned) in the
`distinguish-initialize-actions` model. Provisioning (`npm ci`, the kb index the
worktree-init hook triggers, openspec wiring) only happens on the **next human
Initialize click**.

So a fresh scaffold today ends on a dead-end instruction: *"click Initialize
again to run the hook."* Two structural costs:

1. **Two clicks for one intent.** The user asked to set up a project; they get a
   half-set-up project plus a manual step. Nothing verifies the scaffold actually
   produces a working session — a malformed hook (`project-init` already warns
   about this failure mode) is only discovered on that second click.

2. **The bus-client makes the second click scriptable, and it already shipped.**
   `@blackbelt-technology/pi-dashboard-bus-client` (archived
   `add-dashboard-bus-client-scripting`, v0.5.4) exposes exactly the surface this
   handoff needs: `connect()` → `spawn({ cwd })` → `until(sid, "idle")`. Since
   `project-init` runs **inside a dashboard-spawned session**, the bus is already
   there — a loopback `connect()` succeeds without new auth.

The capability we want — *"after scaffolding, provision-and-verify the new
project in the same pass instead of leaving a second manual click"* — is a thin,
optional orchestration step on top of the client the app already runs on.

### Explicit non-mechanism: indexing / openspec-init do NOT move onto the bus

This change does **not** route kb indexing or `openspec init` through the bus,
and cannot:

- **kb indexing is not a bus verb.** It is a `kb-extension` worktree-init hook
  (`reindexNow`, debounced, hash-gated). The bus-client's plugin passthrough only
  recognizes `KNOWN_PLUGIN_HANDLERS = ["goal"]`; `plugin("kb", …)` throws
  `NoPluginHandlerError`. The kb-toolset-flip verb (`plugin_config_write`) is on
  the client-intercepted **denylist** (REST-only).
- **`openspec init` is a CLI scaffold**, not a dashboard action; no verb models it.

Indexing and openspec wiring still happen — **inside the `worktreeInit` hook that
the bus-triggered provisioning runs**, exactly as they do on a manual click. The
bus's only job is to *trigger provisioning and await readiness*. This keeps
indexing/openspec in the hook/CLI layer where they belong and avoids inventing
verbs (which `add-dashboard-bus-client-scripting` explicitly forbade).

## What Changes

Add an **optional, opt-in, degradable** final step to the `project-init` skill —
"provision & verify" — gated on a reachable dashboard bus.

- **`project-init` gains Step 8 (provision + verify).** After the scaffold is
  written and the `worktreeInit` hook validated, if the user opts in AND the bus
  is reachable, `project-init` runs a small typed `.ts` helper that:
  1. `connect()` to the local dashboard bus (loopback ticket).
  2. triggers provisioning of the freshly-configured directory (run the
     `worktreeInit` hook) — mechanism bounded in `design.md`.
  3. `until(sid, "idle")` — awaits the provisioning session to finish.
  4. reports **"configured AND provisioned"** (or surfaces the hook's failure)
     instead of "click Initialize again."

- **Ship the helper in the skill.** A single
  `scripts/provision-and-verify.ts` under the `project-init` skill dir, importing
  the bus-client package. Invoked via the skill's existing `bash` step, not a new
  tool.

- **Strict degradation.** When `connect()` throws (`OffBoxError`,
  `connect-failed` — bare `pi` terminal, no server, off-box) the step is skipped
  silently and the skill falls back to today's Step 7 message. The bus path is
  **never** required; the standalone-terminal scaffold flow is unchanged.

- **Opt-in, idempotent.** A dedicated `ask_user` confirm gates the step (default
  no). Re-running `project-init` on an already-provisioned directory detects the
  provisioned state and skips.

## Non-Goals

- **No kb / openspec-init / pi-install over the bus.** Those stay hook/CLI (see
  above). No new plugin handlers, no new verbs.
- **No change to the `distinguish-initialize-actions` button model.** The
  `ProjectInitButton` / `WorktreeInitButton` split and the three-state
  `init-status` API are untouched. This change acts *after* a project-init session
  is already running.
- **No off-box scripting.** Loopback-only, matching the bus-client MVP. Off-box
  needs device pairing (out of scope).
- **No `docs` profile change.** `docs` has no `worktreeInit` build hook; the step
  is a no-op there.

## Discipline Skills

- `security-hardening` — the step mints a WS ticket and triggers execution of a
  repo-declared (possibly untrusted) `worktreeInit` hook; verify the loopback
  guard + opt-in gate do not widen the trust boundary the Initialize model
  established.
- `doubt-driven-review` — the provisioning-trigger mechanism (bus spawn vs REST
  worktree-init endpoint) is a cross-boundary choice; review before it stands.
- `observability-instrumentation` — a scripted provisioning trigger needs enough
  reporting that a user can tell whether the hook ran, passed, or failed.
