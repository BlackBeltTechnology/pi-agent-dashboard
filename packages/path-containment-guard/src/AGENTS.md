# DOX — packages/path-containment-guard/src

Files in this directory. One row per source file. See change: add-path-containment-guard-extension.

| File | Purpose |
|------|---------|
| `config.ts` | `parseGuardConfig(env, {platform?, resolveEnv?})` → `{ok:true, roots, deniedTools}` \| `{ok:false, scope:"path", deniedTools}` \| `{ok:false, scope:"all"}`. Env `PI_EXT_PATH_CONTAINMENT_GUARD_{ALLOWED_ROOTS,DENIED_TOOLS}` (JSON arrays; name from shared constant). Bad root entries dropped (relative, NUL, win32 driveless, canonicalisation fault/loop); no root → path tools blocked; malformed denied list → everything blocked. `isAcceptableRoot` shared with `scope.ts`. |
| `decide.ts` | Pure `decideGuard(tool, input, cwd, config, opts?)` → `{allow:true}` \| `{allow:false, code, tool, canonical?}`. Order: config-all → denied (exact, case-sensitive) → non-path tool allowed → config-path → arg validation (`invalid_path`; grep/find/ls absent path = cwd) → resolve (`read` variant fallback) → canonicalise → containment. Throws on resolver fault (handler → `error`). Never prompts. |
| `extension.ts` | Pi entry; `createGuardExtension(deps)` factory is TOTAL (never throws, always registers one `tool_call` handler — a throwing factory would vanish on reload = fail-open). Handler returns `{block:true, reason}` (`<code>: <tool> <canonical> — allowed roots: …`), one escaped stderr line per rejection, never touches `ctx.ui`. Default export = `createGuardExtension()`. |
| `scope.ts` | Pure `withPathContainmentGuard(opts, base?)`: merges `-e <guard entry>` (uncast `import.meta.url`) + `extensionConfig["path-containment-guard"]` into a spawn scope; throws on no acceptable root / bad denied entry / existing guard entry; never mutates `base`. No pi/server imports. |
| `strict-env.ts` | `captureFaults(ResolveEnv)`: remembers the first non-`ENOENT`/`ENOTDIR` realpath failure (e.g. `EACCES`) that shared `canonicalizeTarget` swallows as "missing", so `decideGuard` rejects with `error` instead of trusting a guessed path. |
