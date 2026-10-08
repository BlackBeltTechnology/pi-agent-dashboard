# set-copilot in a client offer project — playbook

**For:** an agent (and its operator) in another organisation that wants to run `set-copilot` the
way we ran it on a real client call. You have `set-copilot` and set-core, but not our project
repository, so this document carries what the repository would have shown you: what we configured,
why, what broke, and what we would change.

**Anonymised on purpose.** The client, its partners, the people and every business figure are
replaced by roles ("the client", "the platform vendor", "the partner's project lead"). Nothing
in here is client data. Configuration shapes and lessons are real; values that would identify
anyone are placeholders like `<client-term>`.

---

## 1. The situation it was built for

- A **quotation project**: a ~1,000-employee manufacturing client wants to replace an Excel-based
  shift-planning and payroll-preparation chain. A platform vendor is the prime contractor, its
  partner writes the concept, and we quote the custom-development part.
- One **60-minute English video call** with the vendor side (three people) and our side (two or
  three). The vendor's 42-work-package implementation plan was the agenda's backbone. Our goal was
  to leave knowing **which part we quote and what we need to quote it**, without saying any number.
- The copilot ran in **one Claude Code session** on the operator's machine. Its **wall** (a browser
  page) was **screen-shared to the client side for the whole call**. That one fact drove most of
  the design: everything on the wall is public, and the terminal is the only private channel.

The same setup was later used for an internal demo with the mirror switched on (section 8 has the
lessons from both).

## 2. The moving parts

```
 mic ─┐                                   ┌─ /wall        (shared tab — public)
      ├─ set-copilot capture ─ Soniox STT ─┼─ /transcript  (live transcript — never share)
 sys ─┘        │                           └─ wall-events.jsonl
               ▼
      transcript.jsonl  ──poll──▶  Claude Code session  = the copilot
                                    │  reads: digest + the files the instructions list
                                    │  policy: `set-copilot prompt` (config + instructions .md)
                                    ├─ chat            → private (alerts, figures, unlocks)
                                    └─ wall-emit / tools/*.py → wall (redacted server-side)
```

- **set-copilot** does audio, transcription, the poll stream, the wall server and its redaction.
  It knows nothing about the domain.
- **The Claude Code session is the copilot.** There is no separate AI process: the
  `meeting-copilot` skill runs a Monitor loop on `set-copilot poll` and the session answers each
  batch.
- **The project repository** supplies all the domain: knowledge files, the copilot's policy, and
  helper scripts that put ready-made states on the wall.

## 3. What you write in your own project

| File | Role | Our size |
|---|---|---|
| `set-copilot.config.json` | knowledge sources, keyword routing, alert categories, command words, speaker names, wall layout + per-box policy + redaction | ~640 lines |
| `docs/copilot-prompt.md` | the standing instructions, pointed to by `copilot.instructions`; rendered into `set-copilot prompt` | ~150 lines |
| `docs/prep/<date>-call-guide.md` | one page: what must be settled first, what we lack, what we never say | 1 page |
| `docs/prep/<date>-questions.md` | every question with an ID (`Q2.1`), priority (MUST/SHOULD/CAN-WAIT) and our default answer | ~45 questions |
| `docs/prep/<date>-dryrun.md` | 20-minute pre-call checklist | 1 page |
| `tools/wall-opening.py` | puts the fixed opening state on the wall | ~100 lines |
| `tools/<board>.py`, `tools/wall-visuals.py` | ready-made canvas visuals the copilot switches to by topic | ~150 lines each |
| `wall-assets/figures/*.png` | the client's own diagrams, under a path the redaction leaves alone | 9 images |
| `docs/meetings/` | archived transcripts + notes (the runtime dir is gitignored) | per meeting |

### 3.1 `set-copilot.config.json` — what we set and why

Abridged and anonymised; the full field reference is the set-copilot README and
`set-copilot.config.example.json`.

