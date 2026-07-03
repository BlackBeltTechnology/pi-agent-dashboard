# Content editor — redesign mockup

Single self-contained `editor.html`. Serve the folder and open it; no build.

```bash
# from repo root, via the serve_mockup tool, or any static server:
npx serve openspec/changes/improve-content-editor/mockups
```

Interactive: click tree files to open tabs, expand folders (including hidden
`.git` / `.pi`), toggle the **Files** rail, flip **light/dark** (top-right sun),
and switch markdown **Preview / Edit**.

## What each part demonstrates

| Original issue | Shown in mockup |
|---|---|
| #1 hidden dirs render as files, won't open | `.git` / `.pi` render as folders with chevrons; expand to show their files |
| #2 generic icons | per-kind mime icons + color (ts, js, json, md, pdf, png, mp4, mp3, mmd) |
| #3 PDF "not supported" | `spec.pdf` renders as a pdf.js **canvas** page (no reliance on Electron's native plugin) |
| #4 markdown can't edit | `README.md` has a **Preview / Edit** segmented toggle + dirty-state Save |
| #5 tree ↔ tabs not linked | opening a file auto-expands ancestor folders and reveals+highlights the row; tabs and tree stay in sync |
| #6 tree toggle hard to find | labelled **Files** pill at the rail boundary (not a bare icon) |
| #7 editor ignores theme switch | flip light/dark — every viewer (incl. mermaid + canvases) recolors live |

## New viewer kinds (requested)

| Kind | Open via | Renderer |
|---|---|---|
| mermaid | `assets/architecture.mmd` | inline diagram (prod: MarkdownContent ```mermaid fences) |
| image | `assets/logo.png` | `<img>` with pan/zoom |
| video | `assets/demo.mp4` | `<video>` native controls |
| audio | `assets/chime.mp3` | waveform + `<audio>` controls |
| html | `index.html` | sandboxed `<iframe srcdoc>` — **scripts OFF** (safe static preview) |
| live-server | **Live** button (header) | reverse-proxied running dev server; loopback + allowlist + origin-isolated |

### HTML vs live-server — the security contrast (visible in the mockup)

- **HTML file** renders `index.html` with `sandbox="allow-same-origin"` and **no**
  `allow-scripts`. The embedded page tries to turn itself red + rewrite its title; it
  stays white → proves a hostile `.html` cannot touch the dashboard origin.
- **Live server** previews a *running* app (`127.0.0.1:5173`) through a reverse proxy.
  Its scripts DO run (the counter works) because it is a real app — but it is
  **origin-isolated** so it cannot read the dashboard token or call dashboard APIs, and
  the target is **loopback-only + allowlisted** (SSRF guard). Use case: preview a mockup
  / dev server inside the dashboard.
  See spec: `../specs/live-server-preview/spec.md`.

## Notes for implementation

- Icons come from a `kind → icon` map keyed off the existing `fileKind()` classifier.
- `#1` root cause is a server filter: `browse.ts::listDirectories` strips
  `.`-prefixed dirs, so the tree's `/api/file`+`/api/browse` merge mislabels them.
  Cleaner fix = one tree-listing endpoint returning `{name,isDir}` per entry.
- `#7` root cause: `MonacoBuffer`/`MarkdownEditor` call raw `useTheme()` (isolated
  state) instead of `useThemeContext()` (shared provider) — swap the import.
- `#3`/mermaid: the mockup uses static SVG for reliability; production wires real
  pdf.js and mermaid.
