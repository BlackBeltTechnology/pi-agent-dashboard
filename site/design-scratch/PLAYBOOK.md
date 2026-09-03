# Mockup playbook — serve, shoot, audit

The landing-page mockup this directory holds is the design source for the Astro
site in `site/src/`. It is a single static page: no build step, no framework,
tokens lifted verbatim from `packages/client/src/index.css`.

```
index.html   the page. Markup + all CSS + the small vanilla behaviours.
field.js     the 3D slab field behind the page. Shared module.
bg3d.html    physics lab for field.js: sliders, fps, theme flip, pause.
media/       hero video + posters (encoded output of ../video/).
vendor/      three.module.min.js, vendored so the page needs no install.
scripts/     serve.mjs, shoot.mjs (below).
```

## Loop

```bash
node site/design-scratch/mockup/scripts/serve.mjs          # http://localhost:8791
node site/design-scratch/mockup/scripts/shoot.mjs          # PNGs -> /tmp/mockup-shots
node site/design-scratch/mockup/scripts/shoot.mjs --audit  # numbers only, exit 1 on a defect
```

Run both **from the repo root**. Useful flags:
`--themes dark,light` · `--widths 320,390,1440` · `--sections hero,features,download`
· `--page bg3d.html` · `--base http://localhost:8792` · `--out <dir>` · `--settle 2000`.

## Audit before eyes

`--audit` asserts the things a screenshot cannot show, each one a defect this
page actually shipped:

| Assertion | The bug it catches |
|---|---|
| `docOverflow == 0`, `navOverflow <= 1` | Header ran out of room at 900px and 1024px only — never at the widths anyone screenshots. |
| `header.position == sticky` **and** `top == 0 after scrolling to the bottom** | `body > *:not(#field){position:relative}` silently overwrote `position:sticky`. Invisible at rest. |
| every `href="#…"` resolves | Removing the closing CTA left two live links pointing at a deleted `#get`. |
| every `<img>` has `naturalWidth > 0` | A logo path typo renders as nothing, and nothing looks like design intent. |
| zero `pageerror` | A `field.js` runtime throw drops the background to 0 fps while the page still looks fine in a still. |

Exit code is non-zero on any failure, so it works as a gate. It fails closed —
verified by pointing an anchor at `#nowhere` and watching it go red.

## Traps, each paid for once

- **Playwright resolves the wrong copy.** These scripts live under `site/`, and
  `site/node_modules` has its own older playwright whose browsers were never
  downloaded. A bare `import "playwright"` dies with *"Executable doesn't exist
  … run npx playwright install"* — a lie; the browser is installed, for the
  root copy. `shoot.mjs` walks up to `pnpm-workspace.yaml` and binds to the root
  install. Same class of failure, different cause, when run from `/tmp`:
  `ERR_MODULE_NOT_FOUND`.
- **Headless Chromium is always light.** It reports the light colour scheme
  regardless of the host OS, so an un-themed run silently shoots the wrong
  theme. Set `localStorage['mockup-theme']` in an init script — never click the
  toggle, which is `display:none` at ≤720px along with the lab panel.
- **WebGL needs `--enable-unsafe-swiftshader`.** Headless has no GPU; without
  the flag `field.js` renders nothing and the background comes back empty.
- **Let the field settle.** ~1.4s after load, and ~0.9s after any scroll so the
  two-way reveal transition finishes. Shooting immediately catches blocks
  mid-fade at whatever opacity they happened to be at.
- **Software raster is not your GPU.** fps read out of `bg3d.html` here is a
  floor (~30-39 at 39 slabs), not a measurement of the real thing.

## Design rules this page is holding

- No bloom, no glow, no gradient buttons — the accent is one flat solid.
- Scroll may change **rates**, never positions: any scroll-driven displacement
  returns to its rest state on the way back up, and that retrace is the
  ping-pong. See the long note at the top of `field.js`.
- The block reveal is two-way but never a retrace: the hidden offset `--rv` is
  signed by the edge the block exits through, so it keeps travelling the way
  you are scrolling.
- Nothing appears or disappears on a timer — no toasts, no disclosures.
