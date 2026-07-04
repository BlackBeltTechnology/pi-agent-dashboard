# Design — folder-resource-activation-toggle

## Status: revised after doubt-driven review (single-model Opus + cross-model Vertex Gemini 3.1)

Two independent, cross-architecture adversarial reviews converged on the same verdict: the original "dashboard hand-writes `settings.json` exclusions and reimplements pi's glob resolution" approach is wrong. This document records the pivot and the open questions that MUST be resolved before implementation.

## What the reviews found (merged, verified against code)

1. **`pi config` already owns enable/disable.** `docs/packages.md:219`: "Use `pi config` to enable or disable extensions, skills, prompt templates, and themes … global and project scopes." Reinventing the write path risks diverging from pi's own format and semantics. → **PIVOT away from hand-writing settings.json.**
2. **The scanner does not read user settings resource arrays.** `pi-resource-scanner.ts` `scanLocalResources` reads directories via `fs.readdirSync` (`discoverExtensions/Skills/Prompts`); `readSettingsPackages` (l.284) reads only `packages`, discarding object-form filters. Deriving `enabled` from settings arrays is net-new glob-engine work, not "gains a field."
3. **`-path` on an otherwise-empty array is an unproven suppression mechanism.** `docs/settings.md` describes `extensions/skills/prompts` as "Local … paths or directories" (additive source paths). No doc proves a bare `-path` retroactively suppresses a *conventionally-discovered* resource. Assumed, not verified.
4. **`reloadSessions` is not folder-scoped or reusable as claimed.** `package-manager-wrapper.ts:212` `private reloadSessions: () => Promise<number>` (no args); impl `server.ts:1056` iterates ALL connected sessions and sends `/reload` as prompt text. "Local reloads only the folder's sessions" requires new filtering, not reuse.
5. **`PiResource` carries no mtime or provenance.** `rest-api.ts:282` = `{name, description, filePath, type}`. The 409-mtime concurrency protocol is unfulfillable (client has no mtime to echo); the write path can't tell how a resource was discovered (conventional dir vs settings array vs string-package vs object-package) to pick an edit strategy.
6. **Object-form partial-key mutation trap (Gemini).** Rewriting a string package entry `"pi-skills"` to `{source, skills:[…]}` while omitting `extensions`/`prompts` keys may make the loader default those to `[]` (load none), silently deactivating unrelated resource types from the same package.

## The pivot

**Primary approach (pending Open Question 1): delegate the write to pi.** The dashboard should NOT reimplement resource activation. It should drive pi's own enable/disable authority so the on-disk format, glob semantics, object-form handling, and JSONC preservation are pi's responsibility, guaranteeing scanner↔write consistency (Contract §1, §3, §6) for free.

## Open Question 1 — RESOLVED (verified against pi source)

**Is `pi config` scriptable? The CLI is not; the writer is.** Verified by reading `dist/modes/interactive/components/config-selector.js` + `dist/index.d.ts` in the installed pi (`@earendil-works/pi-coding-agent`).

- The `pi config` **CLI command is interactive-only** — a TUI picker (`ConfigSelectorComponent`), ignores `--help`, no non-interactive flags. Do NOT shell out to it.
- pi's **enable/disable format is fully known and simple**:
  - Top-level (conventionally-discovered) resource: in the scope's `settings.json` `extensions`/`skills`/`prompts`/`themes` array, strip any existing entry whose stripped-of-`!+-` value equals `pattern`, then push `+<pattern>` (enable) or `-<pattern>` (disable).
  - Package resource: find the package in `settings.packages`, convert string→object form `{source}`, and apply the same `+/-<pattern>` push into `pkg[resourceType]` (only that key — partial-key object form is intended).
  - `pattern = relative(baseDir, item.path)` (a relative path).
- pi **exports the writer**: `SettingsManager` is public (`index.d.ts:18`, `./core/settings-manager.ts`) with format-preserving typed setters — `setExtensionPaths` / `setSkillPaths` / `setPromptTemplatePaths` / `setThemePaths` and their `setProject*` variants — exactly what `config-selector` calls.

**Decision**: the dashboard **imports pi's `SettingsManager`** and replays the same filter-then-push `+/-<relPath>` logic `config-selector` uses (dashboard already loads pi via jiti). This makes the write byte-identical to `pi config` — Contracts §1, §3, §6 satisfied by construction. This supersedes both the original "hand-write settings.json" bullets and the interim "shell out to pi config" idea.

Doubt-finding dispositions after source verification: Issue 1 (glob semantics) REFUTED — `-<relPath>` is exactly pi's disable format. Issue 5 (object-form partial key) REFUTED — pi's own writer does partial-key object form. Issue 7 (JSONC corruption) RESOLVED — use `SettingsManager`, not raw JSON. Issue 4 (reinvention) RESOLVED — reuse pi's writer, don't reinvent or shell out.

