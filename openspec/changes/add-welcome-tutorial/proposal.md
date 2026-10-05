## Why

A new user lands in the dashboard with a three-step checklist (credentials → pin folder → start session) and nothing else. No document walks them through creating a project, the project-init questions, DOX + kb indexing, model roles, extensions/plugins, or reaching the dashboard from a phone. The pieces exist (README quickstart, `docs/user-features.md`, `docs/faq.md`, `project-init/SKILL.md`), but none are user-facing, ordered, themed, localized, or kept in sync with the UI. The last attempt at product screenshots (`site/scripts/screenshots`) rotted — placeholder routes, a stub seed, no drift check — and was deleted.

This change ships a first-steps **welcome tutorial** that lives inside the dashboard as a pinned folder, renders in the user's theme and language, can drive real dashboard actions, and is rebuilt reproducibly whenever screens or logic change.

## What Changes

### (a) Marker-driven folder home + runtime frame + bridge
- A directory MAY carry a marker `.pi/home.json` (`{ entry: "{lang}/index.html", fallback: "en", showPrompt?: boolean }`). When present and resolvable, `/folder/:cwd` renders the marker page instead of the centered prompt (`DirectoryHomeView` stays the default when absent).
- The page renders in a `sandbox="allow-scripts"` **opaque-origin** iframe (no `allow-same-origin`). Spike-verified: from such a frame `localStorage` throws, API reads fail CORS, mutating `/api/*` gets 403 `untrusted origin`, and `/ws` upgrades are rejected — so the frame has no ambient authority.
- Because the same opaque origin also cannot present the dashboard's auth (the `SameSite=Lax` session cookie is not sent on its cross-site subresource loads; a paired device's bearer is never attached), **the frame never loads URLs itself**. Marker files are served under `/api/home/:dirId/*` — inside the universal network guard's jurisdiction — and the **parent** fetches them with its own credentials: a single-file build becomes the frame's `srcdoc`; binary assets (screenshots) are delivered over the bridge as bytes and turned into blob URLs inside the frame.
- The **only** capability channel is a versioned `postMessage` bridge. Parent → frame: `theme` (mode, name, CSS vars; live on toggle), `lang`, a filtered read-only `status` snapshot (booleans/counts/model capability table — never URLs, tokens, paths). Frame → parent: `ready`, `navigate` (allowlisted routes), `spawn` (prefilled prompt), `openDialog` (allowlisted ids), `applyRolePreset` (prefill only). Parent checks `event.source === frame.contentWindow` + message schema + allowlist.
- **Trust tiers**: the first-party welcome directory gets the full verb set; any other marker directory gets `navigate` only, `spawn` behind a confirm, and a visible "content from `<dir>`" label (UI-redress defense).

### (b) Welcome tutorial content
- New workspace package `packages/welcome`: a React (Vite, single-file output) app authored with a small **home SDK** (`useDashboardTheme`, `useDashboardLang`, `<DashLink>`, `spawn`, `<Shot>`, `<Specimen>`, `<Pop>`, mock bridge for `?mock=1`). Built per language (`en`, `hu`, `zh-CN`) with a key-parity-checked string catalog.
- Chapters: Welcome + **Anatomy** (lettered A–L layout parts), Connect a provider, **Model roles** (size-class legend L/M/S, per-role type/size/thinking hints, Quality/Balanced/Budget starter presets resolved against reachable models, targeting the post-`promote-model-roles-settings` Models nav), **Start your first project** (Add Folder → New folder → Initialize → each project-init question explained), **Knowledge base & DOX**, Chat & controlling agents, **Extensions & plugins** (packages, plugins catalog, per-folder resources, MCP), everyday features, **Use it from anywhere** (zrok install/enable/reserve, safety step, QR pairing with compare-code, copy-string pairing, device management), Troubleshooting.
- Server ships the built tutorial and, on boot, copies it to `~/.pi/dashboard/welcome/` when the shipped version differs (overwrite on upgrade), then **pins it once** via a new `welcomeSeeded` preference flag (independent of `pinSeeded`). Unpinning is permanent — the flag is never reset. The welcome folder is exempt from the Initialize / OpenSpec-init offers.

