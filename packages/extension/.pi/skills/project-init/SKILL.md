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

## Step 3 — Preview the planned writes, then confirm

List exactly what you will write, then ask the user to confirm (`ask_user`
confirm). The writes for profile `<p>` are:

- `./AGENTS.md`            ← `<skill>/profiles/<p>/AGENTS.md.tmpl` (substitute `{{PROJECT_NAME}}` with the directory basename)
- `./.pi/settings.json`    ← `<skill>/profiles/<p>/settings.json.tmpl`
- `./.pi/prompts/*.md`     ← each file in `<skill>/profiles/<p>/prompts/`

When the chosen profile has `dox: true`, ALSO name in the preview:

- the DOX doctrine seed appended to `./AGENTS.md` (see Step 5)
- the kb toolset flip written to `./.pi/dashboard/knowledge_base.json`

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

## Step 5 — DOX doctrine seed (only when the profile has `dox: true`)

The canonical doctrine ships once at `<skill>/dox-doctrine.md`. Do NOT copy the
whole file. Seed a single block into `./AGENTS.md` **only when it does not
already carry the marker** `<!-- dox-doctrine -->` (idempotent — if the marker
is present, skip this step entirely).

Compose the seeded block as:

1. The marker line `<!-- dox-doctrine -->`
2. The WRITE discipline — the text between `<!-- dox:write:start -->` and
   `<!-- dox:write:end -->` in `dox-doctrine.md`.
3. ONE READ discipline variant:
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

## Step 6 — Done

Confirm what was written. Writing `worktreeInit` flips the directory to
"configured": the next dashboard **Initialize** click runs the hook (change-A)
instead of re-launching this skill. Tell the user they can click Initialize
again to run `npm ci` (or the profile's hook).