```jsonc
{
  "language": "en",                       // the call was English; Hungarian side talk still transcribes
  "knowledge": {
    "adapter": "markdown",
    "sources": [                            // CURATED, not docs/**  — see §4
      "CLAUDE.md", "docs/*.md", "docs/prep/*.md", "docs/meetings/*.md",
      "docs/research/*.md", "docs/input/mail-log.md",
      "docs/input/<package-from-the-vendor>/*.md"
      // raw employee registries, timesheets, attendance exports: deliberately NOT here
    ],
    "autoKeywords": true,
    "keywords": [                           // 28 topics → stems; the digest made 142 keywords
      { "topic": "the scheduling app", "stems": ["<product name>", "\\bPP\\b"] },
      { "topic": "work packages",      "stems": ["work package", "\\bWP\\s?\\d", "\\bK[0-7]\\b", "man-?day", "\\bMD\\b"] },
      { "topic": "payroll loop",       "stems": ["payroll", "<local payroll term>"] },
      { "topic": "price / estimate",   "stems": ["price", "offer", "estimat", "day rate", "budget"] },
      { "topic": "local labour rules", "stems": ["overtime", "night.?(shift|work)", "sunday", "minimum.?wage"] }
    ]
  },
  "copilot": {
    "instructions": "docs/copilot-prompt.md",
    "alerts": [                             // replaces the default taxonomy
      { "key": "contradiction", "emoji": "⚠",  "priority": "high", "notify": true,
        "when": "contradicts a documented fact, a decision or the phase-1 boundary. Cite the file." },
      { "key": "number",        "emoji": "💰", "priority": "high", "notify": true,
        "when": "a man-day figure, price, rate, range or deadline is asked or floated. The card NEVER contains the figure; name that it was asked and give the standing answer." },
      { "key": "ownership",     "emoji": "🧭", "priority": "high", "notify": true,
        "when": "a work package is discussed as if we build or support it while the split is not agreed." },
      { "key": "context",       "emoji": "📋", "priority": "medium", "when": "a recorded fact the speakers may not have in mind. Quote and cite." },
      { "key": "new decision",  "emoji": "✏",  "priority": "medium", "when": "something is being decided. Summarise for the note." },
      { "key": "question",      "emoji": "❓", "priority": "low",    "when": "the knowledge base is silent or the prep lists it as open." }
    ],
    "fastLane": { "enabled": true, "start": ["copilot"], "end": ["do it", "csináld", "vége"] }
  },
  "transcript": { "speakers": { "mic": "<Operator> · <Company>", "system": "Others on the call" } },
  "wall": {
    "redaction": { "patterns": [ /* 12 regexes, see below */ ], "replacement": "[…]", "maxInputLength": 1000 },
    "presentation": { "title": "<Project> · Working session", "locale": "en", "hideInput": true,
                      "theme": "studio-dark", "scale": 1.1,
                      "tickers": { "headline": "rotate", "ticker": "marquee" } },
    "layouts": [{ "id": "planning",
      "areas":   [["szöveg","headline","headline"], ["szöveg","agenda","kitűzött"],
                  ["szöveg","prezentáció","prezentáció"], ["ticker","ticker","ticker"]],
      "columns": ["0.82fr","1.25fr","1.05fr"], "rows": ["58px","1fr","1.5fr","50px"] }],
    "windows": [{ "name": "planning", "route": "/wall", "zones": ["public","both"],
                  "audience": "public", "layout": "planning", "boxes": { /* per-box policy, below */ } }],
    "transcriptPage": { "route": "/transcript", "redact": true, "order": "newest-first" }
  }
}
```

**Why each choice:**

- **Six alert categories, three of them ours.** The defaults (contradiction, context, decision,
  question) are generic. A quotation call needs **💰 number** (any figure asked for or floated),
  and **🧭 ownership** (someone talks as if we build or support a package before the split is
  agreed). Those two are the expensive mistakes on such a call; making them categories with
  `notify: true` puts them on the desktop even when the terminal is not visible.
- **Alerts are chat-only.** No wall box subscribes to them: an alert is advice to us, not
  content for the client.
