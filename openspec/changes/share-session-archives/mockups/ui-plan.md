# UI Plan — share-session-archives

Surfaces → tokens → states, with every decision traced to a cited public rule.
Token authority: [`ui-contract.md`](../../../../ui-contract.md) →
`packages/client/src/index.css`.

## The governing asymmetry

Most of this feature's UI follows ordinary patterns. One thing does not, and it
drives the whole design:

> **The dangerous action is the *permissive* one.** In a normal confirm dialog
> the risky act is Delete, so Delete gets the friction. In the quarantine queue
> the risky act is **Approve** — it publishes a credential to a shared store,
> and the corrective control (delete + rotate) is expensive and incomplete.
> Redacting a false positive costs the user a few readable characters in an old
> transcript. The consequences are wildly asymmetric.

So the usual "make the primary action prominent" instinct is *inverted here*:
the visually-primary action is **Redact** (safe), and **Approve** carries
friction proportional to its blast radius. This follows Nielsen **H5 — error
prevention** ("confirm risky actions") rather than defaulting to flow.

`test-plan.md` **F11** exists precisely because a badly designed queue trains
reflexive approval. The counter-design is recorded per surface below.

---

## A — Quarantine review inbox (F7, F8)

**Task:** decide, per finding, whether a pattern match is a real credential.

| State | Treatment |
|---|---|
| empty (nothing flagged) | value-named empty state, no CTA — the good state |
| pending findings | list, newest first, count in the header |
| one finding expanded | evidence in context, redaction pre-selected |
| resolved (this session) | collapsed strip with undo affordance |
| scan failed | severity-error callout, finding held, retry action |

**Tokens:** panel `--bg-secondary` at card recipe · finding row inset
`--bg-tertiary` · rule badge `--severity-warning-*` · matched span
`--severity-error-*` · resolved `--severity-success-*` · evidence block
`--bg-code`.

**Rules applied**

- **H6 recognition over recall** (NN/g) — the matched secret is shown *in its
  transcript context*, masked but positioned, so the reviewer judges the real
  thing instead of trusting a rule name. A queue that shows only "AWS key, line
  890" forces recall and gets rubber-stamped.
- **H9 error messages state cause + fix** (NN/g error-message-guidelines) — each
  finding names the rule that matched *and* what publishing it would mean.
- **H5 error prevention** — no bulk "approve all". Bulk actions are the single
  biggest driver of reflexive approval; their absence is deliberate, not an
  omission. Bulk **redact** is offered, because bulk in the safe direction is
  fine.
- **Tesler's Law** — the system absorbs the work: the redaction range is
  pre-selected on the match, so the safe path is one click and the permissive
  path is the one that costs effort.
- **H3 user control / prefer undo over confirm** (NN/g confirmation-dialog) —
  redact and drop are undoable while the segment is unpublished, so they need no
  confirm. **Approve is not undoable** (it uploads), so it is the one action
  that gets a confirm step.
- **Von Restorff** — exactly one visually-dominant action per finding: Redact.
- **WCAG 1.4.1** — the rule badge carries an icon + text, never colour alone.
- **Hick's Law** — three actions per finding, no more.

**Explicit anti-fatigue measures:** no bulk approve · approve requires
confirmation naming the rule · findings are not auto-sorted into a
"probably-fine" bucket · the count is shown but never framed as a backlog to
clear ("3 need review", not "3 blocking").

---

## B — Session card provenance (F1, F2, F3, F6)

**Task:** know at a glance that a session came from elsewhere, and what that
implies.

| State | Treatment |
|---|---|
| local (default) | no badge at all — absence is the signal |
| imported | provenance chip: shape + text + origin alias |
| imported, model substituted | additional warning chip naming both models |
| imported, non-resumable | resume affordance disabled + reason inline |
| claimed elsewhere | lock chip naming the holder alias |

**Tokens:** chip recipe from the contract · provenance `--severity-info-*` ·
substitution `--severity-warning-*` · non-resumable `--severity-neutral-*` ·
holder lock `--status-notice`.

**Rules applied**

- **H8 aesthetic & minimalist** — `SessionCard.tsx` is already 1 303 lines and
  visually dense. A local session gets **zero** new pixels; only the imported
  case pays. Adding a "Local" badge to every card would tax the common case to
  serve the rare one.
- **Jakob's Law + existing convention** — reuse the house `StatusShapeBadge`
  shape+colour pattern rather than inventing a provenance visual language.
- **WCAG 1.4.1** — provenance is shape + text; colour is redundant reinforcement.
- **H1 visibility of system status** — a substituted model is disclosed *on the
  card*, not only in the dialog that caused it, because the consequence outlives
  the dialog.
