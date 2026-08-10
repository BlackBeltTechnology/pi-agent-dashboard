# Distill accumulated Hermes memories into phase-scoped skill sidecars

## Scope & Target (read first)

**Split-target, like `memory-retrieval-injection`.** Two halves:

1. **In-repo** — the distillation tooling (a classify → route → author pass) and the
   skill sidecar convention (`references/lessons.md`) live in `.pi/skills/` +
   `packages/` in THIS repo.
2. **Upstream (`pi-hermes-memory`)** — the durable "move-out" (Hermes `remove` +
   future-write reroute) is a **design spec for upstream contribution** to the external
   `pi-hermes-memory` npm package (installed at `~/.pi/agent/npm/node_modules/pi-hermes-memory`,
   not a workspace package). v1 can operate move-out through the existing `memory` tool
   API without upstream changes; the *automatic future-write reroute* is the upstream part.

## Why

The Hermes memory store (`~/.pi/agent/pi-hermes-memory/sessions.db`, `memories` table —
~279 rows today: ~258 `memory`, 14 `failure`, 7 `user`) consolidates into a ~50-line MD
block that either injects wholesale or
not at all. The consolidated block is **topic-blind**: docker failures sit in context
during the proposal phase; worktree gotchas sit in context during a UI mockup. Memory
that is only relevant at one *development phase* pays a per-turn context cost at **every**
phase.

The project already routes every important development step through **skills** that
auto-load by NL trigger — skills are, in effect, the phase markers. And skills already
carry phase-scoped detail via sidecar files (`implement/SKILL.md` → `references/rebuild-matrix.md`,
`references/code-discipline.md`). So the carrier for phase-scoped memory already exists.
The memories even cluster cleanly by phase: test 124, worktree 79, kb 59, openspec 50,
build 50, flow 31, ship 25, proposal 17, electron 17, docker 11 — each maps to an
existing skill.

### Positioning against existing work (coherence-checked)

- **Complements `memory-retrieval-injection` (active).** That change reduces the injected
  block by *ranking to the current prompt* and keeps everything in Hermes. This change
  reduces it by *physically promoting the shareable, settled subset out of Hermes into
  skills*. They **stack**: the ranker then operates on a smaller residual. This change
  does NOT touch the ranker, `searchMemories`, or the injection path, and does NOT rely on
  any of its internals. (Note: MRI's D3 is *injection*-pinning — which entries are always
  injected — NOT storage ownership; it does not constrain what may be distilled. The only
  never-move rule here is structural: `target = user`. The 14 `failure`-target rows (12
  categorized as correction/insight/tool-quirk + 2 uncategorized; category is advisory) are
  the prime distill candidates.) Removal goes through the `memory` tool to preserve D4
  single-owner sync, never a raw DELETE.
- **Defers the cold-store safety net to `add-automatic-session-kb-index` (active).** That
  change already routes distilled knowledge into `packages/kb` FTS5 with `signal`/provenance
  metadata and a mandatory secret/PII scrub. This change does NOT re-propose a kb sink. A
  distilled skill sidecar stays `kb_search`-able off-phase **only when `.pi` is a kb
  source** — note `.pi` is in kb's `DEFAULT_EXCLUDE` (`packages/kb/src/dox.ts`) and reaches
  the index solely because this repo's `.pi/dashboard/knowledge_base.json` explicitly lists
  `{"kind":"filesystem","ref":".pi"}`. The off-phase backstop is therefore **config-
  conditional**, not structural; a consumer repo whose kb config omits `.pi` loses it. The
  pass SHALL verify `.pi` is a configured kb source and warn when it is not.
- **Reuses `distill-session-knowledge` (shipped) philosophy, new source.** That distiller
  routes *raw session logs* → skills/memory/docs. This change retroactively re-routes the
  *already-accumulated Hermes `memories` table* → skill sidecars. Same sink discipline,
  different (already-curated) source.

### The privacy constraint (surfaced by `memory-retrieval-injection`'s Non-Goals)

That change rejects "moving memory into the project kb" as a **git-committed, repo-scoped
privacy leak**. The same boundary applies here: Hermes (`~/.pi/agent/`) is the **private,
un-committed tier**; skill sidecars (`.pi/skills/`) are the **public, git-committed tier**.
Naïvely moving a personal/secret/absolute-path memory into a committed file is that exact
leak. `add-automatic-session-kb-index` resolves the identical tension with a mandatory
in-code scrub; this change inherits it.

## What Changes

