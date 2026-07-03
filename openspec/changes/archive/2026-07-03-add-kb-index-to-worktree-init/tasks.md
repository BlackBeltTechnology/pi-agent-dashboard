## 1. Broaden the gate + add kb index to the run (`.pi/settings.json`)

- [x] 1.1 Update `worktreeInit.gate` in `.pi/settings.json` to detect absence of ANY restored asset:
      `test ! -d node_modules || test ! -d .pi/skills/openspec-explore || test ! -f .pi/dashboard/kb/index.db`
      → verify: in a checkout missing only the kb index, `bash -c "<gate>"` exits `0`; in a fully-restored checkout it exits non-zero.
- [x] 1.2 Append the kb build + index pre-warm to `worktreeInit.run.command`:
      `npm ci && npx openspec init --tools pi --force && npm run build --workspace=@blackbelt-technology/pi-dashboard-kb && NODE_OPTIONS=--experimental-sqlite npx kb index`
      → verify: running the command in a fresh checkout produces `node_modules/`, `.pi/skills/openspec-*`, and a non-empty `.pi/dashboard/kb/index.db`.
- [x] 1.3 The `kb` bin (`node_modules/.bin/kb` → `packages/kb/dist/cli.js`) links on `npm ci`, but `packages/kb/dist/` is gitignored with no `prepare` script, so `dist/cli.js` is ALWAYS absent on a fresh worktree. The build step (`npm run build --workspace=@blackbelt-technology/pi-dashboard-kb`) is therefore mandatory before `kb index`, not conditional.
      → verified: after `npm ci` dist was absent; build produced `dist/cli.js`; `NODE_OPTIONS=--experimental-sqlite npx kb index` printed `indexed 762 files (… 13477 chunks)` and wrote a 21 MB `.pi/dashboard/kb/index.db`.

## 2. Spec: gate/run coherence (worktree-init-hook)

- [x] 2.1 Add the "Gate SHALL cover every asset the run restores" requirement to `openspec/specs/worktree-init-hook/spec.md` (applied from this change's delta on archive).
      → verify: `openspec validate add-kb-index-to-worktree-init` passes; `openspec show add-kb-index-to-worktree-init` lists the modified capability.

## 3. Docs (delegate to subagent, caveman style)

- [x] 3.1 `docs/faq.md`: note the worktree-init command now pre-warms the kb index, and the gate covers all restored assets (node_modules + opsx skills + kb index).
- [x] 3.2 `docs/file-index-server.md`: annotate the `packages/server/src/worktree-init.ts` row — gate/run coherence guidance; `See change: add-kb-index-to-worktree-init`.
      → verify: `kb search "worktree init kb index"` surfaces the updated rows.

## 4. Manual verification

- [x] 4.1 Simulated in-worktree: deleted `.pi/dashboard/kb/index.db` (kept `node_modules` + opsx skills) → gate exit `0` (re-fires despite `node_modules` present, the exact old-gate blind spot); ran the run.command kb tail → `index.db` rebuilt → gate exit `1` (cleared). Full dashboard TOFU click-through not exercised (server-side); gate/rebuild mechanics confirmed.
- [x] 4.2 Confirmed re-hash via `hookDefHash` canonical serialization: old hook hash `abc986c97c1e5adf` → new `d912650083dae9c0`. Hash differs → prior trust key no longer matches → next run returns `init_untrusted` (TOFU re-prompt), by design.
