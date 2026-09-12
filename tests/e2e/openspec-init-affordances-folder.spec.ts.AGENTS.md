# openspec-init-affordances-folder.spec.ts

L3 FOLDER-SECTION slice of change `add-openspec-init-affordances` (test-plan
#F1 #F2 #F3 #F12 #F13 #F14 #F15 #F16 #F17 #X9, tasks 2.48–2.65). Asserts the
folder-header `FolderOpenSpecSection` through real harness round-trips: ABSENT
offer + suppression switch, height parity across ABSENT/BROKEN/STALE/READY,
live Initialize convergence (real in-container CLI spawn), dismiss →
`optOutDirectories`, menu re-enable, cli-failed (no repair), both confirm
dialogs (repair-cancel sends nothing; init-over accept carries `confirm:true`,
route-aborted), and init-failure stderr surfacing.

## Mechanics

- Dirs `/fixtures/e2e-oia-<RUN>-<name>` (unique per run) created via
  `docker exec` on the container resolved by `publish=<dashboardPort>`.
- Config: `openspec` block RMW over `PUT /api/config` (deep-merge); poll
  interval dropped to the 5s clamp for the run, snapshot-restored in afterAll.
  Stale `e2e-oia-` optOut entries purged in beforeAll (crashed-run hygiene).
- `pinAndExpand` settles the WS-hydration flip (onboarding→dashboard) before
  pinning — pinning mid-flip clicks a detaching CTA.
- Documented in-container recipes (header comment of the spec):
  - cli-failed = `changes/demo/tasks.md` self-referential symlink (`openspec
    list --json` exits 1 on ELOOP); invalid YAML / config-as-dir / changes-as-
    file / chmod 000 / symlink loop are all tolerated by CLI 1.6.0.
  - init failure = dangling `<cwd>/openspec` symlink (guard stat passes
    unconfirmed, CLI mkdir fails ENOENT exit 1 → 500 + stderr).
- Two PRODUCT GAPS documented in-code (not fixed by the spec, per mandate):
  1. `offerInitialization` is mount-only hydration (App.tsx `useEffect []`) —
     live pages ignore Settings toggles until reload.
  2. `buildOpenSpecConnectSnapshot` omits `readiness` for non-initialized cwds
     and the poll dedupes unchanged broadcasts → after a reload an ABSENT
     pinned dir loses its Initialize offer even with the switch on. F2
     controls against a BROKEN dir to avoid depending on that path.