- **A distillation pass** (offline, agent-run, opt-in) that, for the Hermes `memories`
  table scoped to the current session's own `projectName` (the value the `memory` remove
  tool also scopes to — never cross-project):
  1. **Classifies** each candidate entry to a host skill via **subagent fan-out** (one
     subagent per topic bucket, same pattern as `faq-mine`), emitting a route + confidence.
  2. **Gates** each entry. Two **hard, structural** gates plus one **advisory** signal:
     - **HARD — Shareability**: `target ≠ user` (schema-checkable) AND passes the
       secret/PII/absolute-path scrub (hard code gate; a scrub failure is a no-move, never
       best-effort). These two alone decide whether an entry may reach a committed file.
     - **HARD — Maturity**: the entry is *settled* — `last_referenced` (which the store
       bumps on write/replace, **not** on read; see design D2) is older than `T_age`, i.e.
       the entry has not been edited recently and is not actively churning. Reference-count
       is NOT used in v1 (no store path produces one).
     - **ADVISORY — project-technical**: a classifier judgment (D1), NOT structurally
       checkable. It informs the human's approval of the routing table; it is not an
       automated gate. Personal content mis-stored as `target=memory` is caught by the
       human confirm + scrub, not by this signal.
  3. **Authors** the surviving entry into the host skill's `references/lessons.md`
     (creating the sidecar + a SKILL.md pointer if absent).
  4. **Tunes the host skill's `description` triggers** so the distilled lesson actually
     loads in its situation (a lesson in a skill that never fires is dead weight).
  5. **Moves out**: removes the distilled entry from Hermes via the `memory` tool API.
     The tool matches by **substring + target + project, not row id** (`memory-tool.ts`),
     so the pass MUST pass the entry's **exact stored bytes** as `old_text` (the
     `consolidate-pi-memory-store` skill's hard-won rule) and MUST verify the op removed
     **exactly one** row — a multi-row substring match or a zero-row miss aborts the
     move-out for that entry (never a raw DELETE, never an over-delete).
- **Future-write reroute (upstream design spec).** A phase-lesson written after
  distillation should be offered a skill-sidecar destination instead of accreting back in
  Hermes. v1 documents the reroute contract for `pi-hermes-memory`; it is not required for
  the in-repo pass to deliver value.
- **Human confirmation of the routing table.** The classifier proposes; a human approves
  the route/gate decisions before any move-out. No silent promotion of memory into
  committed files.
- **Cross-dedup against existing sidecars.** A lesson that originated in a session may
  already have been routed into a skill by `distill-session-knowledge`. Idempotency
  content-hashes against the **existing** `references/lessons.md` entries (regardless of
  which pass authored them), not only within this pass, so the same lesson is never
  double-authored.
- **Scope excludes global + cross-project rows.** Only `memory`/`failure` entries whose
  `project` equals the session's registered `projectName` are candidates (guarantees the
  D4 remove can target the row); `project IS NULL` (deliberately global) entries are NOT
  distilled — promoting a cross-project memory into one project's committed skill would
  mis-scope it.

## Capabilities

### Added Capabilities

- `hermes-memory-distillation`: an opt-in, human-confirmed pass that classifies mature,
  shareable, scrubbed Hermes `memories` entries to a host skill via subagent fan-out,
  authors them into the skill's `references/lessons.md`, tunes the host skill's triggers,
  and moves the entry out of Hermes through the `memory` tool API — leaving personal/
  volatile/unshareable memory in the private Hermes tier.

## Impact

- **In-repo**: distillation tooling (likely a `.pi/skills/` skill + a `packages/` helper),
  new `references/lessons.md` sidecars under existing `.pi/skills/*`, tuned skill
  `description` frontmatter.
- **Upstream (`pi-hermes-memory`)**: design spec only in v1 (future-write reroute).
- **No change** to `memory-retrieval-injection`'s ranker/injection path or to
  `add-automatic-session-kb-index`'s kb sink.
- **Privacy**: net-positive — moves ONLY the scrubbed, shareable, non-personal subset into
  committed files; personal/secret content stays in the un-committed Hermes tier.

## Discipline Skills

- `security-hardening` — the two-axis gate's shareability/scrub arm handles secrets/PII
  crossing the private→public (git-committed) boundary.
- `doubt-driven-review` — move-out is irreversible-ish (deletes from Hermes); the
  routing-table + gate decisions get an adversarial pass before any entry is moved.
- `review-code` — the classification/authoring/reroute tooling gets an inline review pass.
