## 1. Motion core (pure, test-first)

- [x] 1.1 Tests for `runtime/transition.ts`: dolly/swing reproduce today's `stepAnim` poses; every flying kind lands exactly (pos, target, roll 0, fov); crane mid-point above the line; revolve radius; `amount` scaling; reverse symmetry (u vs 1−u)
- [x] 1.2 Implement `runtime/transition.ts`: travel frame, key mapping, centripetal Catmull-Rom with pinned ends, arc-length sampling, eased time, look/roll/fov interpolation, canned key lists for revolve/crane/bank/flythrough
- [x] 1.3 Path tests: 1, 3 and 8 keys on `line`, `tunnel`, `orbit` rails give the same travel-frame shape and exact landing

## 2. Runtime wiring

- [x] 2.1 `goTo`: resolve kind + params, build the motion once, record direction (forward/back) for reverse play
- [x] 2.2 `stepAnim`: sample the motion; apply roll after `lookAt`, fov via `updateProjectionMatrix`, restore on landing; keep idle drift off while `anim` is set
- [x] 2.3 `cullNeighbours`: force the leaving and arriving groups visible while `anim` is set (test)
- [x] 2.4 Screen overlay for `fade` and `iris` (palette background quad / circular mask after the composer); camera switch at u = 0.5
- [x] 2.5 `setTime` determinism test: same deck, same slide/time ⇒ same camera pose and same pixel hash

## 3. IR, validation, corpus

- [x] 3.1 `schema.json` + `types.ts` + `defaults.ts`: transition enum, `transitionCycle`, `cameraPath`; resolution order recorded in the derived slide config
- [x] 3.2 `validate` tests: unknown id, unordered keys, `cameraPath` without `path`, `path` without `cameraPath`, out-of-range look/roll/fov, > 8 keys
- [x] 3.3 Corpus cards (`src/fx/<id>.ts` + `.meta.json`) for swing, revolve, crane, bank, path; update fade/iris/flythrough card text; corpus test passes
- [x] 3.4 HUD `TRANSITIONS` derived from the corpus `transition` cards (+ `cut`)
- [x] 3.5 Regenerate `reference/ir-fields.md` (`npm run build`); e46 field-reference test passes

## 4. Docs and verification

- [x] 4.1 Update `.pi/skills/deck3d/SKILL.md`: id table, `transitionCycle`, `cameraPath` example, roll warning; replace the interim "iris/flythrough = dolly" note
- [x] 4.2 Package `AGENTS.md` rows for `runtime/transition.ts` and new fx cards
- [x] 4.3 Manual check on the Raktar360 deck: `transitionCycle` + one `path` slide, GPU screenshots mid-move and at landing for forward and back navigation
- [x] 2.6 Cross-fade (`runtime/fade.ts`): leaving backdrop out, arriving in, whole group when culled; tests
- [x] 4.4 Full package test suite + `deck3d check` on the fixture deck pass
