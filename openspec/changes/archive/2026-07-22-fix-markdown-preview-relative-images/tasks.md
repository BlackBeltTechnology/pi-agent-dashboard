## 1. Implementation — helper + dirname

- [x] 1.1 Add a pure browser-safe `resolveLocalImageSrc(src, imageBase)` near `raw-url.ts`: returns `rawUrl({kind:"file", cwd, path: resolved})` for LOCAL srcs, `null` otherwise. "Local" = src does NOT match `/^[a-z][a-z0-9+.-]*:/i` AND not `//`-prefixed AND not `#`-prefixed. Relative → join `dir`+src (insert boundary `/`, dedupe `//`) then collapse `./`+`../` over `/` (NO `node:path`); POSIX-absolute (`/…`) → verbatim path. Add sibling browser-safe `dirname(path)` = `p.slice(0,p.lastIndexOf("/"))` (`""` for a bare filename).

## 2. Implementation — MarkdownContent wiring

- [x] 2.1 Add `ImageBaseContext` (default `null`, mirrors `SessionAssetsContext`); `MarkdownContent` accepts `imageBase?: {cwd:string;dir:string}` and provides a **`useMemo`'d** value (`[cwd,dir]`). `PiAssetImg` reads via a hook (NOT a per-render `components.img` closure — D5).
- [x] 2.2 In `PiAssetImg`, after the `pi-asset:` branch and before the verbatim fall-through, when the context base is set call `resolveLocalImageSrc`; a non-null result renders `<img src={rewritten}>` (keep `reserveStyle`/`releaseReserved` + lightbox).
- [x] 2.3 Add `onError` ONLY on the rewritten `<img>`: conditionally render (swap in, unmounting the img so no `minHeight` reserve leaks — S2) a non-interactive neutral "couldn't load image" placeholder (dashed `pi-asset:` style — D3). Do NOT add `onError` to the verbatim branch.

## 3. Implementation — opt-in call-sites (already carry cwd+path)

- [x] 3.1 `FilePreviewOverlay.tsx`: at the `.md`/`.mdx` `MarkdownContent` case, pass `imageBase={{cwd, dir: absOf(cwd, dirname(path))}}`.
- [x] 3.2 Editor-pane `MarkdownViewer.tsx`: pass `imageBase` to `MarkdownContent` in preview mode (reuse the existing `absOf` + new `dirname`).
- [x] 3.3 `MarkdownPreview.tsx` (`PreviewCard`/`/view`): pass `imageBase={{cwd: target.cwd, dir: absOf(target.cwd, dirname(target.path))}}`.
- [x] 3.4 Confirm `MarkdownPreviewView`-hosted surfaces (README/spec/skill dialogs, `PackageReadmeDialog`, `WhatsNewDialog`) and chat/thinking are left WITHOUT `imageBase` (out of scope / unchanged).

## 4. Tests — folded from test-plan.md (TDD: author these FIRST, watch them fail, then do §1–3)

All L1 vitest + RTL; harness-exemplar for every row: `see packages/client/src/components/__tests__/MarkdownContent.test.tsx` (existing jsdom img/lightbox/`data:` coverage; `onError` via `fireEvent.error`). Helper-only rows live in a sibling `resolve-local-image-src.test.ts`.

- [x] 4.1 (test-plan #E1) relative resolves. `hero-landing.png` · dir `/w/docs` · → helper returns `/api/file/raw?cwd=%2Fw&path=%2Fw%2Fdocs%2Fhero-landing.png`.
- [x] 4.2 (test-plan #E2) `../` collapse. `../assets/x.png` · dir `/w/docs/design` · → resolved path `/w/docs/assets/x.png`.
- [x] 4.3 (test-plan #E3) POSIX-absolute verbatim. `/w/media/x.svg` · dir `/w/docs` · → resolved path `/w/media/x.svg` (not re-joined).
- [x] 4.4 (test-plan #E4) unicode/space encoding. `kép áttekintés.png` · dir `/w/docs` · → `path` param percent-encoded, decodes to `/w/docs/kép áttekintés.png`.
- [x] 4.5 (test-plan #E5) scheme guard. each of `http(s)://`,`data:`,`blob:`,`pi-asset:h`,`file:///x`,`cid:x`,`mailto:x`,`//cdn/x.png`,`#frag` · imageBase set · → helper returns `null`.
- [x] 4.6 (test-plan #E6) pi-asset ordered first. `pi-asset:<hash>` present in `SessionAssetsContext` + imageBase set · render `PiAssetImg` · → resolves to `data:` URL, not the raw endpoint.
- [x] 4.7 (test-plan #E7) absent base → verbatim. `hero.png` · no provider (null) · render · → `<img src="hero.png">` verbatim.
- [x] 4.8 (test-plan #E8) dirname helper. `dirname("readme.md")`→`""` ; `dirname("a/b/n.md")`→`"a/b"`.
- [x] 4.9 (test-plan #E9) FilePreviewOverlay opts in. `{cwd:/w,path:docs/review.md}` md `![a](p.png)` · render `.md` branch · → img src `/api/file/raw?cwd=%2Fw&path=%2Fw%2Fdocs%2Fp.png`.
- [x] 4.10 (test-plan #E10) editor MarkdownViewer opts in. preview `{cwd:/w,path:a/b/n.md}` md `![a](p.png)` · render · → img src rewritten with `dir=/w/a/b`.
- [x] 4.11 (test-plan #E11) chat does NOT opt in. chat `MarkdownContent` (no imageBase) md `![a](p.png)` · render · → img src verbatim `p.png`.
- [x] 4.12 (test-plan #E12) MarkdownPreviewView out of scope. README via `MarkdownPreviewView` (no cwd/path) · render · → no imageBase; verbatim, unchanged.
- [x] 4.13 (test-plan #F1) failure → placeholder. rewritten `<img>` that errors + imageBase set · `fireEvent.error` · → img unmounted, replaced by non-interactive "couldn't load image" placeholder, no residual 6rem reserve gap.
- [x] 4.14 (test-plan #F2) verbatim keeps old failure. external `<img>` on chat surface (no imageBase) errors · `fireEvent.error` · → NO placeholder; broken image still click-opens the lightbox (regression guard).
- [x] 4.15 (test-plan #X1) client does not pre-sanitize `..`. `../../../etc/passwd.png` · dir `/w/docs` · → helper still returns a rawUrl (server `/api/file/raw` 403 containment is the defense, not client sanitization).

## 5. Verify

- [x] 5.1 Run the touched client tests green (vitest scoped to the new specs + `MarkdownContent.test.tsx`).
- [x] 5.2 (test-plan #F3, manual-only) Manual: open a real `.md` with a sibling `![a](img.png)` in `FilePreviewOverlay` against a running server — the actual image is visibly displayed (not placeholder/broken glyph); open one with an out-of-cwd path — neutral placeholder. (test-plan: manual-only)
- [x] 5.3 Run `openspec validate fix-markdown-preview-relative-images` clean; update directory `AGENTS.md` rows for touched files (`MarkdownContent.tsx`, `FilePreviewOverlay.tsx`, `MarkdownViewer.tsx`, `MarkdownPreview.tsx`, new helper).