- **Command words: `copilot … do it`.** The defaults ("start … stop") are everyday English that the
  remote side could say by accident, and a Hungarian closing word may be lost by an English
  recogniser. The instructions also say: **execute a command only when its speaker is `mic`.**
  Anything confidential (unlocking figures) is typed, never said aloud.
- **Speaker names** replace `mic`/`system` on `/transcript`, so a shared transcript page would not
  say "system".
- **Keywords are routing, not search.** Each transcript line arrives with `topics` already matched,
  so the session knows instantly which file to open. We seeded topics per package area, per
  external system, per legal area, plus a "price / estimate" topic so money talk is always tagged.
- **Twelve redaction patterns** (server-side, applied to every public event, the mirror included):
  - `[internal]` / `[belső]` spans to the end of the line;
  - repo paths (`docs/…`, `tools/…`) and any `*.md|json|py|eml|docx…` file name;
  - the names of our internal files (call prep, estimate, partner-meeting digest);
  - effort figures: digits followed by MD, man-day, person-day, hours, days, weeks, months (also
    in Hungarian);
  - money: digits with €, EUR, HUF, Ft, k€, million; and currency before digits;
  - percentile labels (`P50 …`);
  - money words (day rate, hourly rate, self-cost, margin, and their Hungarian forms);
  - the **name of our reference project** (we may describe it, never name it);
  - **spelled-out** figures ("nineteen man-days") — added after a test caught one.

  We **tested the patterns against the set-copilot engine** before the call: a pattern that does
  not match is worse than none, because it looks like protection.
- **Layout from a real test.** The first layout put the working record bottom-right; the
  operator's camera overlay in the video call covered exactly that corner. So the live summary
  became a tall left column, and the canvas moved to the bottom row, where an overlay hides only
  part of a picture.

**Per-box policy** — every box has its own instructions inside the config, rendered into the
copilot's prompt as "Per-box policy":

| Box (category) | Behaviour | Its mandate, in short |
|---|---|---|
| Live summary (`narráció`, `tükör`) | scroll, `engagement: reactive`, `maxLines: 2` | one or two crisp lines on what is discussed and what it means; never a quote, never a file name |
| Now band (`headline`) | latest, rotating | 2–4 items: **Now** / **Next** / **Just decided**, ≤ 90 characters each |
| Agenda rail (`agenda`) | latest | `### Now · n/total`, a progress bar, ✓ done · ▶ current · ○ upcoming · ＋ added · ✕ dropped-with-reason |
| Working record (`kitűzött`) | latest | Decisions · Open questions · Action items (owner — action) |
| Canvas (`architektúra`, `metrika`, `előrejelzés`) | latest, 8 s minimum dwell | the drawing for the current topic |
| Context ticker (`ticker`) | latest, marquee | 5–9 background facts with a bold lead-in |

Two rules every "latest" box shares: **send the whole block every time** (an update replaces the
box, so sending only the changed line deletes everything else), and **never a number of effort or
money**.

### 3.2 `docs/copilot-prompt.md` — the instructions file

This is where the domain lives. Its sections, in the order we found necessary:

1. **Pre-read list — read these in full before the wall opens.** The digest is a *heading
   index*, not content: a copilot that answers from the digest knows that a file exists, not
   what it says. So the file lists ~25 documents to Read end to end, in parallel, with paging for
   the long ones (`offset` 1, 351, 701 …), and asks for one terminal line:
   `Pre-read: n/total files, lines — missing: …`. The dry run waits for that line.
   *Measured:* the first version abbreviated a folder path with `…`; a dry-run reader had to list
   the directory to resolve it. Spell paths out.
2. **Who is who** — a table: person, side, role in the deal. Names and roles only.
3. **Where the deal stands** — five bullets with dates. What the other side asked for, in their
   words; what document is now the scope; why our earlier estimate does not price it.
