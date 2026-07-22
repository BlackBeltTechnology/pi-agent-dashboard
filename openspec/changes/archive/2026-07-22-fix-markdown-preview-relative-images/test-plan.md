# Test Plan — fix-markdown-preview-relative-images

Stage: apply   Generated: 2026-07-22

All Triples filled from the (doubt-reviewed) spec — no clarification gaps. Nearly
everything is deterministic component/helper logic testable in the existing L1
vitest + React-Testing-Library tier (`packages/client/src/components/__tests__/MarkdownContent.test.tsx`
already exercises `img` lightbox clicks + `data:`/external srcs in jsdom, and
`onError` is `fireEvent.error`-able there). One true end-to-end "pixels visibly
render against a real server" check has no cheap automatable observable → manual-only.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | REQ-1 relative resolves | EP+BVA | L1 | automated | src `hero-landing.png`, `imageBase={cwd:"/w",dir:"/w/docs"}` | helper `resolveLocalImageSrc` | returns `/api/file/raw?cwd=%2Fw&path=%2Fw%2Fdocs%2Fhero-landing.png` (both params encoded) |
| E2 | REQ-1 `../` resolves against dir | state (path collapse) | L1 | automated | src `../assets/x.png`, `dir:"/w/docs/design"` | helper | resolved path = `/w/docs/assets/x.png` |
| E3 | REQ-1 POSIX-absolute verbatim | EP | L1 | automated | src `/w/media/x.svg`, `dir:"/w/docs"` | helper | resolved path = `/w/media/x.svg` (NOT re-joined with dir) |
| E4 | REQ-1 unicode/space encoding | BVA | L1 | automated | src `kép áttekintés.png`, `dir:"/w/docs"` | helper | `path` query param percent-encoded → decodes to `/w/docs/kép áttekintés.png` |
| E5 | REQ-1 scheme guard is a full denylist-by-absence | decision-table | L1 | automated | each src: `http://a/x`, `https://a/x`, `data:img`, `blob:x`, `pi-asset:h`, `file:///x`, `cid:x`, `mailto:x`, `//cdn/x.png`, `#frag` | helper with `imageBase` set | every one returns `null` (no rewrite) |
| E6 | REQ-1 pi-asset branch ordered first | state | L1 | automated | src `pi-asset:<hash>` with `imageBase` set AND hash present in `SessionAssetsContext` | render `PiAssetImg` | resolves to `data:` URL via context (NOT routed to raw endpoint) |
| E7 | REQ-1 absent base → verbatim | EP | L1 | automated | src `hero.png`, no `ImageBaseContext` provider (null) | render | `<img src="hero.png">` verbatim, no rewrite |
| E8 | D5 dirname helper | BVA | L1 | automated | `dirname("readme.md")`, `dirname("a/b/n.md")` | helper | `""` and `"a/b"` respectively |
| E9 | REQ-2 FilePreviewOverlay opts in | decision-table | L1 | automated | `FilePreviewOverlay` for `{cwd:"/w",path:"docs/review.md"}`, md body with `![a](p.png)` | render `.md` branch | rewritten img src = `/api/file/raw?cwd=%2Fw&path=%2Fw%2Fdocs%2Fp.png` |
| E10 | REQ-2 editor MarkdownViewer opts in | decision-table | L1 | automated | `MarkdownViewer` preview mode `{cwd:"/w",path:"a/b/n.md"}`, md `![a](p.png)` | render | img src rewritten with `dir=/w/a/b` |
| E11 | REQ-2 chat does NOT opt in | decision-table | L1 | automated | chat `MarkdownContent` (no imageBase), md `![a](p.png)` | render | img src verbatim `p.png` (pi-asset path unaffected) |
| E12 | REQ-2 MarkdownPreviewView out of scope | decision-table | L1 | automated | README via `MarkdownPreviewView` (no cwd/path prop) | render | no imageBase passed; behavior unchanged (verbatim src) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | REQ-1 failure → placeholder (scoped, swap) | state-transition | L1 | automated | rewritten `<img>` whose `src` 404/403s, `imageBase` set | `fireEvent.error` on the img | img is unmounted and replaced by non-interactive "couldn't load image" placeholder; no residual `minHeight:6rem` reserve gap |
| F2 | REQ-1 verbatim path keeps old failure behavior | state-transition | L1 | automated | external `<img>` on a chat surface (no imageBase) that errors | `fireEvent.error` | NO placeholder rendered; broken image still click-opens the lightbox (regression guard, pins `MarkdownContent.test.tsx` behavior) |
| F3 | REQ-2 sibling image visibly renders end-to-end | manual | — | manual-only | a real `.md` with a sibling `![a](img.png)` opened in `FilePreviewOverlay` against a running server | human opens preview | the actual image is visibly displayed (pixels), not a placeholder/broken glyph |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Design-Risk containment is server-side (client does not pre-sanitize `..`) | fault-injection | L1 | automated | src `../../../etc/passwd.png`, `dir:"/w/docs"` | helper | still returns a rawUrl for the escaped path (defense is the server `/api/file/raw` 403 containment gate, not client sanitization) — documents defense-in-depth boundary |

---

## Coverage summary

- Requirements covered: 2/2 (REQ-1 embedded-image resolution, REQ-2 opt-in surfaces) + design risks (X1)
- Scenarios by class: edge 12 · perf 0 · frontend 3 · error 1
- Scenarios by level: L1 15 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 15 · manual-only 1

## New infra needed

- none — reuses the existing L1 vitest + RTL component tier (jsdom). No perf/soak
  requirement in this change; no WS-convergence, so no L3 Playwright scenario is
  warranted (the logical fix is fully observable at L1; F3's pixel-render is the
  only truly end-to-end check and is manual-only).
