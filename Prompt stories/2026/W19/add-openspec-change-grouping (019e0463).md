---
session: 019e0463
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts); large facts sheet (~13461 tok)"
upgrade_status: pending
openspec_changes: [add-openspec-change-grouping]
proposal_excerpt: "Folders with many active OpenSpec changes (this repo currently has 14+ in-progress) make every OpenSpec listing surface — `FolderOpenSpecSection`, `ArchiveBrowserView`, the attach dialog in `SessionOpenSpecActions` —…"
---

# How we did it: OpenSpec change grouping — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the `/opsx:apply` command on the change
`add-openspec-change-grouping`: *"Implement tasks from an OpenSpec change."* The change
was already 42/89 done — all remaining tasks (47) were the **client-side** phases
(5–14): API helpers, shared UI primitives, integration into three OpenSpec listing
surfaces (`FolderOpenSpecSection`, `ArchiveBrowserView`, the attach dialog in
`SessionOpenSpecActions`), a Settings panel section, WebSocket wiring, docs, and
validation.

The *real* objective, once the steering turns clarified it, was broader than "finish the
task list": **ship a genuinely usable grouping UX** — create groups, assign changes via
per-row picker **and** drag-and-drop, keep every section a valid drop target (including
Ungrouped), fix the cramped row layout, and then fold all the post-spec refinements back
into the proposal/design/spec before verifying, syncing, and archiving.

## 2. TL;DR playbook

1. `/opsx:apply add-openspec-change-grouping` → read `openspec status`/`instructions apply`
   to learn schema + remaining tasks, then read the design + existing sibling components
   before writing a line.
2. Implement phase-by-phase (API helpers → UI primitives → surface integration → WS wiring
   → docs → validate), marking `tasks.md` checkboxes as each phase's tests go green.
3. **Restart the server before you test the UI.** New routes shipped in an earlier session
   won't exist in a process that's been running for hours. `pi-dashboard restart --dev`.
4. Verify in a real browser (`browser` skill): expand the OpenSpec section, click
   *+ Create group*, confirm the pills/sections/pickers render.
5. Take each UI complaint literally and fix it in the component, then **re-screenshot** to
   confirm — layout, drag-and-drop, redundant chips, drop targets.