- **H9** — non-resumable states the cause ("worktree `.worktrees/feat-x` not
  present") and the fix, not just a greyed button.
- **Proximity** — provenance chips group with the existing metadata row
  (`gap-1.5`), separated from the status row by `gap-3`.

---

## C — Archive configuration page (task 6.6)

**Task:** connect a project to an archive without silently breaking sync.

| State | Treatment |
|---|---|
| unconfigured | empty state naming the outcome + single CTA |
| editing | single-column form, advanced collapsed |
| validating | inline busy on the tested field |
| connection ok | success callout with the resolved bucket |
| connection failed | error summary linked to fields + inline errors |
| configured | read-back summary, credentials masked |

**Tokens:** input recipe from the contract · error `--severity-error-*` ·
success `--severity-success-*` · advanced section `--bg-tertiary`.

**Rules applied**

- **NN/g web-form-design** — persistent labels above fields, single column,
  no Reset button, CTA is an outcome verb ("Connect archive", never "Submit").
- **Baymard inline validation** — validate on **blur**, not per keystroke.
- **GOV.UK error-summary** — a linked summary at the top for multi-field
  failure, plus inline errors at each field.
- **Progressive disclosure** (NN/g) — seal thresholds, renewal interval, and
  skew tolerance are collapsed under "Advanced". They have working defaults and
  spike 1.1 may revise them; surfacing six numeric fields up front would violate
  **Hick's Law** for every user who will never touch them.
- **H5 error prevention** — credentials are masked with an explicit reveal;
  "Test connection" exists so the failure surfaces here rather than as a silent
  daemon error later.
- **H2 match the real world** — field labels use the operator's vocabulary
  (endpoint, bucket, access key), not internal names.
- **Postel's Law** — endpoint accepts with or without scheme and trailing slash;
  normalised on save, and the normalised form is shown back.
- **Recognition** — recipient keys list shows alias + key fingerprint, not raw
  key blobs.

---

## D — Remote session listing (F4, F5)

**Task:** see sessions that exist in the archive but not yet on this machine.

| State | Treatment |
|---|---|
| listed, not materialised | dimmed card, cloud shape, "not downloaded" |
| materialising | determinate progress + cancel |
| materialised | normal card + provenance chip (surface B) |
| unavailable (blob store down) | severity-error chip, retry |

**Rules applied**

- **H1 visibility of system status** — a remote-but-not-local session must be
  visually distinct, or the user will read an empty transcript as data loss.
- **NN/g response-times + Doherty** — materialisation is budgeted at
  **p95 < 5 s** (`test-plan.md` P2). Above 1 s that mandates a busy indicator;
  the 5 s budget with a real network makes a **determinate** bar with cancel the
  right call, not a spinner.
- **Common region** — remote sessions render in the same list, not a separate
  screen, because the user's mental model is one project history.
- **WCAG 1.4.1** — "not downloaded" is a shape + label, not a dimmed colour
  alone (dimming alone fails for low-vision users).

---

## E — Resume preflight dialog (X19, E38)

**Task:** choose a model when the recorded one is unavailable or too small.

| State | Treatment |
|---|---|
| model available + sufficient | **no dialog at all** — resume proceeds |
| model unavailable | dialog, recorded model named, candidates listed |
| candidate too small | that option disabled + reason |
| no sufficient candidate | dialog explains and offers the escape hatch |

**Rules applied**

- **NN/g modal vs non-modal** — a modal is justified only because the user must
  decide before continuing. When the recorded model resolves, **no dialog is
  shown** — spec `E37` says so, and an "everything is fine" confirmation is
  exactly the extraneous load **H8** warns about.
- **H9 + capacity honesty** — an insufficient candidate is disabled with the
  number stated ("199 k window < 269 644 tokens recorded"), not silently hidden.
  Hiding it would leave the user wondering where their model went.
- **Button labels are outcome verbs** (NN/g ui-copy) — "Resume on Sonnet",
  not "OK".
- **H3 user control** — Cancel is always available and visually subordinate.
- **Tesler's Law** — the system pre-selects the closest sufficient model; the
  user confirms rather than researches.

---

## F — Claim refusal + handover (F9, X20)

**Task:** understand why resume is blocked and what to do instead.

| State | Treatment |
|---|---|
| refused | who holds it (alias), since when, what you can do |
| holder idle, expiry approaching | countdown to availability |
| released | inline promotion to "Resume now" |

**Rules applied**

- **H9 + H3** — a refusal that only says "denied" is a dead end. This surface
  always offers a forward path: **wait** (with the expiry countdown), **fork**,
  or **open read-only**.
- **H2 plain language** — "Robson's laptop is working on this session" beats
  "claim CAS rejected"; the machine is named by its display alias, never a
  hostname (transport spec forbids hostnames in the index).
- **H1** — the countdown makes an otherwise invisible lease legible.
- **Zeigarnik/Goal-gradient** — showing time-to-availability converts a hard
  block into a progress state.

---

## G — Backfill scope picker (F10)

**Task:** choose how much history to publish, without blowing the quota.

| State | Treatment |
|---|---|
| choosing | two options with live estimates |
| estimate over limit | warning callout, primary action gated |
| running | determinate progress, per-session count, cancel |
| complete | summary with what published and what was held |

**Rules applied**

- **H5 error prevention** — the estimate is computed and shown *before* upload;
  exceeding the configured limit requires explicit confirmation.
- **Hick's Law** — exactly two scopes (full / horizon), not a free-form date
  matrix.
- **NN/g response-times (>10 s)** — backfill of 4 224 sessions is long-running,
  so it needs a **determinate** indicator plus **cancel**.
- **Goal-gradient** — progress is front-loaded with counts, not a bare spinner.
- **H1** — the completion summary distinguishes published from quarantined, so
  a held session is not mistaken for a failure.

---

## Cross-surface invariants

1. Machines are always named by **display alias**, never hostname (transport
   spec). One noun everywhere — **H4 consistency**.
2. Every state that matters carries **shape/icon + text**, never colour alone.
3. Placeholders `{{CWD}}` / `{{HOME:remote}}` are never shown raw to the user in
   a path position; the UI shows the resolved local path, or an explicit
   "unresolved on this machine" state.
4. No surface displays a raw secret, including in the quarantine evidence view —
   the match is masked, its position and rule are what get shown.
5. Every mockup uses **real product nouns**: real model ids, real session ids,
   real paths from this repo. No `Acme` / `Jane Doe`.
