---
name: project-init
description: 'Scaffold an unconfigured directory into a configured pi project. Interactive, profile-driven: previews the planned writes, then writes AGENTS.md, .pi/settings.json and prompt files — optionally also a knowledge base, an openspec/ scaffold, and user-global ~/.pi/agent/settings.json. Use on a bare directory, or when the dashboard''s "Initialize" button spawns this session.'
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Project Init

Turn the current directory into a configured pi project through a guided,
conversational flow. You are running as a first-class interactive session —
converse, confirm, and only write files after the user agrees.

**Target directory** = your current working directory (`cwd`). All writes land
there. All profile/doctrine paths below are relative to THIS skill's directory
(the folder containing this `SKILL.md`); call it `<skill>`.

## Step 1 — Resolve the available profiles

A profile is a directory bundle: `profile.json` (optional, carries
`description` + `dox`), `AGENTS.md.tmpl`, `settings.json.tmpl`, and
`prompts/*.md`.

Enumerate profiles from two sources, **user wins by name**:

1. Shipped: `<skill>/profiles/*`
2. User: `~/.pi/project-profiles/*`

```bash
ls -1 "<skill>/profiles" 2>/dev/null
ls -1 "$HOME/.pi/project-profiles" 2>/dev/null
```

Merge: a user profile of the same name fully shadows the shipped one. A
directory is only a usable profile when it contains BOTH `AGENTS.md.tmpl` and
`settings.json.tmpl`. Read each `profile.json` for its `description` and `dox`
flag (`dox` defaults to `false` when absent or unreadable).

## Step 2 — Ask which profile

Use `ask_user` (select) to present the resolved profiles by name +
description. Shipped defaults are `coding` (TDD/simplicity/surgical, OpenSpec
on, `npm ci` worktree-init) and `docs` (writing structure, OpenSpec off, no
build step).

## Step 2b — Resolve the technology stack (stack-aware profiles only)

When the chosen profile's `profile.json` has `"stackAware": true` (the shipped
`coding` profile does), its templates carry technology placeholders
(`{{INSTALL_CMD}}`, `{{TEST_CMD}}`, `{{BUILD_CMD}}`, `{{INIT_GATE}}`,
`{{INIT_COMMAND}}`) that must be filled from the project's stack — a coding repo
may be Node, Rust, Go, Python, Java, etc.

**Auto-detect + confirm:**

1. Detect a best guess from marker files in the target directory:

   | Marker file(s) | Stack | install / test / build | init gate + run |
   |---|---|---|---|
   | `pnpm-lock.yaml` | pnpm | `pnpm install --frozen-lockfile` / `pnpm test` / `pnpm build` | `test ! -d node_modules` / `pnpm install --frozen-lockfile` |
   | `yarn.lock` | yarn | `yarn install --frozen-lockfile` / `yarn test` / `yarn build` | `test ! -d node_modules` / `yarn install --frozen-lockfile` |
   | `bun.lockb` / `bun.lock` | bun | `bun install` / `bun test` / `bun run build` | `test ! -d node_modules` / `bun install` |
   | `package-lock.json` / `package.json` | npm | `npm ci` / `npm test` / `npm run build` | `test ! -d node_modules` / `npm ci` |
   | `Cargo.toml` | cargo | `cargo fetch` / `cargo test` / `cargo build` | `test ! -d target` / `cargo fetch` |
   | `go.mod` | go | `go mod download` / `go test ./...` / `go build ./...` | `test ! -f go.sum` / `go mod download` |
   | `poetry.lock` or `pyproject.toml`+`[tool.poetry]` | poetry | `poetry install` / `poetry run pytest` / `poetry build` | `test ! -d .venv` / `poetry install` |
   | `requirements.txt` / `pyproject.toml` | pip | venv+pip install / `.venv/bin/pytest` / `python -m build` | `test ! -d .venv` / venv+pip install |
   | `pom.xml` | maven | `mvn -q dependency:go-offline` / `mvn test` / `mvn -q package -DskipTests` | `test ! -d target` / `mvn -q dependency:go-offline` |
   | `build.gradle`(`.kts`) | gradle | `./gradlew dependencies` / `./gradlew test` / `./gradlew build -x test` | `test ! -d .gradle` / `./gradlew dependencies` |

   Prefer a JS lockfile over a plain `package.json`. A bare directory yields no
   guess.