4. **The number lock.** The wall is screen-shared, so **no figure of effort or money appears
   until an operator types an unlock in the terminal.** A number said aloud — even by us — is
   not an unlock. The estimate may be used as *information* (what it covered, which risks it
   named), never as a figure. Our detailed internal re-plan is deliberately **outside**
   `knowledge.sources`; the copilot opens it only when the operator asks in the terminal, and
   answers in the terminal.
5. **What goes on the wall and how it reads.** English only. Cite client documents **by title and
   section**, never by file path. Never quote a person, never characterise anyone. Only content
   that everyone on the call may see: nothing from another project or client. Share only `/wall`,
   never `/transcript` or the terminal.
6. **The planning view** — a table of the six wall areas, each with one job and an update trigger
   (see 3.1). Without it, the copilot updates everything every batch.
7. **Open with a script, not with words.** "Before anyone speaks, run `tools/wall-opening.py`."
   The first frame the client sees should not depend on phrasing in the moment.
8. **The opening agenda** with the question IDs behind each item, and the rule that the agenda
   is a **living plan**: insert topics taken now (＋), rename, split, reorder, mark dropped items
   ✕ with the reason (the wall renders no strikethrough), recount n/total. Topics for later go
   under `### Parked`, never dropped.
9. **Track the question list.** Seed the working record with the MUST questions of the current
   agenda item only. When one is answered, move it to Decisions and say in the terminal which
   default it replaces. Before an item closes, list open MUSTs **in the terminal** — never nag on
   the wall. At the end, list every open MUST and unreached SHOULD: that is the follow-up mail.
10. **Switch the canvas to what is discussed** — a table "when the talk is about X → run
    `tools/… Y`", and a second one for the client's own figures. **Prefer the client's own
    figure**: they recognise their material at once.
11. **What we do NOT say** — no number, no margin, no reference-project name, no commitment to
    on-site time, hosting or SLA.
12. **Extra flags** beyond the alert set — scope added on the fly, the phase-1 boundary (systems
    that must not be touched), client inputs treated as available, support depending on code we
    no longer control.
13. **Knowledge map** — need → file, so lookups during the call are one Grep, not a search.

## 4. The knowledge base — why it is built this way

```
docs/
  input/        verbatim client material: every mail as .eml (the record) + converted .txt/.md,
                attachments unpacked and converted; mail-log.md = all mails in one file
  research/     our summaries — client-safe by construction; one topic per file
  prep/         the call: one-page guide, question list with IDs and defaults, dry run
  meetings/     archived transcripts (.md / .jsonl / -stitched.jsonl) + notes
  estimate/     internal — never in knowledge.sources
  *.md          analyses (what the client files really contain, what the existing code covers)
```

The principles, each learned the hard way:

- **The `.eml` is the record; the converted file is for reading.** Neither is edited. A mail
  importer (from a local `notmuch` index) plus a renderer that writes **one chronological
  `mail-log.md`** means the copilot can answer "what did they say about X in August" with a single
  Grep instead of opening twenty files.
- **Personal data stays out of the index, by path.** The client's employee registry, timesheets
  and attendance exports carry national IDs and names. They are not in `knowledge.sources`; their
  *structure* is summarised in an analysis file. A file that is not indexed cannot be surfaced by
  accident onto a shared screen.
- **Internal and client-safe material are separated at file level**, not by marking passages.
  `research/` is written to be client-safe; `estimate/` and the partner-meeting digest are
  internal. Redaction is the backstop, not the plan.
- **Images in client documents are text you are missing.** The `.docx → .md` conversion kept the
  running text but dropped all 35 embedded figures — and several facts existed only in figures (a
  third converter tool, a file format's column count, screenshots contradicting an agreed rule, a
  workflow no work package covered). We transcribed every figure into
  `research/client-doc-figures.md`, marking the "figure-only" facts, and exported the safe figures
  (no worker names) as PNGs for the wall.
- **Every analysis says what it measured and how**, so any figure can be checked. The copilot
  quotes with a citation; a fact without a source is a guess.
