## Why

`npm install -g @blackbelt-technology/pi-agent-dashboard` and `npx @blackbelt-technology/pi-agent-dashboard@latest` fail on npm 12 with `EALLOWREMOTE`. The documented "install without Electron" path (`docs/faq.md`) is therefore broken for every user on a current Node/npm.

Cause: `packages/server/package.json` depends on `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`, a remote tarball rather than a registry package, and npm 12 defaults to `allow-remote=none`. Reproduced 2026-10-12 with npm 12.0.2 and an empty cache. The same install succeeds with `npm_config_allow_remote=all`.

This stub records the scope. Design and tasks are written when the change is scheduled. `add-claude-code-plugin` works around the problem with a scoped `--allow-remote=all` until this lands.

## What Changes

- Remove the remote-tarball dependency from every published package's dependency tree, so `npm install -g …@latest` succeeds under npm 12 defaults. `xlsx` has a single runtime use: the lazy `import("xlsx")` in `packages/server/src/lib/office-preview.ts` (spreadsheet preview, `GET /api/file/sheet`). Options for the design to evaluate, without presupposing one:
  - vendor the SheetJS 0.20.x build into the repository (workspace-internal, published inside the server tarball);
  - switch to a registry-hosted spreadsheet parser with equivalent `.xlsx` / `.csv` read support;
  - make spreadsheet preview an optional, lazily installed capability that degrades to the fallback preview when absent.

  The registry `xlsx@0.18.x` is not an option on its own: the CDN 0.20.x pin exists because of known advisories in the registry line. The design must confirm the current advisory status.
- Add a packed-install check (CI or the release workflow) that installs the packed tarballs with npm 12 defaults (`allow-remote=none`) and fails on any remote-tarball or git dependency.
- Remove the `--allow-remote=all` workaround from the `add-claude-code-plugin` bootstrap script once this ships.

## Capabilities

### Modified Capabilities

- `file-and-url-preview`: the spreadsheet preview requirements (`.xlsx` / `.csv` → `"spreadsheet"`, `GET /api/file/sheet`) keep their observable behaviour. A delta is needed only if the chosen option changes behaviour, for example degradation when the parser is absent.

## Impact

- `packages/server/package.json` (dependency), `packages/server/src/lib/office-preview.ts` (import site), and the tests `office-preview.test.ts` and `file-raw-render-endpoints.test.ts`.
- The release workflow: a new npm 12 install gate.
- The `pnpm-lock.yaml` regeneration.
- Docs: FAQ install entries and a note in the README install path.

## Discipline Skills

- `security-hardening`: replacing a document parser that handles untrusted spreadsheet files; the advisory status of the candidates must be verified.
- `doubt-driven-review`: the dependency swap affects the published install surface for every user.