2. **Confirm with the user** (`ask_user`): show the detected stack (or "none
   detected") and let them confirm or pick a different stack from the table.
   Never scaffold a stack-aware profile without a resolved stack.

3. Substitute the chosen stack's values for the `{{…}}` placeholders when
   writing the templates in Step 4. After writing, verify NO `{{…}}` placeholder
   remains in `AGENTS.md` or `.pi/settings.json` — an unfilled placeholder means
   the stack was not resolved; go back and ask.

## Step 3 — Ask about optional capabilities, preview, then confirm

### 3a — Ask about DOX (all profiles)

DOX seeds a directory-level documentation doctrine and wires the kb toolset (see
Step 5). It is now an **interactive choice on every profile**, not a fixed
per-profile switch. Ask with `ask_user` (confirm), pre-selecting the profile's
`dox` value as the DEFAULT answer:

> Enable DOX documentation doctrine? Seeds a directory-level AGENTS.md discipline
> into `./AGENTS.md` and enables the kb toolset. (default: `<profile.dox>`)

Record the answer as `DOX_ENABLED`. The `dox` flag in `profile.json` only sets
the default; the user's answer decides. Step 5 gates on `DOX_ENABLED`, not the
raw flag.

### 3b — Detect OpenSpec state (coding profile only)

**Gate: only when the selected profile is `coding`** (skip for `docs` / any
OpenSpec-off profile), mirroring Steps 4b and 5. Compute `OPENSPEC_MODE` — one of
`offer`, `repair`, `skip` — from the table below; **the first matching row wins**.
Run the checks in order and stop at the first match. The actual run happens in
Step 6.

`TARGET` is the absolute path of the directory being initialized.

**Dashboard config.** Read `~/.pi/dashboard/config.json` (the `openspec` object:
`enabled`, `offerInitialization`, `optOutDirectories`). An **absent file**, or an
**absent key** within it, takes the dashboard default: `enabled: true`,
`offerInitialization: true`, `optOutDirectories: []`. A file that exists but is
unreadable or not valid JSON, or a present `enabled` / `offerInitialization` of
the wrong type (non-boolean) or `optOutDirectories` that is non-array, is
undeterminable: **fail closed** (the server would silently use last-good values
the skill cannot see).

**Workflow-schema flag.** Also read `openspec.workflowSchema.defaultForNewProjects`
from the same file as `ENABLE_SCHEMA`. Only a literal `true` makes it true; an
absent file, key, or object — or any other value — is false. It never affects
`OPENSPEC_MODE` and is never a reason to fail closed. It is used only in the
`offer` flow (Steps 3c and 6).

**Opt-out match.** Compare `TARGET` against every `optOutDirectories` entry with
the dashboard's `pathKey` semantics: resolve to an absolute path, normalize
separators to `/`, strip trailing separators, and lowercase unless the platform
is `linux`. Run this exact one-liner — do not re-derive it:

```bash
OPT_OUT_JSON='["<each optOutDirectories entry as a JSON string>"]'   # '[]' when none
node -e 'const n=p=>{p=require("path").resolve(p);if(process.platform!=="linux")p=p.replace(/\\/g,"/").toLowerCase();return p.replace(/\/+$/,"")};console.log(JSON.parse(process.argv[2]||"[]").some(d=>n(d)===n(process.argv[1]))?"match":"no-match")' "$TARGET" "$OPT_OUT_JSON"
```

Worked example (`darwin`): target `/Users/x/Proj` vs entry `/users/x/proj/` →
`match`; vs `/Users/x/Other` → `no-match`. On `linux` the comparison is
case-sensitive: `/Users/x/Proj` vs `/users/x/proj` → `no-match`.

**Git placement** (only when `TARGET` is inside a git repository, i.e.
`git -C "$TARGET" rev-parse --is-inside-work-tree` succeeds; a non-git directory
is never skipped by this check). Fail closed — this is deliberately stricter than
the server's "failed probe = not in a repo":

- `git -C "$TARGET" rev-parse --path-format=absolute --git-dir --git-common-dir`
  fails (e.g. git < 2.31) → placement undetermined;
- the two printed paths differ after `realpath` → a linked worktree;
- `realpath "$(git -C "$TARGET" rev-parse --show-toplevel)"` differs from
  `realpath "$TARGET"` → a subdirectory of a checkout (the dashboard resolves
  skills at the checkout root, so repairing/verifying a subdirectory would
  diverge).

`--separate-git-dir` checkouts and submodules compare equal and are NOT skipped.

| # | Condition (first match wins) | `OPENSPEC_MODE` | Action |
|---|---|---|---|
| 1 | Dashboard config undeterminable (see above) | `skip` | No prompt, no command. Warn that OpenSpec state could not be determined. |
| 2 | `openspec.enabled === false`, or the opt-out one-liner printed `match` | `skip` | No prompt, no command. Note OpenSpec is disabled / opted out for this directory. |
| 3 | Git placement: undetermined, linked worktree, or not the checkout top-level | `skip` | No prompt, no command. Note why. |
| 4 | `./openspec/` absent AND `offerInitialization === false` | `skip` | No prompt, no command. |
| 5 | `./openspec/` absent | `offer` | `ask_user` (confirm): "Initialize OpenSpec for this project? Runs `openspec init --tools pi --force`, which creates the `openspec/` scaffold and wires the OpenSpec commands into pi." Declined → `skip`. |
| 6 | `./openspec/` present, `.pi/skills/openspec-explore/` absent | `repair` | **No question.** Disclosed in the Step 3c preview as a repair; the preview confirmation is the overwrite confirmation. |
| 7 | Both present | `skip` | No prompt, no command. |

The `repair` row covers a directory initialized for OpenSpec but never wired into
pi: the user already chose OpenSpec for it (and did not opt it out), so complete
the wiring rather than ask again. `offerInitialization === false` suppresses only
the `offer` (row 4), never the `repair`.

**Legacy artifacts** (needed for the Step 3c disclosure; detect only when mode is
`offer` or `repair`). The OpenSpec CLI cleans these up automatically under
`--tools`, so name each one found in the preview:

- root agent-config files `CLAUDE.md`, `CLINE.md`, `CODEBUDDY.md`, `COSTRICT.md`, `QODER.md`, `IFLOW.md`, `AGENTS.md`, `QWEN.md` — only when the file contains **both**
  `<!-- OPENSPEC:START -->` and `<!-- OPENSPEC:END -->` (the marker block);
- legacy command directories `.claude/commands/openspec`, `.codebuddy/commands/openspec`, `.qoder/commands/openspec`, `.lingma/commands/openspec`, `.crush/commands/openspec`, `.gemini/commands/openspec`, `.cospec/openspec/commands`;
- files starting with `openspec-` or `opsx-` inside these command-file
  directories: `.cursor/commands`, `.windsurf/workflows`, `.kilocode/workflows`, `.kiro/prompts`, `.github/prompts`, `.amazonq/prompts`, `.clinerules/workflows`, `.roo/commands`, `.augment/commands`, `.factory/commands`, `.continue/prompts`, `.agent/workflows`, `.iflow/commands`, `.qwen/commands`, `.codex/prompts`, `.opencode/command`, `.junie/commands`.

### 3c — Preview + confirm

List exactly what you will write, then ask the user to confirm (`ask_user`
confirm). The writes for profile `<p>` are:

- `./AGENTS.md`            ← `<skill>/profiles/<p>/AGENTS.md.tmpl` (substitute `{{PROJECT_NAME}}` with the directory basename)
- `./.pi/settings.json`    ← `<skill>/profiles/<p>/settings.json.tmpl`
- `./.pi/prompts/*.md`     ← each file in `<skill>/profiles/<p>/prompts/`

When `DOX_ENABLED` is true, ALSO name in the preview:

- the DOX pointer block appended to `./AGENTS.md` (see Step 5)
- the `doctrine` choice + kb toolset flip written to `./.pi/dashboard/knowledge_base.json`

When `OPENSPEC_MODE` is `offer` (confirmed) or `repair`, ALSO disclose the side
effects (see Step 6) — NOT plain file writes. For `repair`, label it explicitly as
a **repair** of an OpenSpec directory not yet wired into pi (no question was
asked; confirming this preview is the confirmation):

- runs `openspec init --tools pi --force` (scaffolding `./openspec/` for `offer`; wiring pi into the existing one for `repair`)
- writes the generated `openspec-*` skills under `./.pi/skills/`, **overwriting** any existing ones of the same name
- each legacy OpenSpec artifact detected in Step 3b, by path (e.g. `AGENTS.md` — the `OPENSPEC:START`/`OPENSPEC:END` marker block, or `.claude/commands/openspec/`), worded "may be removed"
- the OpenSpec CLI may also remove other legacy OpenSpec files it recognizes beyond the paths listed
- the OpenSpec CLI may migrate its global config profile (`~/.config/openspec`) — a machine-wide side effect

When `OPENSPEC_MODE` is `offer` (confirmed) AND `ENABLE_SCHEMA` is true (the
dashboard's `openspec.workflowSchema.defaultForNewProjects` is `true`), ALSO
list, as the last item, the follow-up that Step 6 performs: after a successful
init, request `POST /api/openspec/workflow-schema` with `{"cwd": TARGET,
"action": "enable"}`, which writes `openspec/schemas/pi-spec-driven/` and
`openspec/config.yaml`. Never list it for `repair` (switching an existing shared
project's schema is a team decision) or when `ENABLE_SCHEMA` is false or absent.

When the chosen profile is `coding`, ALSO disclose the possible side effect (see
Step 4b) — NOT a file write:

- may offer to `pi install` the `eng-disciplines` skills **user-globally**
  (writes `~/.pi/agent/settings.json`). This is machine-wide: the skills become
  available in **all** projects on this machine, not just this one. Always
  opt-in via a separate prompt; never forced. Needs Node/npm on the machine
  (the install runs `pi install npm:…`); the scaffolded repo itself gains no
  dependency.

Then name, last, the separate opt-in question of Step 4c — NOT a file write:

- will ask whether to set up this project's folder access: submits a request the
  dashboard operator approves line by line (via the `project-access` skill). Writes
  nothing itself; declining, a refusal or no answer never fails the init.

**Idempotency:** before writing, check whether `./AGENTS.md` or
`./.pi/settings.json` already exist. If they do, ask before overwriting — never
clobber silently.

## Step 4 — Write the scaffold

On confirmation, write the files listed above. Substitute `{{PROJECT_NAME}}`
in `AGENTS.md.tmpl` with the target directory's basename, and — for a
stack-aware profile — the stack placeholders resolved in Step 2b.

**Validate the hook.** After writing `./.pi/settings.json`, confirm its
`worktreeInit` is a valid change-A hook: a non-empty `gate` string plus a `run`
that is either `{ type: "script", command: "<non-empty>" }` or
`{ type: "agent", prompt: "<non-empty>" }`. If it is not valid, warn the user —
an invalid hook fails open (change-A ignores it) and the Initialize button will
loop back to this skill instead of running the hook.

## Step 4b — Ensure discipline skills (only when the profile is `coding`)

The `coding` template's `## Discipline Skills` checkpoint table references the
`eng-disciplines` skills. This step makes those references live. **Gate: run
only when the selected profile is `coding`** (skip for `docs` / any
OpenSpec-off profile), mirroring how Step 5 gates on `dox: true`.

**Detect** (read-only; both forms tolerate a missing `pi` binary):

```bash
pi list 2>/dev/null | grep -q pi-dashboard-eng-disciplines \
  || stat ~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-dashboard-eng-disciplines >/dev/null 2>&1
```

If `pi` is not on PATH and the stat misses, treat as ABSENT but do NOT error
the init — fall through to the footnote. (Known limit: the stat form only sees
the `npm:` global path; a `git:`/renamed install is invisible and would
re-prompt.)

**PRESENT** → skills already global. Skip the prompt (idempotent re-run) and
write NO activation footnote into `./AGENTS.md`. If a prior run left the
"not detected" footnote (e.g. the skills were installed after a decline),
remove that line before exiting so the file never claims the skills are missing
when they are present. Done.

**ABSENT** → `ask_user` (confirm):

> Install the discipline skills globally? They power the checkpoint table this
> project's AGENTS.md references, and become available in ALL projects on this
> machine. Writes `~/.pi/agent/settings.json` (user-global, not project-local).

- **Yes** → run `pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines`
  and verify exit 0. On success, write NO footnote. On non-zero exit (or a
  missing `pi`), fall through to the footnote path.
- **No / install failed** → append ONE line under the `## Discipline Skills`
  table in `./AGENTS.md`:

  > Discipline skills not detected — run `pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines` to activate the checkpoints above.

The footnote is **detection-conditional**: written only on the absent/declined
branch, never on the present/installed path (so a successfully-wired project
never carries a false "not detected" line). The install is always user-global
and never forced.

## Step 4c — Offer folder access (separate opt-in; never fails the init)

Runs after the scaffold is written (Steps 4/4b), for every profile. It asks the
operator's dashboard to pre-approve folders outside the project, through the
`project-access` skill's `provision` mode. Nothing here grants access: the
operator approves each line in the dashboard.

1. `ask_user` (confirm), as a question separate from the Step 3c confirmation:

   > Set up this project's folder access now? This asks the dashboard operator to
   > approve folders outside the project, line by line. Nothing is granted until
   > they approve.

   **Declined** → submit nothing; go to Step 5. The user can run `project-access`
   later.
2. **Accepted** → find the lines:
   - `./.pi/access.json` exists → read it per the `project-access` profile rules
     (version 1 only; an unknown `version` is refused — say so and treat it as no
     profile). Offer its lines, showing each path and reason.
   - otherwise → ask the user (`ask_user` input) to list folders to approve, or
     none. No folders and no remote goals → skip.
3. Follow `project-access` `provision` (its confirm, request, polling and refusal
   table) and report each line's outcome.
4. **Never fail the init.** A refused request, an `expired`/`dismissed` one or an
   unreachable dashboard is reported and the init continues. On `no-operator`,
   tell the user to open the dashboard and retry later with the `project-access`
   skill. Do not retry on your own, and never call the settle routes.

## Step 5 — DOX pointer seed (only when `DOX_ENABLED` is true)

> Gated on the user's Step 3a answer (`DOX_ENABLED`), NOT the raw `profile.json`
> `dox` flag — the flag only supplied the default. Skip this step entirely when
> the user declined DOX.

Do NOT copy any doctrine text. The per-turn DOX doctrine (READ + WRITE) is
injected by the `pi-dashboard-kb-extension`; the project's `AGENTS.md` carries
only a marker + pointer block. Tune it via `.pi/dashboard/knowledge_base.json`.

**1. Seed the pointer block.** Append it to `./AGENTS.md` **only when it does
not already carry the marker** `<!-- dox-doctrine -->` (idempotent — if the
marker is present, skip this step entirely):

```markdown
<!-- dox-doctrine -->

## DOX doctrine

Per-turn DOX doctrine — the kb-first READ discipline and the directory `AGENTS.md`
WRITE discipline — is injected by the `pi-dashboard-kb-extension`. Tune it in
`.pi/dashboard/knowledge_base.json` under the `doctrine` key (`inject`, `write`).
```

**2. Record the doctrine choice.** Read-merge-write
`./.pi/dashboard/knowledge_base.json` — read the file if present, set ONLY the
`doctrine` key, preserve every other key, write valid JSON. Since `DOX_ENABLED`
is true here, write:

```json
"doctrine": { "inject": "kb", "write": true }
```

When the file is absent, also enable the directory-level AGENTS.md toolset:

```json
{
  "sources": [{ "kind": "filesystem", "ref": "." }],
  "indexAgentsFiles": true,
  "directoryLevelAgents": { "enabled": true },
  "doctrine": { "inject": "kb", "write": true }
}
```

**3. Scaffold the directory `AGENTS.md` tree** (path-only rows):

```bash
kb dox init
```

**4. Offer `dox-describe`.** After the tree is scaffolded, ask the user
(`ask_user` confirm): "Fill the empty Purpose cells now with `dox-describe`?
(one subagent per `AGENTS.md`, plan-then-confirm, ≤50 rows per run)". On yes,
invoke the `dox-describe` skill (ships with `packages/kb-extension`); on no,
tell the user they can run it later.

## Step 6 — Run OpenSpec init (only on `repair`, or `offer` that was confirmed)

Gated on `OPENSPEC_MODE` from Step 3b: run only when it is `repair`, or `offer`
and the user confirmed. `skip` (any reason) runs nothing. For `repair` the Step 3c
preview confirmation already served as the overwrite confirmation. Mirrors Step
4b's side-effect pattern — disclosed, verified, never forced beyond that.

**Run** (always non-interactive so it never hijacks the conversation):

```bash
openspec init --tools pi --force
```

`--tools pi` pins the wiring to pi and skips OpenSpec's interactive tool picker;
`--force` is a belt-and-braces non-interactive guard (identical argv to the
dashboard's init endpoint). `openspec` resolves from PATH — on dashboard
machines that is the dashboard shim (`~/.pi/dashboard/openspec-shim/openspec`).

**Verify** exit 0 AND that `./.pi/skills/openspec-explore/` now exists (and
`./openspec/` for `offer`). On success, tell the user OpenSpec is wired (the
`coding` AGENTS.md already documents `openspec change new <name>`). On non-zero
exit, a missing `openspec` binary, or a still-missing skills directory, warn the
user, include the actual contents (`ls .pi/skills`), and point them at
`openspec init --tools pi --force` to run manually — do NOT error the init; the
scaffold is already written.

**Enable the `pi-spec-driven` workflow schema (only `offer`, only when
`ENABLE_SCHEMA` is true).** After a successful init (exit 0, verification
passed) in mode `offer` — the directory had no `openspec/` before — and only
when `ENABLE_SCHEMA` was true in Step 3b and disclosed in the Step 3c preview,
request the dashboard's enable flow, `POST /api/openspec/workflow-schema`:

```bash
pi-dashboard api POST /api/openspec/workflow-schema --port "${PORT:-8000}" \
  --data '{"cwd": "<TARGET>", "action": "enable"}'
```

`PORT` is `port` from `~/.pi/dashboard/config.json` (default `8000`). A
`success: true` response lists the paths it wrote in `data.written`; report them
in the summary (expect `openspec/schemas/pi-spec-driven/` and
`openspec/config.yaml`). Skip this step — silently, with no request — when the
user declined the `offer` (mode `skip`), in mode `repair`, and whenever
`ENABLE_SCHEMA` is false or absent. When the dashboard is unreachable, the call
fails, or it returns `success: false`, skip it, show the error if any, finish
the init, and tell the user they can enable the schema later from Settings →
OpenSpec → OpenSpec Workflow Schema. Do NOT error the init: the scaffold is
already written.

**Idempotent re-run:** a re-run after success lands in `skip` (row 7: both
`./openspec/` and `.pi/skills/openspec-explore/` present) — no prompt, no
command, no clobber. A re-run after a failed repair lands in `repair` again.

## Step 7 — Done

Confirm what was written, and the outcome of any Step 4c access request. Writing `worktreeInit` flips the directory to
"configured": the next dashboard **Initialize** click runs the hook (change-A)
instead of re-launching this skill. Tell the user they can click Initialize
again to run `npm ci` (or the profile's hook).
