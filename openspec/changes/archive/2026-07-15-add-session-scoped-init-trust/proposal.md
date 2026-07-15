## Why

Worktree-init TOFU trust is single-scoped and permanent: the first confirmation writes `repoRoot + hash` to `~/.pi/dashboard/worktree-init-trust.json` **forever**, even for a directory the user opened once. Running a hook executes repo-declared bash or spawns an LLM, so a lingering on-disk grant for a throwaway or external directory is a standing trust-boundary liability. Other agent tools let the user choose "trust for now" vs "always trust"; the dashboard offers only "always". This change adds the ephemeral option.

## What Changes

- Add a **trust scope** to the TOFU grant. The confirm dialog offers two choices instead of one "Run":
  - **Trust until dashboard restarts** (session scope) — held in server memory only, never written to disk, gone on server restart/deploy.
  - **Always trust** (project scope) — persisted to `worktree-init-trust.json` (today's behavior, unchanged).
- Server trust store gains a scope dimension:
  - `recordTrust(configRoot, hash, scope)` writes to the in-memory set (`session`) or the JSON store (`project`).
  - `isTrusted(configRoot, hash)` returns true when **either** the session set **or** the persisted store contains the key.
- Trust key is unchanged: `configRoot + hookDefHash(hook)`. Session scope applies identically to git checkouts and **external (non-git) directories** — the original motivation, since those most often have no persisted-trust need.
- `POST /api/git/worktree/init` accepts the chosen scope alongside `confirmHash`; the existing `init_untrusted` response and hash-echo contract are unchanged. Editing the hook still changes the hash and re-prompts, regardless of scope.
- **Strict scope validation (no upward coercion):** an omitted `scope` means `project` (backward compatible); a present-but-unrecognized `scope` is rejected `bad_request` — the server never coerces a malformed value into the more-durable persisted grant. Both stores share the identical `trustKey` (`path.resolve`-based) derivation.
- **Two-action confirm dialog:** the shared single-action `Confirm` cannot express two affirmative buttons, so `WorktreeInitButton` renders a small purpose-built dialog (Cancel · "Trust until dashboard restarts" · "Always trust") rather than mutating `Confirm`. Scope threads through `runWorktreeInit`, `doRun`, and the dialog handlers.
- Honest labels: the session button says "until dashboard restarts", not "this session" (the trust lives for the server process lifetime, which outlives a browser tab).

Non-goals: no per-pi-session or per-browser-client binding (rejected — no stable client identity, and the init route carries no sessionId); no TTL; no change to the auto-init-on-spawn trust rule (it still runs only via the manual, user-confirmed path).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `worktree-init-hook`: the "First-use trust (TOFU) gates hook execution" requirement gains a trust **scope** (session | project). `isTrusted` is satisfied by either an ephemeral in-memory session grant or the persisted project grant; `recordTrust` takes a scope; the init endpoint accepts the scope on confirm. Key, hash, and re-prompt-on-edit semantics unchanged.

## Impact

- **Code**: `packages/server/src/worktree-init-trust.ts` (add in-memory session set keyed by the same `trustKey`; `recordTrust`/`isTrusted` gain scope), `packages/server/src/routes/git-routes.ts` (`POST /init` reads + validates scope, rejects unknown `bad_request`, passes valid scope to `recordTrust`), `packages/shared/src/browser-protocol.ts` (add scope on the run-init request type), `packages/client/src/lib/git-api.ts` (`runWorktreeInit` sends scope), `packages/client/src/components/WorktreeInitButton.tsx` (purpose-built two-action dialog + thread scope through `doRun`), i18n strings for the two labels.
- **APIs**: `POST /api/git/worktree/init` gains an optional `scope: "session" | "project"` field (default `project` for backward compatibility). No response-shape change.
- **Persistence**: no new on-disk file; session grants are memory-only. `worktree-init-trust.json` schema unchanged.
- **Security**: strictly reduces standing trust footprint (adds a non-persisted option); no widening of what an untrusted hook may do.

## Discipline Skills

- `security-hardening` — the change is entirely on the trust boundary that gates repo-declared code execution; the session/project scope split and the "either satisfies" `isTrusted` rule must not open a bypass.
- `doubt-driven-review` — the "session" semantics were already shown to be a misnomer trap (bound to server lifetime, not a pi session); the honest-labeling and default-scope decisions warrant an adversarial pass before build.