- **One page beats forty-five questions.** The question list had grown to 45; the call needed
  three things settled first. The one-page call guide says what to settle, what the documents
  reference but we never received (in a table, neutral wording, because it goes on the wall as
  "Materials we still need"), and what we never say.
- **Local rules as a brief.** A one-page brief of the client country's labour and payroll rules
  that touch the plan (overtime caps, written-order rules, rest periods, non-taxable caps), each
  marked *fits / conflict / gap / depends*, with the statute texts saved locally. Raised only if
  the topic comes up; they are questions for the client's adviser, not ours to settle.

## 5. How the configuration organised the meeting

**Before (the evening and morning before):**

1. Build the knowledge base and the config; run `set-copilot digest` and read the prompt it renders.
2. Write the call guide; derive `tools/wall-opening.py` from it.
3. **Dry run, 20 minutes**: start, wait for the pre-read line, check the opening state item by item,
   drive every feature once by voice (canvas switch, ownership recolour, "how many man-days?" →
   *nothing* on the wall, a park command), press the wall's keys (F full screen, ←/→ tabs, A auto),
   then a 30-second **leak check** (no file names, no figures, nothing from the terminal).
4. **Stop and restart clean** ten minutes before the call — test content must not carry over; a
   new session gets a new, empty runtime dir. Hard-reload the wall tab (the browser may hold an old
   script).

**Starting:** `set-copilot meeting` from the project directory. It runs `doctor` as a gate, then opens
a Claude Code session on `/meeting-copilot start wall` — capture, wall and stop are owned by that
session. **No mirror on a client call**: the chat is the private channel.

**During:**

- Share **one browser tab** (the wall), never the screen.
- The agenda rail, Now band, working record and canvas move with the conversation. When ownership
  of packages was agreed, the board was recoloured (`tools/<board>.py --owner '1.*=us' 0.6=us …`) —
  the most visible sign that the call was producing decisions.
- Steering is typed in the terminal ("move handover before delivery", "show the integration map").
- Alerts (💰, 🧭, ⚠) arrive in the terminal and as desktop notifications.

**After:**

- `/meeting-copilot stop` archives the transcript and writes three files. **Read the `.md`**
  (stitched sentences), never the raw `.jsonl` (fragments, cut mid-word, two channels interleaved)
  — a client fact was once lost by a note-taking step that read the raw file.
- Copy the three files into `docs/meetings/` (the runtime dir is gitignored), write notes that cite
  transcript **turn numbers** (`[0123]`), and commit both. The notes separate takeaways, internal
  commercial remarks, requirements heard, decisions/action items, and what was *not* discussed.

## 6. Commands we actually used

```bash
SET_COPILOT_DIR="$PWD/.set/copilot/${CLAUDE_CODE_SESSION_ID:-shared}"   # prefix EVERY command with this
npx set-copilot digest && npx set-copilot prompt         # knowledge index + the rendered policy
npx set-copilot capture --max-minutes 240 --detach       # never as a background tool call (see §7)
npx set-copilot wall --no-fake-feed --port <p> --detach
npx set-copilot wall-emit '<json or array>'              # what the scripts and the session call
npx set-copilot mirror-follow                            # only when mirroring; then doctor --mirror
npx set-copilot stop && npx set-copilot wall-stop
set-copilot meeting                                      # the one-command launcher
```

The helper scripts are plain Python calling `set-copilot wall-emit` with the caller's
`SET_COPILOT_DIR`; each has a `--print` flag to show the event instead of emitting it, which is how
we reviewed them before the call.

## 7. Lessons — what broke, and what fixed it

