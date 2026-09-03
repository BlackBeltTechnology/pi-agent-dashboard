#!/usr/bin/env node
/**
 * Emit index.html for ONE theme.
 *
 *   node build.mjs dark     # → index.html using assets/<shot>-dark.png
 *   node build.mjs light    # → index.html using assets/<shot>-light.png
 *
 * Two renders, one source. The dark and light captures are the same viewport
 * at the same scroll offset, so a single set of scene definitions and a single
 * set of timings drive both — only the token block and the asset suffix change.
 *
 * Canvas is 1920x1200 = 16:10, which is EXACTLY the source aspect
 * (1440x900 logical, captured at 2880x1800). The shot is full-bleed: no frame,
 * no letterbox, no pillarbox. An earlier cut used a 1520x1000 canvas (1.52)
 * holding a 1.6 image, which left uneven 34px/66px top/bottom margins.
 */

const THEME = process.argv[2];
if (THEME !== "dark" && THEME !== "light") {
  console.error("usage: node build.mjs <dark|light>");
  process.exit(1);
}

// Both ramps are mirrored verbatim from packages/client/src/index.css.
// `--sub` in light is #444444, NOT the product's --text-tertiary #777777:
// on white that token is 4.48:1 and misses the 4.5:1 floor (ui-contract.md
// marks it dark-only).
const TOKENS = {
  dark: {
    fg: "#e5e5e5", sub: "#808080", accent: "#60a5fa", scanline: "#93c5fd",
    scrim0: "rgba(10,10,10,0)", scrim1: "rgba(10,10,10,.97)",
    rail: "#1e1e1e", page: "#0a0a0a",
  },
  light: {
    fg: "#1a1a1a", sub: "#444444", accent: "#1d4ed8", scanline: "#1d4ed8",
    scrim0: "rgba(255,255,255,0)", scrim1: "rgba(255,255,255,.97)",
    rail: "#dcdcdc", page: "#ffffff",
  },
}[THEME];

const SCENES = [
  { id: "sessions",    n: "01", t: "Every session, in one place", s: "grouped by folder" },
  { id: "chat",        n: "02", t: "Follow the whole transcript", s: "tools, tokens, cost" },
  { id: "diff-commit", n: "03", t: "Review the diff, then commit", s: "per file, from the browser" },
  { id: "openspec",    n: "04", t: "Plan the work on a board",    s: "grouped, ordered, tallied" },
  { id: "editor",      n: "05", t: "Open the file right there",   s: "editor, tree and terminal" },
];

const STEP = 4.2;   // scene-to-scene cadence
const HOLD = 5.0;   // how long a scene lives (so they overlap by 0.8s)
const BAND = 340;   // px width of the travelling opposite-theme strip
const TOTAL = (SCENES.length - 1) * STEP + HOLD;   // 21.8

const OTHER = THEME === "dark" ? "light" : "dark";

const scenesHtml = SCENES.map((sc, i) => `
      <div id="s${i}" class="scene clip" data-start="${(i * STEP).toFixed(1)}" data-duration="${HOLD.toFixed(1)}"
           data-track-index="${i + 1}" data-layout-allow-overlap data-layout-allow-overflow>
        <div class="stage">
          <img class="base" src="assets/${sc.id}-${THEME}.png" alt="${sc.t}" data-layout-allow-overflow />
          <div class="band" data-layout-allow-overflow>
            <div class="bandinner" data-layout-allow-overflow>
              <img src="assets/${sc.id}-${OTHER}.png" alt="" data-layout-allow-overflow />
            </div>
            <div class="edge trail"></div>
            <div class="edge lead"></div>
          </div>
        </div>
        <div class="scrim"></div>
        <div class="cap">
          <div class="row">
            <span class="n" data-layout-allow-overlap>${sc.n}</span>
            <span class="t" data-layout-allow-overlap>${sc.t}</span>
            <span class="n ghost" aria-hidden="true" data-layout-allow-overlap>${sc.n}</span>
          </div>
          <div class="ul"></div>
          <div class="s" data-layout-allow-overlap>${sc.s}</div>
        </div>
      </div>`).join("\n");

