# Notes — unify-pi-runtime-identity

## Part 4 — upstream escape hatches (tasks 7.1, 7.2)

Status: **pending user filing** (2026-08-30 — user declined autonomous filing on
both third-party repos; drafts below are ready to paste).

### 7.1 — pi-hermes-memory: prefer builtin `node:sqlite`, better-sqlite3 fallback

- Target repo: `chandra447/pi-hermes-memory` (installed here as npm
  `pi-hermes-memory@0.9.7`).
- Title: `Prefer builtin node:sqlite (DatabaseSync) over better-sqlite3 when available`
- Body:
  ```markdown
  ## Problem

  `pi-hermes-memory` loads `better-sqlite3` from pi's shared extension tree
  (`~/.pi/agent/npm/node_modules/`). That tree has no owning Node runtime, so its
  compiled `better_sqlite3.node` is V8-ABI-bound to whichever Node built it last.
  When pi is later loaded by a different Node (e.g. the Electron dashboard's
  bundled Node 24 vs a terminal nvm Node 25), session indexing throws:

  ```
  Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version
  using NODE_MODULE_VERSION 141. This version of Node.js requires 137.
  ```

  User-visible artefact: "Memory auto-review failed in both transports".

  ## Suggested fix

  Prefer the builtin `node:sqlite` (`DatabaseSync`) when available, falling back
  to `better-sqlite3`:

  - `node:sqlite` added v22.5.0, unflagged since v23.4/v22.13, Stability 1.2
    (release candidate) since v25.7.
  - Both runtimes in the reported incident (bundled v24.15.0, terminal v25.8.1)
    already ship it.
  - Landing this removes the last V8-ABI-bound module from the extension tree
    and collapses this failure class for hermes users entirely (no ABI rebuild
    ping-pong).

  Reference: pi-agent-dashboard change `unify-pi-runtime-identity` (its Doctor
  ABI guard rail will keep covering any remaining V8-ABI module).
  ```

### 7.2 — pi: shared extension tree has no owning runtime; per-ABI segregation

- Target repo: `earendil-works/pi` (pi `@earendil-works/pi-coding-agent@0.84.4`).
- Title: `Global extension dir is a shared native tree with no owning runtime — consider per-ABI segregation of .node artifacts`
- Body:
  ```markdown
  ## Observation

  `~/.pi/agent/npm/node_modules/` is arm-independent — one directory, one set of
  compiled native modules, loaded by every pi process on the machine. The Node
  runtime that loads it is arm-dependent (nvm terminal vs Electron-bundled vs
  managed). Nothing reconciles the two: a single `npm rebuild` fixes one loader
  and breaks the other (verified in both directions with better-sqlite3:
  NODE_MODULE_VERSION 141 vs 137).

  ## Suggested direction

  Per-ABI segregation of `.node` artifacts, à la `node-gyp-build`'s
  `prebuilds/<platform>-<arch>/` convention — extended to the ABI axis
  (e.g. `prebuilds/<platform>-<arch>-abi<N>/`), so multiple loader runtimes can
  coexist in one tree without rebuilding. Long-term; the dashboard-side
  mitigation (spawn-runtime ladder that follows the user's runtime + Doctor
  ABI-mismatch guard rail) ships in pi-agent-dashboard
  (`unify-pi-runtime-identity`) regardless.
  ```
