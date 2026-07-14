## Context

The archived `2026-06-23-distill-session-knowledge` change shipped two repo-internal pieces: the skill `.pi/skills/distill-session-knowledge/` (the pi surface) and the engine `packages/session-distiller/` (`private: true`, no `pi` field, `bin: distill-session-knowledge`, 46 vitest tests). The discipline — anchor lessons to objective signals, promote only cross-session recurrences, route to skill_manage/memory/docs — is portable to any pi project, but nothing publishes today.

Exploration decided **two packages**: publish the engine as-is; add a thin skill package that depends on it. Rationale: the engine has a real CLI + test suite (independently useful), so a thin-skill-deps-engine split keeps each piece single-purpose and avoids bundling a test suite into a skill package.

## Decision 1 — Two packages, engine keeps its name

**Decision:** engine stays `@blackbelt-technology/pi-dashboard-session-distiller`; a new thin package (working name `packages/distill-session-knowledge/`) holds only SKILL.md + manifest + README/NOTICE and declares a runtime dep on the engine.

### Considered alternatives
- **One package** (skill co-located with engine, single publish) — rejected in exploration; would ship the engine's 46-test suite + `src/` inside what is conceptually a skill package, and couple skill versioning to engine internals.
- **Rename the engine** to a skill-forward name — rejected; the bin `distill-session-knowledge` already carries the user-facing name, and renaming the engine churns the archived change's identity for no gain.

## Decision 2 — Release the two together (skew guard)

A skill package that deps a separately-versioned engine can skew if released independently.

**Decision:** add both to the `release-cut` workspace publish set and always cut them in the same release. In-repo they resolve as workspace links; on publish the dep is a real semver.

### Considered alternatives
- **Pin an exact engine version in the skill dep** — kept as a supporting tactic (`^` range acceptable), but the primary guard is same-release publishing.

## Decision 3 — Security review before going public

The engine reads pi session JSONL, which can contain secrets, PII, and absolute paths. Publishing widens the blast radius versus a repo-internal tool.

**Decision:** run `security-hardening` before first public publish — verify the miner never emits raw sensitive session content into distilled artifacts, and that any bundled fixtures/README examples are scrubbed or synthetic. This gates the version bump off `0.0.0`.

## Risks

- **Version skew** (mitigated by same-release publishing).
- **Behaviour regression on move**: the skill's engine-invocation path changes from repo-relative to package bin/API — cover with the existing 46 tests staying green plus a smoke run of the bin from the installed package.
- **Accidental disclosure** in a public package (mitigated by the security-hardening gate).