const html = `<!doctype html>
<html lang="en" data-resolution="custom" data-theme="${THEME}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1200" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"><\/script>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:1920px;height:1200px;overflow:hidden;background:${TOKENS.page}}
      :root{
        --fg:${TOKENS.fg}; --sub:${TOKENS.sub}; --accent:${TOKENS.accent};
        --mono:"JetBrains Mono","SF Mono",Menlo,Monaco,monospace;
        --sans:"Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      }
      body{font-family:var(--sans)}

      /* .clip is the marker HyperFrames uses to recognise a timed element.
         It carries NO geometry here on purpose, so .scene and #rail keep
         owning their own boxes. Styling it inset:0 full-canvas (as the hero
         cut did) would fight #rail, which is a hairline, not a scene.
         NOTE: no backticks in this file's CSS/JS comments — the whole
         document is emitted from a JS template literal. */
      .clip{}

      /* A scene is the full canvas. Scenes SLIDE past one another, so each one
         spends part of its life off-canvas by design. */
      .scene{position:absolute;top:0;left:0;width:1920px;height:1200px;overflow:hidden}

      /* Full-bleed shot. The push-in scales the WHOLE stage, not the base
         image, so the theme band below rides the same transform and stays
         registered with the pixels underneath it. */
      .stage{position:absolute;top:0;left:0;width:1920px;height:1200px;transform-origin:50% 45%}
      .stage img{display:block;width:1920px;height:1200px}
      .stage .base{position:absolute;top:0;left:0}

      /* THEME BAND — the travelling blue line is a dark/light separator, the
         same device as the wipe cut. Here it carries a narrow window of the
         OPPOSITE theme across the frame, so a dark film flashes its light
         counterpart (and vice versa) in a moving strip. The two captures are
         the same viewport at the same scroll offset, so the strip registers
         pixel-for-pixel and reads as the UI repainting under the line.
         .bandinner counter-translates by exactly the band offset, which is
         what keeps the ghost anchored instead of sliding. */
      .band{position:absolute;top:0;left:0;width:${BAND}px;height:1200px;overflow:hidden;opacity:0}
      .bandinner{position:absolute;top:0;left:0;width:1920px;height:1200px}
      .edge{position:absolute;top:0;width:2px;height:1200px;background:${TOKENS.scanline}}
      .edge.lead{right:0;box-shadow:0 0 34px 6px ${TOKENS.scanline}66}
      .edge.trail{left:0;opacity:.45}

      /* Readability floor for the caption, which sits over LIVE UI — a dense
         transcript or a board full of cards, not a flat backdrop. The ramp
         reaches full opacity well above the caption so the text never has
         session-card edges running through it. */
      /* Grown from 460px to 540px, and full opacity pulled up to 46%, because
         the caption below is now bigger and centred: its block top sits ~250px
         off the floor, which the old ramp had not yet reached full strength at.
         The scrim has to be opaque BEHIND the whole block, not just under it. */
      .scrim{position:absolute;left:0;right:0;bottom:0;height:540px;
        background:linear-gradient(to bottom, ${TOKENS.scrim0} 0%, ${TOKENS.scrim1} 46%, ${TOKENS.scrim1} 100%)}


      /* Centred lower-third. left:0/right:0 rather than a fixed width, so the
         block self-centres at any title length and nothing has to be measured.
         The underline now grows from its MIDDLE (transform-origin 50%) to match
         the centred axis; drawing it from the left edge would have made a
         centred block visibly grow off-axis. */
      .cap{position:absolute;left:0;right:0;bottom:112px;text-align:center}
      .cap .row{display:flex;align-items:baseline;justify-content:center;gap:28px}
      .cap .n{font-family:var(--mono);font-size:22px;letter-spacing:.18em;color:var(--accent)}
      /* Hidden twin of the number on the trailing side. Without it the flex row
         centres (number + gap + title) as one block, which pushes the TITLE ~44px
         right of centre while the underline centres on the container -- the two
         end up on different axes. Balancing the row costs one hidden span and
         needs no width measurement, so it holds for any title length. */
      .cap .n.ghost{visibility:hidden}
      .cap .t{font-size:74px;font-weight:400;letter-spacing:-.022em;color:var(--fg);white-space:nowrap}
      .cap .ul{height:2px;width:520px;background:var(--accent);margin:24px auto 0;transform-origin:50% 50%}
      .cap .s{font-family:var(--mono);font-size:24px;letter-spacing:.05em;color:var(--sub);margin:18px 0 0}

      #rail{position:absolute;left:96px;right:96px;bottom:48px;height:2px;
        background:${TOKENS.rail};border-radius:1px}
      #railfill{height:100%;width:0;background:var(--accent);border-radius:1px}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL.toFixed(1)}"
         data-width="1920" data-height="1200">
${scenesHtml}

      <div id="rail" class="clip" data-start="0" data-duration="${TOTAL.toFixed(1)}" data-track-index="0">
        <div id="railfill"></div>
      </div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      const W = 1920, STEP = ${STEP}, HOLD = ${HOLD}, TOTAL = ${TOTAL.toFixed(1)};
      const SLIDE = 0.95;   // scene-to-scene push
      const BAND = ${BAND}, BAND_DUR = 2.8;   // theme-band width and sweep time
      const N = ${SCENES.length};

      /* Scenes are stacked; only their x offset decides what is on screen.
         A push (old exits left while new enters right) keeps a single
         direction of travel and reads as one continuous strip of UI, which
         suits an instrument panel better than a dissolve. */
      for (let i = 0; i < N; i++) {
        const sc = "#s" + i, at = i * STEP;

        gsap.set(sc, { x: i === 0 ? 0 : W });
        gsap.set(sc + " .cap .ul", { scaleX: 0 });

        if (i === 0) {
          tl.fromTo(sc, { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power2.out" }, 0);
        } else {
          tl.to(sc,             { x: 0,  duration: SLIDE, ease: "power3.inOut" }, at);
          tl.to("#s" + (i - 1), { x: -W, duration: SLIDE, ease: "power3.inOut" }, at);
        }

        /* Push-in runs the WHOLE scene at constant speed, so the frame is
           never still but never visibly moving either.
           Target is .stage, NOT .stage img: the theme band is a child of the
           stage, so scaling the stage carries the band with it and the strip
           stays registered with the pixels underneath. Scaling the image alone
           would slide the base out from under the band.
           Range is deliberately wide (1.22 -> 1.06 vs the old 1.07 -> 1.00) and
           carries a lateral drift. The floor stays at 1.06 rather than 1.00
           because the drift needs overhang to travel into: at 1.06 the stage
           laps the canvas by 57.6px per side, so a 34px drift never exposes an
           edge. Ending at 1.00 would pin the drift to zero. */
        const dir = i % 2 === 0 ? 1 : -1;
        tl.fromTo(sc + " .stage",
                  { scale: 1.22, x: dir * 34, y: -dir * 12 },
                  { scale: 1.06, x: -dir * 34, y: dir * 12,
                    duration: HOLD + SLIDE, ease: "none" }, at);

        /* Caption builds after the slide lands, not during it.
           The build now SLIDES laterally instead of rising: scenes push
           horizontally, so a horizontal caption entry shares that axis and
           reads as one motion language rather than two competing ones.
           Title and sub-label travel different distances (120 vs 80) so they
           arrive as two beats, not one block. */
        const capAt = at + (i === 0 ? 0.5 : SLIDE * 0.75);
        tl.fromTo(sc + " .cap .row", { opacity: 0, x: 120 },
                  { opacity: 1, x: 0, duration: 0.95, ease: "power3.out" }, capAt);
        tl.to(sc + " .cap .ul", { scaleX: 1, duration: 0.80, ease: "power2.inOut" }, capAt + 0.26);
        tl.fromTo(sc + " .cap .s", { opacity: 0, x: 80 },
                  { opacity: 1, x: 0, duration: 0.80, ease: "power3.out" }, capAt + 0.38);

        /* THEME BAND — one pass per scene, alternating direction with the
           drift so the line and the frame never fight each other.
           .bandinner counter-translates by exactly the band offset (same
           duration, same ease, mirrored values) which pins the opposite-theme
           capture at stage x=0 while its window travels. That is what makes
           the strip read as the UI repainting under the line rather than a
           picture sliding past a hole. */
        const bFrom = dir === 1 ? -BAND : W;
        const bTo   = dir === 1 ? W : -BAND;
        const bandAt = capAt + 0.5;

        // Leading edge carries the glow, so it has to sit on the side the
        // band is travelling toward.
        if (dir === -1) {
          gsap.set(sc + " .edge.lead",  { left: 0, right: "auto" });
          gsap.set(sc + " .edge.trail", { left: "auto", right: 0 });
        }

        tl.set(sc + " .band",      { x: bFrom, opacity: 0 }, at);
        tl.set(sc + " .bandinner", { x: -bFrom }, at);
        tl.to(sc + " .band", { opacity: 1, duration: 0.28, ease: "power2.out" }, bandAt);
        tl.to(sc + " .band",      { x: bTo,  duration: BAND_DUR, ease: "power1.inOut" }, bandAt);
        tl.to(sc + " .bandinner", { x: -bTo, duration: BAND_DUR, ease: "power1.inOut" }, bandAt);
        tl.to(sc + " .band", { opacity: 0, duration: 0.32, ease: "power2.in" },
              bandAt + BAND_DUR - 0.32);
      }

      tl.fromTo("#railfill", { width: "0%" }, { width: "100%", duration: TOTAL, ease: "none" }, 0);

      window.__timelines["main"] = tl;
    <\/script>
  </body>
</html>
`;

const { writeFileSync } = await import("node:fs");
writeFileSync(new URL("./index.html", import.meta.url), html);
console.log(`index.html → theme=${THEME}, ${SCENES.length} scenes, ${TOTAL.toFixed(1)}s`);