| # | What happened | What we changed |
|---|---|---|
| 1 | The capture ran as a background tool call; the harness killed it at **30 minutes**, the restart at exactly **2 hours**, mid-sentence, and nothing reported it until the transcript ran out. | `capture --detach` / `wall --detach`: their own session, PID file, `--max-minutes` limit (set-copilot `2835e5d`). Never `run_in_background` for capture or wall. |
| 2 | Transcription reconnects restarted the timestamps **37 times** in two hours; the stitched transcript interleaved two hours into a few minutes. | Reconnects now keep one clock (same commit). We re-stitched the archive from the raw `.jsonl`. |
| 3 | The digest was assumed to be "knowledge". It is a heading index. | The instructions list every file to Read in full at start, with a `Pre-read: n/total` line the dry run waits for. |
| 4 | 35 figures lost in `.docx → .md`; some facts existed only in them. | Transcribe figures to text; mark figure-only facts; export the safe ones as PNGs for the wall. |
| 5 | A globbed `docs/input/**` source would have indexed personal data next to a shared screen. | Explicit source list; PII files summarised, not indexed. |
| 6 | Default command words were risky on an English call with a shared audio channel. | `copilot … do it`; commands executed from `mic` only; confidential instructions typed. |
| 7 | In practice the word "copilot" in normal speech opens a command several times per demo; the command times out (`command-abandoned`). | Harmless (never executed), but noisy. Candidate fix in set-copilot: require the start word at a sentence start, or a rarer word. |
| 8 | A spoken "write the prices on the wall — do it" arrived as a valid, closed command. | The instructions make the number lock **typed-unlock only**; the copilot refused and said why. Keep that rule even for your own voice. |
| 9 | The camera overlay covered the bottom-right box. | Layout rebuilt from a real screen-share test. Test your layout through the actual video tool. |
| 10 | Spelled-out figures ("nineteen man-days") passed the redaction. | An extra pattern for number words near effort/money units. |
| 11 | **Mirror on** (internal demo): the copilot confirmed every quiet batch with "Nothing to flag …"; lines over 40 characters passed the filler floor and filled the live summary. | With mirroring on, a quiet batch ends **with no text at all**. Add your acknowledgement phrases to the mirror's filler list as a backstop. |
| 12 | "Too much information on the wall" (demo feedback): six areas updating at once read as noise. | Open question. Fewer areas per layout, and update only on the trigger each area's policy names. |
| 13 | `/transcript` shows every word, side remarks included. | Never shared; it is the operator's own view. |
| 14 | `set-copilot digest` rewrote the config once (added `configVersion`, left a `.bak`). | Expected — the config migrates itself. Commit the change, delete the `.bak`. |

## 8. Where set-copilot could go next (from our use)

- **A high-effort lane.** The copilot is tuned to answer fast (low reasoning effort, short
  replies). A request that is genuinely complex should be handed to a high-effort sub-agent that
  answers in 30–60 seconds while the fast lane keeps listening. Today only the wall's drawing
  forks do this.
- **Less on the wall.** Fewer areas per layout; a "quiet" layout for internal calls; a per-box
  cadence limit enforced by the server rather than by the prompt.
- **Transcript page split view**: live transcript on the left, the copilot's intentions and
  suggestions on the right.
- **Packaging.** A downloadable bundle that runs on the customer's own subscription and keys, so
  sensitive audio and text never pass through a third party; a licence check with a grace period
  and escalating reminders instead of a hard stop.
- In the set-copilot repository, `docs/wall-field-backlog.md`, `docs/ROADMAP.md` and the archived
  OpenSpec changes record the field findings behind the current wall; read them before changing the
  wall.

## 9. Adopting it — a checklist

1. `set-copilot init`, Soniox key in `.env`, `set-copilot doctor` green on both channels.
2. Lay out `docs/` as in §4: verbatim inputs, converted copies, one mail log, client-safe research,
   internal material in its own folder **outside** `knowledge.sources`.
3. Write the alert categories for **your** expensive mistakes (ours: a number, ownership).
4. Write the instructions file in the §3.2 order; keep "who is who" to names and roles.
5. Design the wall for the screen it will be shared on; give every box one job and one trigger.
6. Write redaction patterns for everything internal, and **test them** with `wall-emit` before the call.
7. Script the opening state and the visuals you expect to need.
8. Dry run with a leak check; restart clean before the real meeting.
9. After the meeting: archive the `.md`, write notes with turn citations, commit.