## Open Question 2 — RESOLVED (verified against pi source)

**The dashboard reimplements no glob logic; it reuses pi's resolver.** pi exports `PackageManager` (`index.d.ts:12`, `./core/package-manager.ts`) whose `resolve(): Promise<ResolvedPaths>` returns `ResolvedPaths { extensions, skills, prompts, themes: ResolvedResource[] }`, where `ResolvedResource { path: string; enabled: boolean; ... }` — the `enabled` flag is **already computed** by pi applying the `+/-<pattern>` precedence. This is the same `resolvedPaths` `ConfigSelectorComponent` consumes.

**Decision**: the dashboard `pi-resource-scanner` sets `PiResource.enabled` from pi's `PackageManager.resolve()` output (match by `path`), rather than re-deriving. Read (`PackageManager`) and write (`SettingsManager`) are both pi's own code — correctness and scanner↔write consistency (Contract §6) are free. Doubt Issue 2 (scanner plumbing) becomes "call pi's resolver + map onto `PiResource`," not a new glob engine.

## Open Question 3 — Reload scoping — CLARIFIED (existing infra covers it)

**Both prerequisites already exist; the endpoint composes them.**
- **Session→cwd filter**: each session carries `.cwd` (set at register, `pi-gateway.ts:301`). `pi-gateway.ts:438` already has `findSessionByCwd(cwd)` with the exact prefix-match (`cwd === s.cwd || s.cwd.startsWith(cwd+"/") || cwd.startsWith(s.cwd+"/")`). Reload needs the **plural** of that: add `findSessionsByCwd(cwd): string[]` (same predicate, collect all) OR filter `getConnectedSessionIds()` inline. `local` = folder prefix-match; `global` = all connected.
- **Correct reload trigger, per session type, already solved**: `handleSendPrompt` (`session-action-handler.ts:203`) intercepts `/reload` — headless sessions route to `handleHeadlessReload` (SIGTERM→SIGKILL + respawn with `--session <file>`; change `headless-reload-via-respawn`), TUI sessions get the `/reload` prompt forwarded to the bridge. So the `/api/resources/reload` endpoint reloads each affected session through this **existing per-session reload interceptor** — NOT the argless all-sessions `reloadSessions` (`package-manager-wrapper.ts:212`). Both session types handled for free.
- **Disposition**: no longer blocking. Task = add the plural cwd filter + loop affected sessions through the existing reload interceptor. `affectedSessions` in the toggle response is that same filtered list.

## Open Question 4 — mtime concurrency — CLARIFIED (reuse the md-write pattern; 409 optional)

Two distinct concerns, only one mandatory:
- **Concurrent dashboard toggles (lost update) — MUST handle.** Two toggles of different resources each read settings.json then write via `SettingsManager` (whole-file), and the second clobbers the first. Fix: reuse the **per-target write-serialization mutex** already in `file-routes.ts:23` (a promise chain keyed by resolved path) around the read-modify-write. Cheap, proven, prevents the lost update. This is the real requirement.
- **External hand-edit between scan and toggle — OPTIONAL.** Guarding this needs a 409 mtime check, which requires threading the scope's `settings.json` `mtimeMs` into the scan response so the client echoes it back (mirrors `file-routes.ts:113-116`, full-precision, no rounding). Since a toggle is a tiny idempotent single-key change (not a full-document editor buffer), the recommendation is: mutex + **re-scan after write** (last-writer-wins), and add the 409-mtime echo only if guarding concurrent external edits is deemed worth the extra field. `PiResource`/`PiResourcesResult` would gain an optional settings `mtime` only in that case.
- **Disposition**: no longer blocking. Mutex is a 3-line reuse; 409 is a documented optional add-on.

## Remaining risk after clarification

None blocking. Both OQ3 and OQ4 reduce to reusing an existing, proven pattern in this codebase (`pi-gateway` cwd filter + `session-action-handler` reload interceptor; `file-routes` write mutex + optional mtime-409). The change is implementation-ready.

## Non-negotiables carried forward (unchanged by pivot)

- `PiResource.enabled` additive (Contract §2). Backward compatible.
- Scope-bounded realpath security guard on any write (Contract §4).
- Never uninstall/move (activation only).
- One-click "Reload N sessions" UX (folder-scoped reload once OQ3 resolved).

## Doubt-review provenance

- Single-model: `anthropic/claude-opus-4-6`, adversarial prompt, artifact+contract only.
- Cross-model: `google-vertex/gemini-3.1-pro-preview` (Vertex; the `google/…` and `@vision` SDK ids returned empty this session — Vertex prefix required). Independent confirmation of findings 1–5, original finding 6.
