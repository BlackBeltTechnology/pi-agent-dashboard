---
name: project-init
description: >
  Scaffold an unconfigured directory into a configured pi project. Interactive,
  profile-driven: lists project profiles (coding, docs, plus user profiles),
  asks which to use, previews the planned writes, and on confirmation writes
  AGENTS.md, .pi/settings.json (with a worktreeInit hook + toolset), and prompt
  files. Use when a bare directory needs turning into a working pi project, or
  when the dashboard's "Initialize" button spawns this session.
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

### 3b — Ask about OpenSpec init (coding profile only)

**Gate: only when the selected profile is `coding`** (skip for `docs` / any
OpenSpec-off profile), mirroring Steps 4b and 5. Skip the prompt entirely when an
`openspec/` directory already exists in the target (idempotent — treat as
already-initialized). Otherwise ask with `ask_user` (confirm):

> Initialize OpenSpec for this project? Runs `openspec init --tools pi`, which
> creates the `openspec/` scaffold and wires the OpenSpec commands into pi.

Record the answer as `OPENSPEC_INIT`. The actual run happens in Step 6.

### 3c — Preview + confirm

List exactly what you will write, then ask the user to confirm (`ask_user`
confirm). The writes for profile `<p>` are:

- `./AGENTS.md`            ← `<skill>/profiles/<p>/AGENTS.md.tmpl` (substitute `{{PROJECT_NAME}}` with the directory basename)
- `./.pi/settings.json`    ← `<skill>/profiles/<p>/settings.json.tmpl`
- `./.pi/prompts/*.md`     ← each file in `<skill>/profiles/<p>/prompts/`

When `DOX_ENABLED` is true, ALSO name in the preview:

- the DOX doctrine seed appended to `./AGENTS.md` (see Step 5)
- the kb toolset flip written to `./.pi/dashboard/knowledge_base.json`

When `OPENSPEC_INIT` is true, ALSO disclose the side effect (see Step 6) — NOT a
plain file write:

- runs `openspec init --tools pi`, scaffolding `./openspec/` and wiring pi

When the chosen profile is `coding`, ALSO disclose the possible side effect (see
Step 4b) — NOT a file write:

- may offer to `pi install` the `eng-disciplines` skills **user-globally**
  (writes `~/.pi/agent/settings.json`). This is machine-wide: the skills become
  available in **all** projects on this machine, not just this one. Always
  opt-in via a separate prompt; never forced. Needs Node/npm on the machine
  (the install runs `pi install npm:…`); the scaffolded repo itself gains no
  dependency.

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

## Step 5 — DOX doctrine seed (only when `DOX_ENABLED` is true)

> Gated on the user's Step 3a answer (`DOX_ENABLED`), NOT the raw `profile.json`
> `dox` flag — the flag only supplied the default. Skip this step entirely when
> the user declined DOX.


The canonical doctrine ships once at `<skill>/dox-doctrine.md`. Do NOT copy the
whole file. Seed a single block into `./AGENTS.md` **only when it does not
already carry the marker** `<!-- dox-doctrine -->` (idempotent — if the marker
is present, skip this step entirely).

Compose the seeded block as:

1. The marker line `<!-- dox-doctrine -->`
2. The WRITE discipline — the text between `<!-- dox:write:start -->` and
   `<!-- dox:write:end -->` in `dox-doctrine.md`.
3. ONE READ discipline variant — **skip this item entirely when the chosen
   profile's `AGENTS.md.tmpl` already embeds a `## Finding docs (READ
   discipline)` section** (the shipped `coding` profile does; seeding it again
   would duplicate the gate). Seed only the WRITE discipline in that case.
   Otherwise:
   - If the kb toolset is wired (this profile writes
     `knowledge_base.json` with `indexAgentsFiles`/`directoryLevelAgents`),
     use the text between `<!-- dox:read:kb:start -->` and
     `<!-- dox:read:kb:end -->` (references `kb agents` / `kb_search`).
   - Otherwise use the text between `<!-- dox:read:manual:start -->` and
     `<!-- dox:read:manual:end -->` (manual chain-walk; no kb references).

Strip the delimiter comments from the seeded text. Append the block to
`./AGENTS.md`.

Then write `./.pi/dashboard/knowledge_base.json` (when absent) enabling the
directory-level AGENTS.md toolset:

```json
{
  "sources": [{ "kind": "filesystem", "ref": "." }],
  "indexAgentsFiles": true,
  "directoryLevelAgents": { "enabled": true }
}
```

## Step 6 — Run OpenSpec init (only when `OPENSPEC_INIT` is true)

Gated on the user's Step 3b answer (`OPENSPEC_INIT`); this only becomes true for
the `coding` profile when no `openspec/` dir pre-existed. Mirrors Step 4b's
side-effect pattern — opt-in, verified, never forced.

**Run** (always non-interactive so it never hijacks the conversation):

```bash
openspec init --tools pi
```

The `--tools pi` flag pins the wiring to pi and skips OpenSpec's interactive tool
picker. Verify exit 0 and that `./openspec/` now exists. On success, tell the
user OpenSpec is wired (the `coding` AGENTS.md already documents
`openspec change new <name>`). On non-zero exit (or a missing `openspec` binary),
warn the user and point them at `openspec init --tools pi` to run manually — do
NOT error the init; the scaffold is already written.

**Idempotent re-run:** if `./openspec/` already existed, Step 3b never asked, so
`OPENSPEC_INIT` is false and this step is skipped — no clobber.

## Step 7 — Done

Confirm what was written. Writing `worktreeInit` flips the directory to
"configured": the next dashboard **Initialize** click runs the hook (change-A)
instead of re-launching this skill. Tell the user they can click Initialize
again to run `npm ci` (or the profile's hook).
