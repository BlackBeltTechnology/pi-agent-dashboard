# Upstream issue drafts (task 6.1)

Drafts only. Nothing is filed without per-issue approval. Evidence: `design.md` §Context and §Implementation findings; harness `/tmp/craftweb-spike`.

## 1. storytold/{pdfcraft,cadcraft,designcraft,soundcraft,deckcraft,lightcraft,filmcraft}: emit a viewport `Title` naming the open document

**Title:** Web build: report the open document in the viewport title

**Body:**
The web builds of WordCraft, GridCraft, PhotoCraft and VectorCraft send `ViewportCommand::Title("<document> — <App>")` (eframe logs it as `Unhandled egui viewport command: Title(…)` on the web). PdfCraft, CADCraft, DesignCraft, SoundCraft, DeckCraft, LightCraft and FilmCraft send no title (LightCraft a static `LightCraft`). An embedding host (pi-agent-dashboard, sandboxed iframe) uses the title to confirm WHICH document the app opened and whether it has unsaved changes. Without it the host must assume the drop worked after a delay; when the drop is refused (e.g. CADCraft and `.dwg`) the app's default document (`Drawing1`) is mistaken for the file.
Ask: send `Title("<file name>[ •] — <App>")` on open/rename/dirty change, like WordCraft.

## 2. storytold/deckcraft: web 0.8.0 panics on start (`std::process::id`)

**Title:** deckcraft-web 0.8.0 panics at startup: "no pids on this platform"

**Body:**
`deckcraft-web-0.8.0.zip` served as-is (`python3 -m http.server`, no sandbox) panics before the first frame: `panicked at library/std/src/sys/pal/wasm/../unsupported/os.rs: no pids on this platform` (a `std::process::id()` call reached from startup). 0.7.0 starts fine. Repro: unzip the release, serve the folder, open `index.html` in Chromium.

## 3. storytold/figcraft: web build ignores a dropped file

**Title:** Web build: open a file dropped on the canvas

**Body:**
FigCraft 0.7.0 web ignores a dropped `.svg` (and a dropped `.figcraft` was not reached). Every other ArtCraft web app opens a file dropped on its canvas, which is how embedding hosts deliver a document without file dialogs. Ask: accept dropped `.figcraft` (and importable formats) like the other apps.

## 4. storytold/*: a common `window.<app>.request` control API

**Title:** Web builds: expose a small JS control API (`window.<app>.request`)

**Body:**
EffectCraft (`window.effectcraft.{request,execute,commands,addFile,readFile,files}`) and LightCraft (`globalThis.lightcraft.command`) expose a JS API on the web; the others do not. A common minimal surface — open bytes, save/export to bytes, current document name, dirty flag — would let embedding hosts stop simulating drops and parsing console titles.

## 5. storytold/gridcraft: clear "— Edited" after a picker save

**Title:** Web: title keeps "— Edited" after a successful save

**Body:**
GridCraft 0.8.0 web shows `budget.xlsx — Edited` after an edit and keeps it after Ctrl+S completes through `showSaveFilePicker` (the writable closes successfully). WordCraft clears its `•` marker on save. Ask: clear the edited marker after a successful save.