### (c) Reproducible capture + specimen builder
- `data-tour="<id>"` anchors added to the client parts the tutorial references (anatomy letters + shot targets).
- **Live specimens**: self-contained client components (provider list, Model roles rows, KB row/settings, session card, composer, directory card, pairing dialog, `ask_user` cards for the project-init questions) render inside the tutorial with typed fixtures and a `SpecimenProvider` (mock store/API, in-memory storage) — always the current design, theme, and language. Heavy deps (Monaco, xterm, mermaid) are forbidden imports.
- **Screenshots** only for whole-shell composition (anatomy, mobile, terminal): a Playwright builder against a fixture HOME (docker test harness), per `lang × {light,dark}`, driven by a shot manifest (`route`, `setup[]`, `anchor`, `mask[]`, `mock[]` network stubs, `viewport`, `requires`), with frozen clock and animations disabled. The same builder runs on the user's machine via a "Refresh screenshots" action (writes to `~/.pi/dashboard/welcome/shots`, "reset to shipped" available).
- **Drift gates**: lint (every `<Shot>`/`<Specimen>` id ↔ manifest, i18n key parity, every `data-tour` anchor exists in client source) blocks the build; CI visual diff against the committed baseline is **report-only** (warning + diff artifact).

Not in scope: the trusted-network tunnel bypass (prerequisite change `fix-trusted-network-tunnel-bypass` — the remote-access chapter ships disabled until it lands); a runtime role validator on the Model roles page (suggested follow-up to `promote-model-roles-settings`); converting existing `openspec/changes/*/mockups` to specimens; third-party theme-set screenshots beyond light/dark of the default theme.

## Capabilities

### New Capabilities
- `folder-home-marker`: `.pi/home.json` marker resolution, `{lang}` entry + fallback, path-style static serving of the marker directory.
- `home-frame-bridge`: opaque-origin frame hosting, versioned postMessage protocol, allowlists, trust tiers, filtered status snapshot.
- `welcome-tutorial`: tutorial package, chapters/content contract, i18n, theming, ship + copy-on-version + pin-once seeding.
- `welcome-capture-builder`: `data-tour` anchors, specimen harness, shot manifest + Playwright builder, runtime refresh, drift gates.

### Modified Capabilities
- `directory-home-page`: the bare folder route renders the marker page when a valid marker is present; the centered prompt remains the default.
- `pinned-directories`: server-initiated one-time welcome pin governed by `welcomeSeeded`.

## Impact

- **Server**: new guarded `/api/home/:dirId/*` file route for marker dirs (`routes/`), marker read endpoint, welcome copy-on-version at boot, `welcomeSeeded` in `preferences-store.ts`, filtered status snapshot source.
- **Client**: `/folder/:cwd` branch in `DirectoryHomeView`/`ShellContent`, `HomeFrame` host + bridge dispatcher, `data-tour` attributes across shell/session/settings components, specimen-safe entry points for chosen components.
- **New packages**: `packages/welcome` (tutorial app + home SDK; could split `home-sdk` later), capture scripts under `packages/welcome/capture/`.
- **Build/CI**: `build:welcome` in the server package build; `capture:welcome` (Playwright, docker harness) path-filtered on `packages/client/**` + `packages/welcome/**`, report-only diff artifact.
- **Package size**: ship `en` light/dark shots as WebP crops only (~1–2 MB); other languages captured locally on demand.
- **Dependencies**: none new at runtime; Playwright already a dev dependency.
- **Compatibility / rollback**: marker absent ⇒ unchanged behavior. Rollback = revert; `~/.pi/dashboard/welcome` and `welcomeSeeded` are inert without the code (user can unpin). No data migration.
- **Prerequisite**: `fix-trusted-network-tunnel-bypass` before the "Use it from anywhere" chapter is enabled. Coordinates with `promote-model-roles-settings` (roles chapter links to Models ▸ Model roles) and `add-persistent-onboarding-card` (its steps deep-link into chapters).

## Discipline Skills

- `security-hardening` — untrusted marker pages, opaque-origin frame, postMessage bridge allowlist is the whole boundary, static route traversal.
- `doubt-driven-review` — bridge protocol v1 and the marker format are public contracts third-party directories will depend on; review before they stand.
- `scenario-design` — trust tier × verb matrix, theme/lang × fallback, pin-once/unpin, copy-on-version upgrade, capture determinism.
- `performance-optimization` — specimen bundle budget (lazy per chapter, forbidden heavy imports), shipped asset size budget.
- `observability-instrumentation` — log bridge rejections (source mismatch, schema, disallowed verb) and capture-builder drift summary.
