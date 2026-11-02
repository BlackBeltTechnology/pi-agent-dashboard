# Test Plan — add-craft-web-media-projects

Stage: design   Generated: 2026-10-25

No clarifications needed: every bound is a number in `design.md` D5 (project 16 MiB, medium 64 MiB, total 256 MiB, 64 files).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | media project opens: count bound | BVA | L1 | automated | `.fcproj` referencing 63, 64, 65 distinct media | plan the delivery | 63 and 64 are all planned; with 65 the 65th is not planned and `missing` = 1 |
| E2 | media project opens: project cap | BVA | L1 | automated | project bytes of 16 MiB, 16 MiB + 1 | parse the project | 16 MiB parses; 16 MiB + 1 is rejected before `JSON.parse`, no media planned |
| E3 | media project opens: size bound | BVA | L1 | automated | media of 64 MiB and 64 MiB + 1 declared size; 5 media of 64 MiB (total 320 MiB) | plan the delivery | 64 MiB planned, 64 MiB + 1 counted missing; of the 5, the first 4 (256 MiB) planned, the 5th missing |
| E4 | media project opens: bound order | EP | L1 | automated | project referencing b.mp4 then a.mp4, bound fits one | plan the delivery | b.mp4 (first referenced) planned, a.mp4 missing, independent of name or size order |
| E5 | media project opens: confinement | decision-table | L1 | automated | project in `edit/`; paths `clips/a.mp4`, `/<cwd>/edit/b.mp4`, `../footage/c.mp4`, `/etc/passwd`, `clips/../../d.mp4`, `C:\\x\\e.mp4` | normalise paths | first two planned (cwd-relative `edit/clips/a.mp4`, `edit/b.mp4`) and rewritten to `/files/...`; the other four never planned, left unchanged, counted missing |
| E6 | media project opens: collisions | EP | L1 | automated | `a/clip.mp4` and `b/clip.mp4` | build the name map | two distinct vfs names (`clip.mp4`, `2-clip.mp4`); each project item names its own; restore maps each back to its original string |
| E7 | media project opens: hostile JSON | EP | L1 | automated | project with `__proto__` and `constructor` keys inside `items` and a media path `__proto__` | parse + collect | no prototype changed (`({}).polluted` undefined), project still parsed, no throw |
| E8 | saving restores paths | decision-table | L1 | automated | saved bytes with `/files/clip.mp4` (mapped), `/files/other.mp4` (unmapped), `clips/gone.mp4` (undelivered) | restore | mapped → original string; unmapped and undelivered unchanged byte-for-byte; output is valid JSON |
| E9 | saved bytes of the tab's kind | EP | L1 | automated | `.fcproj` bytes: valid; plain text; JSON with `format: "x"`; JSON without `project`; empty | `.fcproj` validator | valid accepted; the other four rejected |
| E10 | claims table | decision-table | L1 | automated | profiles + manifest | drift test | `.fcproj` edit claim for FilmCraft exists with `validator:true` and `maxBytes`; no `.ecproj` claim; `mediaMax*` within bounds, else `profileErrors` names the app |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | app loaded after ready; carve-out | state-transition | L1 | automated | shim with `mediaProject` app, 3 `open-media` then `open` | each message in order | `open-media-ack` posted per medium after its drop; the next message is processed only after the ack; project drop is last |
| F2 | opened state | state-transition | L1 | automated | app without title signal, fallback armed, 2 `open-media` then `open` | media drops only (no project yet), wait past `openedFallbackMs` | no `opened` message until the project `open` has been dropped |
| F3 | isolation | state-transition | L1 | automated | shim without `mediaProject`; `open-media` message | message arrives | ignored: no drop dispatched, no ack |
| F4 | user drops still refused | state-transition | L1 | automated | trusted user drop event while media delivery is in progress | user drops a local file | refused as before (not counted as a host drop), host drops unaffected |
| F5 | media read gate | fault-injection (abort) | L1 | automated | client session; `/api/file/raw` answers 200, 403, 404, network error for 4 media | open the project | 200 delivered; the other three counted missing, left unchanged; the open still completes and one "3 missing" notice is raised |
| F6 | sequential delivery | state-convergence | L1 | automated | 4 media, ack delayed 500 ms each | open the project | at most one media buffer held at any instant; the 4 drops in project order; project last |
| F7 | save restore point | state-transition | L1 | automated | frame posts a save whose bytes name `/files/clip.mp4` | `routeAndSave` | `workspaceSave` receives bytes with the original path; validator runs on those bytes; a rejection leaves disk unchanged |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | missing medium | fault-injection | L3 | automated | `.fcproj` fixture references `clips/gone.mp4` (absent) and `clips/a.mp4` (present) | Edit in FilmCraft, then save | notice reports 1 missing; after save the file on disk still contains `clips/gone.mp4` and `clips/a.mp4` verbatim |
| X2 | path outside project folder | fault-injection | L3 | automated | fixture references `../secret.txt` | Edit in FilmCraft | no request for `secret.txt` reaches `/api/file/raw` (network log); notice counts it missing |

### Round trip

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | round trip | state-transition | L3 | automated | `edit/story.fcproj` fixture with `clips/a.mp4` | Edit in FilmCraft, change the project, Ctrl/Cmd+S | `story.fcproj` on disk is FilmCraft JSON (`format: filmcraft.project`), names `clips/a.mp4` (not `/files/`), differs from the fixture; frame URL carries no document data |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | bounded memory | soak | L3 | automated | two FilmCraft tabs, each project referencing 4 media of 64 MiB (256 MiB) | both frames report ready and project opened (unconfirmed) within 120 s; the page raises no crash event | one open per tab |

### Visual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| V1 | media online | visual/subjective | — | manual-only | real FilmCraft with `.fcproj` + media | a human looks at the Project panel | [judgment: items show thumbnail and duration, none marked offline — the canvas has no automatable signal] |

---

## Coverage summary

- Requirements covered: 5/5 (claims table, loaded-after-ready carve-out, media opens, save restores, saved kind)
- Scenarios by class: edge 10 · frontend 7 · error 2 · round-trip 1 · perf 1 · visual 1
- Scenarios by level: L1 17 · L3 4 · manual 1 (22 rows total)
- Scenarios by disposition: automated 21 · manual-only 1

## New infra needed

- docker fixture `docker/fixtures/sample-git/edit/story.fcproj` + `clips/a.mp4` (tiny, generated with `pi-craft filmcraft exec --save-as`) and a variant with a missing and an escaping reference; seeded/removed by `tests/e2e/craft-web-editor.spec.ts` like its existing fixtures.
