---
session: 019e7a1e
week: 2026/W22
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Fixing the Astro Kraken-brain backdrop — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user pasted a browser console dump from the marketing site's Astro page and said:

> "In astro page sometimes on loading the brain haven't appeared." — followed by three
> raw console lines: `Unchecked runtime.lastError: The message port closed…`, a
> `Canvas2D: … willReadFrequently` warning, and `Uncaught IndexSizeError: … createRadialGradient … r1 provided is less than 0` in `drawSparks`.

The **real objective**, once decoded, was to fix an animated canvas background
component (`KrakenBrainBackdrop.astro`) that had three distinct symptoms: (1) a hard
runtime crash from a negative gradient radius, (2) a performance warning about
repeated `getImageData` calls, and (3) an intermittent failure where the brain
silhouette never rendered. Then commit, push without triggering CI, and verify the
build in a browser.

## 2. TL;DR playbook

1. Paste the **full console output verbatim** (errors + warnings + stack frames) as the goal prompt — the stack traces point straight at the file and function.
2. Let the AI locate the component: `find … -name "*.astro"` → `ls site/src/components | grep -i brain`.
3. Have it **triage each console line separately** — root-cause first, don't patch symptoms. One of the three lines (`message port closed`) is a browser-extension artifact, not your bug.
4. Ask for **surgical fixes only** — clamp inputs at the crash site, add the `willReadFrequently` hint only where `getImageData` is actually called, add retry + graceful fallback for the asset load.
5. `commit` — this repo uses **jj (Jujutsu)**, not plain git; the AI runs `jj commit`/`jj describe`.
6. `push with [ci skip] to avoid build` — put `[ci skip]` in the commit message so CI workflows skip.
7. `build astro and open in browser` — `cd site && npm run build && npm run preview`, confirm HTTP 200, launch browser.

## 3. How the collaboration unfolded

**Phase 1 — Locate & triage (Discovery).** The AI ran two `find`/`ls` probes to pin
the component to `site/src/components/KrakenBrainBackdrop.astro`, then read it and
decomposed the console dump into three independent problems. *Why it worked:* it
resisted the urge to blanket-patch and instead traced each error to a root cause —
including correctly identifying that `Unchecked runtime.lastError: The message port
closed` comes from a browser extension (password manager / ad blocker), **not** the
site code, so nothing needed fixing there.

**Phase 2 — Surgical fix (Design + Generate).** A single `edit` to the component
addressed all three real issues:
- `drawSparks` `IndexSizeError`: clamped `u` to `[0,1]` and `radius` to `≥ 0.01`. Root
  cause was subtle — rAF's `now` timestamp lags `performance.now()` used at spawn, so
  freshly-spawned sparks had `age < 0` → negative radius.
- `willReadFrequently`: added the hint to the two `getContext("2d")` calls
  (`buildKeyed`, `makeEdgeFinder`) that actually call `getImageData`.
- Missing brain: `loadBrain()` now retries up to 2× with 400 ms backoff + cache-buster;
  `buildKeyed()` returns the raw-image canvas instead of `null` when `getImageData`
  throws on a CORS-tainted canvas (the `source-in` recolor only needs native alpha).

**Phase 3 — Land it (Verify).** Three short steering prompts drove commit → push →
verify. The AI committed via **jj** (`jj commit` / `jj describe`), left unrelated
openspec files uncommitted, pushed `develop` with `[ci skip]`, then built and previewed
Astro, confirming `http://127.0.0.1:4321/` returned HTTP 200 before launching the
browser.

**Decision points:** the human chose *when* to stop fixing and commit ("commit"), how
to push (`[ci skip]`), and demanded a real-browser verification rather than trusting the
build exit code.

## 4. Prompts that worked

- **The goal prompt** (effective): pasting the **raw console output including stack
  frames** (`at drawSparks ((index):312:27)`) gave the AI exact file/function/line
  anchors. A vague "the brain doesn't load" would have forced a hunt; the stack trace
  made triage instant.
- **`commit`** — a one-word unlock once the fix was reviewed; the AI already knew the
  repo VCS (jj) and wrote a descriptive conventional-commit message.
- **`push with [ci skip] to avoid build`** — high-leverage: names both the action and
  the constraint, so the AI put the skip token in the right place.
- **`build astro and open in browser`** — forces end-to-end verification, not just a
  "should work now."

*Weak-prompt rewrite:* instead of a bare `commit`, prefer **"commit only
KrakenBrainBackdrop.astro; leave unrelated files"** — the AI did the right thing here,
but stating scope prevents accidental staging of the uncommitted openspec files.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Fix, then wait for direction on landing | Explicit `commit` | State up front: "fix, then commit only the touched file" |
| Push normally (would trigger CI) | `push with [ci skip] to avoid build` | Say "push with `[ci skip]`" whenever a doc/asset-only change shouldn't burn CI |
| Trust the build exit code | `build astro and open in browser` | Ask for a real browser + HTTP-200 check as the definition of done |

No hard corrections were needed — the fix itself was accepted on the first pass. The
steering was all about **the landing sequence** (commit → skip CI → verify), which is
where a future operator should be explicit.

## 6. Skills, tools & memory created — and why they're effective

None created this session. But two things are worth capturing as memory for this repo:

- **This project uses jj (Jujutsu), not plain git** — the AI correctly ran
  `jj commit` / `jj describe` / `jj log -r 'develop..@-'`. A durable project memory
  ("VCS is jj; commit via `jj commit <path> -m …`") would save re-discovery.
- **`[ci skip]` convention** for asset/site-only pushes to `develop` — worth a memory so
  it's applied without being asked.

If this canvas-debug pattern recurs (triage a console dump → surgical single-file fix →
jj commit + `[ci skip]` + Astro preview verify), it would justify a small project skill.

## 7. Pitfalls & dead ends

- **`message port closed` is not your bug.** `Unchecked runtime.lastError: The message
  port closed before a response was received` is emitted by browser extensions. Don't
  chase it in site code.
- **`willReadFrequently` is a warning, not an error** — only add the hint to the
  `getContext("2d")` calls that actually call `getImageData`; blanket-adding it elsewhere
  is noise.
- **Negative gradient radius is a timing bug, not a math bug.** The `r1 < 0` came from
  rAF's frame `now` lagging the `performance.now()` used at spawn — clamp the derived
  value rather than reworking the timestamp source.
- **Don't push normally on site-only changes** — without `[ci skip]` you burn a CI build
  for nothing.
- **jj, not git:** `git status` shows the tree but commits go through `jj`.

## 8. Reproduce it faster — checklist

- [ ] Paste the **full console dump with stack frames** as the goal prompt.
- [ ] Locate the component: `find … -name "*.astro"` / `ls site/src/components`.
- [ ] Triage each console line to a root cause; drop browser-extension noise
      (`message port closed`).
- [ ] Apply a **single surgical edit**: clamp the crash input, add `willReadFrequently`
      only where `getImageData` runs, add asset retry + CORS-safe fallback.
- [ ] `jj commit <file> -m "fix(...): …"` — scope to the one touched file.
- [ ] Push with `[ci skip]` in the message to avoid a CI build.
- [ ] `cd site && npm run build && npm run preview`; confirm HTTP 200; open browser.

**Key inputs:** the browser console output (with stack traces), repo checked out with
jj, `site/` Astro workspace. **Artifacts produced:** edited
`site/src/components/KrakenBrainBackdrop.astro`; jj commit on `develop` pushed with
`[ci skip]`; preview at `http://127.0.0.1:4321/`.

---

_Generated from session `019e7a1e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-30. Source extract: session facts sheet (Astro site loading error)._