6. When drag-and-drop is requested, reuse the already-present `@dnd-kit` — a **local**
   `DndContext` scoped to the grouped view (don't nest into the session-reorder context).
   Keep **every** section rendered (collapsed when inactive) so drop targets never vanish.
7. Fold post-spec refinements back into `design.md` (new decisions), `proposal.md`, and the
   delta `spec.md`; `openspec validate --strict`.
8. `/opsx:verify` → `/opsx:archive` (syncs delta specs to main specs), then commit.

## 3. How the collaboration unfolded

**Phase A — Orient before coding.** The AI ran `openspec status` and `instructions apply`
to get the schema (`spec-driven`) and the 47 remaining tasks, then read the design doc and
the existing sibling components (`FolderOpenSpecSection`, `doctor-api.ts`,
`openspec-tasks-api.ts`, shared types) to match patterns before writing. *Why it worked:*
grounding in the real code + design meant the new API helpers, palette, and primitives
slotted into existing conventions instead of inventing new ones.

**Phase B — Build the stack bottom-up.** API helpers → curated color palette → shared UI
primitives (`OpenSpecGroupSection/Pills/Picker/Manager`) → integration into the three
surfaces → Settings section → WS `openspec_groups_update` wiring in `useMessageHandler` +
`App.tsx`. Each phase ended with a targeted `vitest run` on just that phase's tests, then a
`tasks.md` checkbox flip. *Why it worked:* small verified increments; the full suite
(478 files / 4854 tests) was only run at the end.

**Phase C — Test the running UI, hit the stale-server wall.** The operator said *"create
group is not working. Test with browser."* The AI drove the browser, opened the Create
Group dialog, typed a name, clicked Create — dialog stayed open, no group. It chased client
code first, then found the real cause: **the server had been running ~48h and never
restarted**, so the group routes (implemented in an earlier session) weren't live. After
`pi-dashboard restart --dev`, the flow worked end-to-end. **Decision point:** don't debug
client code when the backend process is stale — restart first.

**Phase D — Iterate the UX on screenshots.** A rapid steering loop: add drag-and-drop
between group sections; fix the everything-on-one-line row layout (change name on line 1,
session links wrapping full-width on line 2); remove the drag grip icon (make the whole row
draggable); hide the redundant per-row group chip when the row is already inside a named
section; allow dragging back to Ungrouped (keep Ungrouped always rendered as a drop
target); make single-spec rows use full width like the multi-spec list. Each fix was
followed by a re-screenshot to confirm.

**Phase E — Reconcile the spec, verify, archive.** Post-spec refinements were folded back
in: `design.md` gained decisions **D19–D22** (drag-and-drop, hidden picker, always-rendered
Ungrouped, two-line layout); `proposal.md` got a *Post-implementation refinements* section
+ the new `DraggableChangeRow.tsx` in Impact; the delta spec gained 4 new requirements.
`openspec validate --strict` passed, `/opsx:verify` produced a clean report (89/89 tasks,
127 group tests green), and `/opsx:archive` synced the delta specs to main specs.

## 4. Prompts that worked

- **The goal prompt** — `/opsx:apply add-openspec-change-grouping`. Effective because it
  names the change explicitly, so the AI never has to guess; the skill then self-orients via
  `openspec status`. A future operator should always name the change rather than relying on
  inference.
- **`"create group is not working. Test with browser"`** — high-leverage. It both reported
  the symptom *and* prescribed the verification method (drive the real UI), which is what
  surfaced the stale-server root cause instead of a code wild-goose-chase.
- **`"I would like to drag and drop proposals between groups"`** — a crisp scope addition
  that unlocked the whole Phase D interaction model. Short, unambiguous, testable.
- **`"collect changes from all sessions which have openspec attached … and commit them"`** —
  a clean close-out instruction.

Weak prompt to rewrite: *"go on"* (prompt 2) carried no information — the AI happened to be
mid-plan so it worked, but a stronger version states the next expected milestone
("continue with Phase 5, run the phase tests before moving on").

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Debug client code when a UI action silently failed | "create group is not working. Test with browser" → found the server was stale | **Restart the server first** whenever a just-added route/endpoint "doesn't work" in a long-running instance |
| Offer only the dropdown picker for assignment | "make it drag and drop … between groups" | Propose drag-and-drop up front for any list→bucket assignment UX |
| Cram change name + sessions + controls onto one line | "alignment problems … attached spec has to go below the proposal line, and wrap" | Default to a two-line row: identity+controls on top, related items wrapping below |
| Keep a redundant group chip on rows already inside a group section | "remove the group pill when in group, duplicate indicator" | Suppress an indicator when its parent container already conveys it |
| Hide the Ungrouped section when a group pill was active (killing the drop target) | "the specs from group can be dragged to Ungrouped" | Keep **all** sections rendered (collapsed when inactive) so drop targets never disappear |
| Special-case single-spec rows to a narrow 120px width | "when single spec is presented, it is not using the whole line — as in list" | Use one consistent full-width layout for one-vs-many |
| Consider the task "done" at 89/89 checkboxes | "update changes back to proposal", then `/opsx:verify`, `/opsx:archive` | Treat spec reconciliation + verify + archive as part of the definition of done |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. Two reusable lessons are strong enough to
warrant capturing:

- **A project skill: "restart before you debug a new route."** When a freshly-added
  server route/endpoint appears broken in a long-running dashboard, the first move is
  `pi-dashboard restart --dev` (or `curl -X POST /api/restart`), *then* reproduce. This
  session burned real time chasing client code for a purely stale-process failure. A
  one-line memory ("dashboard: new server routes need a restart; check `/api/health`
  uptime before debugging") would have short-circuited it.
- **The `browser` skill as the UX acceptance loop.** Every layout/interaction fix was
  confirmed by re-screenshotting the running dashboard. This tight *change → re-snapshot →
  compare to the operator's screenshot* loop is the reusable pattern for any client-surface
  work; it belongs in the operator's default toolkit for dashboard UI tasks.

## 7. Pitfalls & dead ends

- **Stale server = phantom "broken" feature.** A dashboard running ~48h did not have the
  group routes loaded. Symptom: Create Group dialog stays open, no error. Fix: restart the
  server; check `/api/health` uptime to detect staleness.
- **Nested `DndContext`.** The grouped view lives inside the session-reorder `DndContext`
  in `SessionList`. The fix was a **separate, local** `DndContext` wrapping only the grouped
  view (the content div already `stopPropagation`s clicks), with an 8px activation distance
  so clicks aren't misread as drags.
- **Unrelated build breakage from another session.** `npm run build` failed because
  `honcho-dashboard-plugin` declared client exports whose files didn't exist yet (an
  in-progress change from a different session). A minimal stub
  (`packages/honcho-plugin/src/client/index.tsx`) was written to unblock the build — flagged
  in the verify report to reconcile when that plugin lands. If a build fails on files you
  never touched, check for a sibling in-progress change before assuming it's yours.
- **`HOME=$(mktemp -d)` for vitest.** Client tests were run with a throwaway `HOME` to
  isolate from real config — worth copying when a test reads user state.
- **Full-suite runs "time out" on capture, not execution.** The 4854-test run appeared to
  time out on output capture; it actually completed. Give it a longer timeout rather than
  assuming failure.

## 8. Reproduce it faster — checklist

- [ ] `/opsx:apply <change>` — name the change explicitly.
- [ ] Read `openspec status` + `instructions apply`; read the design doc and sibling
      components before writing.
- [ ] Implement bottom-up (API → primitives → surfaces → WS → docs), running per-phase
      `vitest` and flipping `tasks.md` as each phase goes green.
- [ ] **Restart the server** (`pi-dashboard restart --dev`) before any browser test of new
      routes; confirm via `/api/health` uptime.
- [ ] Verify each UI change in the `browser` skill and re-screenshot; take operator
      complaints literally.
- [ ] For assignment UX, reuse `@dnd-kit` in a **local** `DndContext`; keep all sections
      rendered as drop targets; 8px drag activation.
- [ ] Fold post-spec refinements into `design.md` / `proposal.md` / delta `spec.md`;
      `openspec validate --strict`.
- [ ] `/opsx:verify` → `/opsx:archive` (syncs delta → main specs) → commit.

**Key inputs to have ready:** a running dashboard on port 8000, the `browser` skill, and
`@dnd-kit` already in `package.json` (it was).

**Final artifacts (paths):** new client lib+components under
`packages/client/src/lib/openspec-groups-api.ts`,
`packages/client/src/lib/openspec-group-palette.ts`, and
`packages/client/src/components/OpenSpecGroup{Section,Pills,Picker,Manager}.tsx`,
`DraggableChangeRow.tsx`, `GroupedAttachDialog.tsx`, `OpenSpecGroupsSettingsSection.tsx`
(+ tests); reconciled `openspec/changes/add-openspec-change-grouping/{proposal,design,tasks}.md`
and delta specs; archived to
`openspec/changes/archive/2026-05-08-add-openspec-change-grouping/`.

---

_Generated from session `019e0463` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-08. Source extract: `/tmp/facts_openspec.md`._
