/* =============================================================================
   SESSION FLEET — 3D page background (three.js r160, core only)
   -----------------------------------------------------------------------------
   BRIEF: "photorealistic, but without texture, flat colour, carries the message".

   Read as three separate decisions:

   1. PHOTOREAL comes from LIGHT, not from maps. One soft key light casting real
      PCF-soft shadows, a broad sky/ground fill, and a cool rim. Every slab has
      chamfered edges, so the key catches a bright edge line the way it does on
      a real machined panel. ACES tone mapping + sRGB output means the falloff
      rolls off like film instead of clipping to flat grey.
   2. NO TEXTURE / FLAT COLOUR is the material rule: MeshStandardMaterial with a
      single constant colour, zero maps, zero vertex colours, no gradient ramps.
      Roughness is high (matte clay), metalness zero. The only "gradient" on
      screen is the one physical light produces across a curved chamfer.
   3. THE MESSAGE is the composition: a fleet of session cards floating in depth,
      most of them quiet and neutral, ONE lit in the product accent — the one
      that needs you. That is literally what the dashboard is for: many agents
      running, one glance to find the one that stopped.

   Deliberately NOT used: EffectComposer / DOF / bloom (all addons, ~100KB more,
   and a bloom pass is the fastest route back to the AI-glow look this project's
   anti-slop rule bans). Depth separation is done with fog + scale + a slower far
   layer, which is how a long lens actually behaves and costs nothing.

   Palette is the product's own tokens (packages/client/src/index.css): flat
   neutrals plus exactly one accent blue. No purple, no gradient, no env map.

   BUDGET: this runs behind real content on real laptops, so the geometry is
   deliberately cheap. Each slab is ~3 curve segments per corner and a single
   bevel ring; the silhouette survives because the shapes are small on screen
   and matte, and a chamfer only needs one ring to catch a highlight. Materials
   are SHARED (4 body materials for the whole fleet, not one per slab), and only
   the near + mid layers cast shadows — the far layer is small and low-contrast,
   so its shadows cost a second depth pass for nothing.

   USAGE
     import { initField } from './field.js';
     const field = initField(document.getElementById('field'));
     field?.set('speed', 0.8);      // lab controls only; the page needs none
   ========================================================================== */
import * as THREE from './vendor/three.module.min.js';

export function initField(canvas, opts = {}){
  if (!canvas) return null;
  const root = document.documentElement;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    /* No WebGL: the page is complete without it. Nothing is substituted — a
       static "3D-looking" fallback image would be a different design. */
    console.warn('session fleet: WebGL unavailable, skipping', e);
    return null;
  }

  /* --- renderer: the whole photoreal response curve lives in these 4 lines -- */
  renderer.outputColorSpace  = THREE.SRGBColorSpace;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  /* On a phone the text column IS the viewport, so a side-corridor layout puts
     the whole fleet off-frame (verified: the field vanished at 390px). Narrow
     viewports therefore switch to a different composition: a tighter corridor,
     the camera pulled back, and fewer slabs — the field reads as depth beside
     and beyond the copy without crossing it, and costs less on a phone GPU. */
  const narrow = () => window.innerWidth / window.innerHeight < 1;
  let wasNarrow = narrow();

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 260);
  const CAM_Z  = () => (narrow() ? 78 : 62);
  camera.position.set(0, 0, CAM_Z());

  /* Fog doubles as the depth cue AND as the guarantee that the far half of the
     fleet never competes with body copy: by ~120 units everything has dissolved
     into the page background colour exactly. */
  scene.fog = new THREE.Fog(0x0a0a0a, 46, 122);

  /* ------------------------------------------------------------------ lights */
  /* Key: high and camera-left, the classic 3/4 product-shot position. Shadows
     from it fall down-right across the slabs behind, which is what sells the
     stack as physical objects rather than as sprites. */
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.position.set(-26, 34, 30);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far  = 140;
  key.shadow.camera.left = -46; key.shadow.camera.right  = 46;
  key.shadow.camera.top  =  46; key.shadow.camera.bottom = -46;
  key.shadow.bias   = -0.0012;
  key.shadow.radius = 4;             /* the softness of the contact shadow */
  scene.add(key);

  /* Fill: hemisphere, not ambient. A flat ambient term is exactly what makes
     untextured geometry read as a cheap render — a sky/ground split gives the
     top and bottom faces different values for free. */
  const fill = new THREE.HemisphereLight(0xdfe8ff, 0x0b0d12, 0.5);
  scene.add(fill);

  /* Rim: low, behind-right, cool. Separates the near slabs from the far ones
     without adding any colour the palette does not already contain. */
  const rim = new THREE.DirectionalLight(0x9dc0ff, 1.3);
  rim.position.set(34, -16, -22);
  scene.add(rim);

  /* ---------------------------------------------------------------- geometry */
  /* One rounded, chamfered slab geometry per silhouette, shared by every card
     in the fleet. ExtrudeGeometry with a bevel is core three.js
     (RoundedBoxGeometry is an addon) and gives a better result anyway: the
     corner radius lives in the 2D shape, the edge chamfer comes from the bevel,
     and that chamfer is what catches the key light as a hairline. */
  function slabGeometry(w, h, r, depth){
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);       s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);   s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);       s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);           s.quadraticCurveTo(x, y, x + r, y);
    /* Poly budget: curveSegments 3 + bevelSegments 1 is roughly a QUARTER of
       the triangles of the 10/3 version and is visually indistinguishable at
       background scale — the corners are a few pixels across and the bevel only
       has to produce one lit edge, not a smooth fillet. */
    const g = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12,
      bevelSegments: 1, curveSegments: 3
    });
    g.center();
    return g;
  }
  const GEO_CARD = slabGeometry(7.2, 4.4, 0.55, 0.55);   /* a session card     */
  const GEO_TILE = slabGeometry(3.0, 3.0, 0.42, 0.5);    /* a small chip       */
  const GEO_BAR  = slabGeometry(5.6, 0.62, 0.3, 0.42);   /* a status bar / row */
  const GEO_LED  = slabGeometry(4.0, 0.30, 0.14, 0.2);   /* the lit accent row */

  /* ----------------------------------------------------------------- palette */
  /* Two graded ramps, one per theme. Values are the product's own surfaces,
     nudged in value only (never in hue) so the lit result lands where the CSS
     token does after tone mapping. */
  const PAL = {
    dark:  { body:[0x2b2f35, 0x363b42, 0x23262b, 0x40464e],
             accent:0x2f6fe0, emissive:0x3b82f6, fog:0x0a0a0a,
             key:3.4, fillSky:0xdfe8ff, fillGround:0x0b0d12, fillI:0.5,
             rim:0x9dc0ff, rimI:1.3, exposure:0.95 },
    light: { body:[0xf1f2f4, 0xe6e8ec, 0xfafafa, 0xdcdfe4],
             accent:0x2563eb, emissive:0x2563eb, fog:0xffffff,
             key:2.6, fillSky:0xffffff, fillGround:0xbfc6d2, fillI:1.15,
             rim:0xc8d8ff, rimI:0.8, exposure:1.12 }
  };

  /* -------------------------------------------------------------- the fleet */
  /* Layout intent: the fleet lives in two vertical bands either side of the
     text column and rakes back into depth. CENTER_KEEPOUT pushes slabs out of
     the middle of the frame so a headline can sit on the background WITHOUT a
     scrim — a dark plate behind the copy would flatten the whole effect. */
  const CENTER_KEEPOUT = 19;
  /* Half-height of the band slabs are spawned into and wrap within. Spawn and
     wrap MUST share it: spawn wider than the wrap and the first pass through
     the frame is denser than every pass after it. */
  const Y_SPAN = 24;

  const group = new THREE.Group();
  scene.add(group);

  /* Defaults are the settings dialled in during review, not the first guess:
     a slightly thinner fleet, double drift, a tighter corridor and almost no
     fog, so the far layer stays legible as geometry instead of dissolving. */
  const state = { count: 38, speed: 2, spread: 0.8, fog: 0.2, twirl: 1, paused: false };
  const slabs = [];
  let hero = null;                      /* the ONE accent slab: "needs you" */

  const rnd = (a, b) => a + Math.random() * (b - a);
  const theme = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  /* FOUR body materials for the whole fleet instead of one per slab. Same look
     (the ramp only ever had four values), a quarter of the material state, and
     a theme change becomes 4 colour writes rather than N. */
  const bodyMats = PAL.dark.body.map(() => new THREE.MeshStandardMaterial({
    roughness: 0.68,        /* matte clay — no sheen, no clearcoat          */
    metalness: 0.0          /* metal without an env map reads as dead black */
  }));

  function makeSlab(i, n){
    const kind = i % 7 === 0 ? 'tile' : (i % 5 === 0 ? 'bar' : 'card');
    const geo  = kind === 'tile' ? GEO_TILE : kind === 'bar' ? GEO_BAR : GEO_CARD;
    const m = new THREE.Mesh(geo, bodyMats[i % bodyMats.length]);

    /* Depth layer decides scale, speed and how far off-axis it may sit. Three
       discrete layers (near / mid / far) is what a real long-lens shot of a
       scattered pile looks like; a uniform random cloud looks like a
       screensaver. */
    const layer = i % 3;                       /* 0 near, 1 mid, 2 far */

    /* PLACEMENT IS STRATIFIED, NOT RANDOM.
       Uniform random over a band clumps: at ~38 samples you reliably get a
       huddle in one corner and a hole in another, and a hole in a background
       reads as a mistake rather than as space. So the frame is divided into as
       many vertical cells as there are slabs per side, each slab takes one
       cell, and the randomness is only a JITTER inside its cell (±45%, never
       enough to swap cells). Coverage is guaranteed; the field still looks
       scattered because no two cells are filled at the same offset.
       The lateral position uses the golden-ratio sequence for the same reason:
       it is the most evenly-spaced sequence that never repeats a pattern. */
    const side    = i % 2 ? 1 : -1;            /* alternate sides in turn      */
    /* n, not state.count: the narrow build caps the fleet, and sizing the
       cells to the uncapped number would pack every slab into the bottom half
       of the band. */
    const perSide = Math.max(1, Math.ceil(n / 2));
    const slot    = Math.floor(i / 2) % perSide;
    const cell    = (2 * Y_SPAN) / perSide;
    const golden  = (i * 0.6180339887) % 1;    /* low-discrepancy, not random  */
    const zBand   = layer === 0 ? [2, 12] : layer === 1 ? [-14, 0] : [-46, -20];
    /* Depth is strafied by the SAME sequence offset a third turn, so slabs that
       land near each other in x do not also land near each other in z. */
    const zf      = (golden + 0.333) % 1;
    const z       = zBand[0] + zf * (zBand[1] - zBand[0]);
    /* The far layer used to be allowed closer to the middle because fog took it
       down to nothing — but fog is now a dial that can be turned almost off, so
       the corridor can no longer depend on it. Every layer keeps clear of the
       text; the far one only by a slightly smaller margin. */
    const keep  = (layer === 2 ? CENTER_KEEPOUT * 0.92 : CENTER_KEEPOUT) * (narrow() ? 0.62 : 1);
    /* Split into a fixed inner edge and a scalable outer span. The SPREAD dial
       only stretches the span — it must never be able to pull the band into the
       text corridor, which is what happens if it scales the whole x. */
    const baseKeep = side * keep;
    const baseSpan = side * (1 + golden * 25);
    const x     = baseKeep + baseSpan * state.spread;
    const y     = -Y_SPAN + (slot + 0.5) * cell + rnd(-0.45, 0.45) * cell;

    /* Only near + mid cast. Far slabs still RECEIVE, so the stack still reads
       as physical, but they stop paying for a shadow nobody can resolve. */
    m.castShadow    = layer !== 2;
    m.receiveShadow = true;

    m.position.set(x, y, z);
    /* Near-facing, but never perfectly parallel: a few degrees of yaw/pitch is
       what gives every slab its own specular edge instead of a flat wall. */
    m.rotation.set(rnd(-0.30, 0.30), rnd(-0.55, 0.55), rnd(-0.16, 0.16));
    m.scale.setScalar(layer === 0 ? rnd(0.8, 1.05) : layer === 1 ? rnd(0.62, 0.92) : rnd(0.45, 0.72));

    group.add(m);
    return {
      mesh: m, layer,
      /* Drift rate is set by the LAYER, with only ±6% of per-slab variation.
         Wide per-slab variation (the old rnd(0.5, 1.25)) quietly destroys the
         stratified spawn: faster slabs lap slower ones and within a couple of
         minutes the even spacing has collapsed back into clumps and gaps. Rate
         by depth also happens to be what a real camera does — things further
         away cross the frame slower. The fleet does not read as synchronised
         because the slabs differ in every OTHER way: phase, spin, size, side. */
      driftY: rnd(0.94, 1.06) * (layer === 0 ? 1.1 : layer === 1 ? 0.68 : 0.37),
      baseZ: z, py: y,
      /* TWIRL: each slab rides its own small horizontal circle while it drifts
         up, so its path through the frame is a helix rather than a straight
         line. The circle is PER-SLAB (radius, rate and phase all random,
         direction either way) — a shared centre of rotation would read as one
         rigid carousel, and an orbit around the scene axis would swing slabs
         straight through the text corridor the layout works to keep clear. */
      baseKeep, baseSpan,
      swirlR: rnd(0.8, 2.6) * (layer === 0 ? 1 : layer === 1 ? 0.8 : 0.55),
      swirlRate: rnd(0.12, 0.4) * (Math.random() < 0.5 ? -1 : 1),
      swirlPh: rnd(0, 6.28),
      /* Rest orientation: the spin is added to this, so every slab starts from
         its own angle instead of the fleet sharing one. */
      baseRot: m.rotation.clone(),
      /* SPIN about the slab's own centre, integrated as an ANGLE, never
         evaluated from a clock. That distinction is the whole fix for the
         ping-pong: an angle that is only ever added to can slow down and speed
         up without ever retracing itself, whereas sin(t * rate) jumps the
         instant `rate` changes and swings back the moment it drops. Yaw leads
         (the card turning to face you); pitch and roll are a third of it, so a
         slab flashes its edge at the key light without becoming a shard. */
      spinRate: [rnd(0.04, 0.13) * (Math.random() < 0.5 ? -1 : 1),
                 rnd(0.14, 0.38) * (Math.random() < 0.5 ? -1 : 1),
                 rnd(0.03, 0.10) * (Math.random() < 0.5 ? -1 : 1)],
      /* Per-slab response to the scroll kick, 0.45-1.5x. A fleet that answers
         in unison is one object; a fleet that answers unevenly is a fleet. */
      spinResp: rnd(0.45, 1.5),
      spin: 0
    };
  }

  /* The hero slab is a real card in the fleet, promoted: same geometry, accent
     colour, a soft emissive "row" child, and it sits NEAR and off-centre so it
     is the first thing the eye lands on. */
  function makeHero(pal){
    const m = new THREE.Mesh(GEO_CARD, new THREE.MeshStandardMaterial({
      color: pal.accent, roughness: 0.5, metalness: 0.0,
      emissive: pal.emissive, emissiveIntensity: 0.10
    }));
    m.castShadow = m.receiveShadow = true;
    /* Placed to sit fully INSIDE the right edge at 16:10 and wider — a hero
       element cropped by the viewport reads as an accident, not a subject. */
    /* Narrow: the corridor is too tight to hold a full card beside the copy, so
       the accent card moves ABOVE the headline and squares up to the camera —
       cropped to a blue sliver at the frame edge it stops reading as a card at
       all, which is the one thing this element has to do. */
    m.position.set(narrow() ? 0 : 15.5, narrow() ? 16 : 4.0, 3);
    m.rotation.set(-0.10, narrow() ? -0.16 : -0.40, 0.05);
    m.scale.setScalar(1.0);

    /* The lit row: flat emissive geometry, NOT a bloom pass and NOT a sprite
       glow. Base colour is the accent rather than white, because a white base
       under an emissive term clips to a blown-out bar after ACES and looks like
       a bloom artefact instead of a lit status row. */
    const led = new THREE.Mesh(GEO_LED, new THREE.MeshStandardMaterial({
      color: pal.emissive, roughness: 0.45, metalness: 0,
      emissive: pal.emissive, emissiveIntensity: 1.1
    }));
    led.scale.set(0.72, 1, 1);
    led.position.set(-0.5, -1.2, 0.34);
    m.add(led);

    group.add(m);
    /* The accent card is placed, not distributed: its whole job is to sit in a
       specific spot beside the headline, so it is exempt from the SPREAD dial
       (baseSpan 0) — compressing it inward is what put it on top of the type. */
    return { mesh: m, led, layer: 0, driftY: 0.34,
             py: narrow() ? 16 : 4.0,
             /* Heaviest thing in the scene: it answers the scroll kick least,
                so the one card the eye is meant to read stays readable. */
             spinResp: 0.28, spin: 0, swirlPh: 1.1,
             /* The accent card SWAYS instead of spinning: the fleet's angles
                accumulate forever, which is right for anonymous slabs but turns
                the one card the eye is meant to read into a diamond after a
                minute (observed at t+75s). Its rate still answers the scroll,
                and the phase is integrated like everything else, so it never
                jumps — it just never leaves the neighbourhood of square. */
             swayA: [0.05, 0.14, 0.04],
             spinRate: [0.10, 0.16, 0.07],
             baseRot: m.rotation.clone(),
             baseKeep: narrow() ? 0 : 15.5, baseSpan: 0, baseZ: 3,
             /* It also twirls least, so it stays near-square to camera. */
             swirlR: 0.8, swirlRate: 0.14 };
  }

  function build(){
    /* Body materials are shared and reused across rebuilds, so only the hero's
       own two materials are disposed here. */
    for (const s of slabs) { group.remove(s.mesh); if (s === hero) { s.mesh.material.dispose(); s.led.material.dispose(); } }
    slabs.length = 0;
    const pal = PAL[theme()];
    const n = narrow() ? Math.min(state.count, 22) : state.count;
    for (let i = 0; i < n; i++) slabs.push(makeSlab(i, n));
    hero = makeHero(pal);
    slabs.push(hero);
    applySpread();
  }

  /* Spread widens the two bands outward from a fixed inner edge, so the field
     can be judged against wide and narrow content columns without a rebuild
     and without ever closing the text corridor. */
  function applySpread(){
    for (const s of slabs) s.mesh.position.x = s.baseKeep + s.baseSpan * state.spread;
  }

  function applyTheme(){
    const pal = PAL[theme()];
    scene.fog.color.setHex(pal.fog);
    key.intensity = pal.key;
    fill.color.setHex(pal.fillSky); fill.groundColor.setHex(pal.fillGround);
    fill.intensity = pal.fillI;
    rim.color.setHex(pal.rim); rim.intensity = pal.rimI;
    renderer.toneMappingExposure = pal.exposure;
    bodyMats.forEach((m, i) => m.color.setHex(pal.body[i]));
    if (hero) {
      hero.mesh.material.color.setHex(pal.accent);
      hero.mesh.material.emissive.setHex(pal.emissive);
      hero.led.material.color.setHex(pal.emissive);
      hero.led.material.emissive.setHex(pal.emissive);
    }
  }

  function applyFog(){
    /* One dial drives both planes so "blur" stays a single perceptual control:
       0 = crisp all the way back, 2 = only the near layer survives. */
    const f = Math.max(0.001, state.fog);
    scene.fog.near = 46 / f;
    scene.fog.far  = 122 / f;
  }

  /* ------------------------------------------------------------------ resize */
  function resize(){
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    /* Keep the vertical framing constant and let width reveal more of the
       fleet, so a narrow window crops the field rather than squashing it. */
    camera.fov = narrow() ? 40 : 30;
    camera.updateProjectionMatrix();
    /* Crossing the aspect breakpoint changes the LAYOUT, not just the framing,
       so the fleet is rebuilt — but only on the crossing, never on every resize
       tick (a rebuild per pixel of drag would stutter). */
    if (narrow() !== wasNarrow) { wasNarrow = narrow(); build(); applyTheme(); }
  }
  window.addEventListener('resize', resize);

  /* -------------------------------------------------------- pointer parallax */
  /* Both are eased toward a target rather than applied directly — an
     instantaneous 1:1 response to the pointer is the tell of a demo, a lagged
     one reads as a camera with mass. */
  const cam = { tx: 0, ty: 0, x: 0, y: 0 };
  window.addEventListener('pointermove', e => {
    cam.tx = (e.clientX / window.innerWidth  - 0.5) * 5.5;
    cam.ty = (e.clientY / window.innerHeight - 0.5) * -3.5;
  }, { passive: true });

  /* ============================ SCROLL PHYSICS ==============================
     Three separate couplings, because "react to scroll" is three different
     things and mixing them into one number makes all of them feel wrong:

     THE PING-PONG RULE — scroll may only change RATES, never positions.

     Two earlier versions of this both ping-ponged, for the same underlying
     reason: the wheel was driving a DISPLACEMENT. Whether that displacement is
     a position offset (v1: slabs pushed down with the page) or a heading that
     swings out and eases home (v2), the shape is identical — the field leaves a
     rest state and then retraces its way back to it, and a path walked forwards
     and then backwards is a ping-pong no matter how well it is damped.

     So nothing here returns to a rest position. Scroll feeds ONE quantity:

     (a) SPIN ENERGY — an unsigned pool that scrolling adds to and time drains.
         It multiplies how fast each slab turns about its OWN centre. Direction
         of travel, speed of travel and camera never respond to the wheel at
         all, so there is nothing left that can reverse. Every rotation is an
         accumulated angle, integrated per frame (`spin += rate * mul * dt`),
         never sampled from the clock as sin(t * rate) — a clock-sampled angle
         JUMPS the moment its rate changes and unwinds when the rate drops,
         which is the ping-pong in miniature, once per slab.

         Note it is unsigned: scrolling up and scrolling down both add energy.
         Making the sign steer the spin direction would put the reversal right
         back in, just one level down.

     (b) MOOD — whichever content block owns the middle of the viewport selects
         a spin/fog preset (below). Mood values differ per block and are eased,
         and since they too only scale rates, crossing a boundary changes the
         pace of the field without moving anything back to where it was.
     ======================================================================== */

  /* Presets are RATIOS of the user's baseline (the lab sliders), not absolute
     numbers — so tuning the baseline retunes every block coherently instead of
     desyncing them. Only two knobs, and both are rates:
       spinX = how fast slabs turn about their own centres
       fogX  = multiplies the blur dial, i.e. how far back the field survives
     Camera dolly and roll used to be here and were removed: a camera that
     pushes in on one block and pulls back on the next reverses exactly like the
     old position push did. The camera is now fixed. */
  const MOODS = {
    /* Hero: the reference state. Everything else is described against it. */
    hero:     { spinX: 1.00, fogX: 1.00 },
    /* A block that explains WHY the product exists is a reading block: the
       field almost stops turning so the type owns the frame. */
    control:  { spinX: 0.25, fogX: 1.90 },
    /* The feature grid is dense and opaque; only the margins of the field show,
       so it can afford to churn — this is where the rotation reads strongest. */
    features: { spinX: 2.10, fogX: 0.85 },
    /* Closing CTA: a lift, so the page ends on more energy than it opened on. */
    close:    { spinX: 1.45, fogX: 0.70 }
  };
  /* Live, eased mood values. `to` is the target set by the observer. */
  const mood = { name: 'hero', spinX: 1, fogX: 1, to: MOODS.hero };

  /* Which block owns the viewport middle? The rootMargin collapses the root box
     to a thin band across the centre of the screen, so exactly one section is
     "active" at a time and the handoff happens when a block crosses the middle
     — which is when a reader actually commits to it. */
  function watchSections(){
    const els = document.querySelectorAll(opts.sections || '[data-field]');
    if (!els.length) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const name = e.target.getAttribute('data-field');
        if (MOODS[name]) { mood.name = name; mood.to = MOODS[name]; }
      }
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    els.forEach(el => io.observe(el));
  }

  /* Scroll listener does no work beyond accumulating deltas — all physics runs
     in the frame loop, so a fast wheel cannot flood the main thread. */
  let lastY = window.scrollY, energy = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const d = Math.abs(y - lastY);                /* UNSIGNED — see (a) above */
    lastY = y;
    /* A ~90px movement saturates one event's contribution. Clamped, because a
       trackpad fling delivers several thousand px in a single event and would
       otherwise spin the whole fleet into a blur. */
    energy = Math.min(2.4, energy + Math.min(1, d / 90) * 0.85);
  }, { passive: true });

  /* --------------------------------------------------------------- run / idle */
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0, last = performance.now(), t = 0;
  let frames = 0, fpsT = 0, fps = 0;
  const WRAP_Y = Y_SPAN + 3;      /* a slab is fully out of frame by here */

  /* Live spin multiplier. It EASES toward the value the energy pool implies
     rather than tracking it directly, so even an instantaneous kick arrives as
     a spin-up rather than a step — ~0.55s to speed up. */
  const spinMul = { now: 1 };

  function step(dt){
    t += dt;

    /* --- ease the mood, drain the energy pool ------------------------------ */
    const k = Math.min(1, dt * 1.5);              /* ~0.7s to settle a change */
    mood.spinX += (mood.to.spinX - mood.spinX) * k;
    mood.fogX  += (mood.to.fogX  - mood.fogX)  * k;
    /* Drain is much slower than the fill (~1.5s half-life vs an instant kick):
       the field should keep turning well after the wheel stops, the way a
       flywheel does. A fast drain would read as the animation being switched
       off, which is its own kind of jerk. */
    energy *= Math.exp(-dt * 0.45);

    /* Travel is CONSTANT — no scroll term anywhere in it. */
    const speed = state.speed;
    const twirl = state.twirl;
    /* Rotation is the only thing the wheel reaches. */
    const spinTarget = mood.spinX * (1 + energy * 1.35);
    spinMul.now += (spinTarget - spinMul.now) * Math.min(1, dt * 1.8);

    /* Fog follows the mood too, so a reading block genuinely sinks the far
       layer instead of only slowing it. */
    const f = Math.max(0.001, state.fog * mood.fogX);
    scene.fog.near = 46 / f;
    scene.fog.far  = 122 / f;

    for (const s of slabs) {
      const m = s.mesh;

      /* Travel: one direction, one rate, forever. */
      s.py += s.driftY * speed * dt;
      if (s.py > WRAP_Y) s.py = -WRAP_Y;

      /* TWIRL: the slab's own small horizontal circle, its phase INTEGRATED for
         the same reason the spin is — sampling it as t * rate would make the
         helix jump sideways whenever the rate changed. */
      s.swirlPh += s.swirlRate * speed * dt;
      const r = s.swirlR * twirl;
      m.position.set(s.baseKeep + s.baseSpan * state.spread + Math.cos(s.swirlPh) * r,
                     s.py,
                     s.baseZ + Math.sin(s.swirlPh) * r);

      /* SPIN about its own centre — the one thing the scroll drives. One shared
         angle scaled per axis keeps the card turning as a body rather than
         wobbling on three independent clocks. */
      const mul = 1 + (spinMul.now - 1) * s.spinResp;
      s.spin += mul * twirl * dt;
      if (s.swayA) {
        m.rotation.set(s.baseRot.x + Math.sin(s.spin * s.spinRate[0]) * s.swayA[0],
                       s.baseRot.y + Math.sin(s.spin * s.spinRate[1]) * s.swayA[1],
                       s.baseRot.z + Math.sin(s.spin * s.spinRate[2]) * s.swayA[2]);
      } else {
        m.rotation.set(s.baseRot.x + s.spin * s.spinRate[0],
                       s.baseRot.y + s.spin * s.spinRate[1],
                       s.baseRot.z + s.spin * s.spinRate[2]);
      }
    }

    if (hero) {
      /* "Needs you": a slow breath on the emissive row only. 1.4s in the
         product UI; slowed to ~3s here because at background scale a 1.4s pulse
         is a distraction rather than a signal. */
      const b = 0.5 + 0.5 * Math.sin(t * 2.1);
      hero.led.material.emissiveIntensity  = 0.55 + 1.15 * b;
      hero.mesh.material.emissiveIntensity = 0.04 + 0.10 * b;
    }

    /* Camera: pointer-parallax only. It is deliberately deaf to the scrollbar
       — any camera move tied to scroll position must undo itself on the way
       back up, which is the ping-pong at the largest possible scale. */
    cam.x += (cam.tx - cam.x) * Math.min(1, dt * 2.2);
    cam.y += (cam.ty - cam.y) * Math.min(1, dt * 2.2);
    camera.position.set(cam.x, cam.y, CAM_Z());
    camera.lookAt(0, cam.y * 0.25, 0);
  }

  function frame(now){
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    /* A background that keeps rendering in a hidden tab is pure battery cost. */
    if (document.hidden || state.paused) return;
    step(dt);
    renderer.render(scene, camera);
    frames++;
    if (now - fpsT > 500) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  }

  function composeStill(){
    /* Reduced motion still gets a real composition, not an empty page: run the
       simulation forward headlessly and render one frame. */
    for (let i = 0; i < 240; i++) step(1 / 60);
    renderer.render(scene, camera);
  }

  build();
  applyTheme();
  applyFog();
  resize();
  watchSections();

  /* Theme is OBSERVED, not called: this module must not care whether the page's
     own theme script or this one evaluates first. */
  new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  if (still.matches) composeStill(); else raf = requestAnimationFrame(frame);
  still.addEventListener('change', () => {
    cancelAnimationFrame(raf);
    if (still.matches) composeStill();
    else { last = performance.now(); raf = requestAnimationFrame(frame); }
  });

  /* Control surface for the lab page. The landing page uses none of it. */
  return {
    set(k, v){
      state[k] = v;
      if (k === 'count')  { build(); applyTheme(); }
      if (k === 'spread') applySpread();
      if (k === 'fog')    applyFog();
      /* Paused or reduced-motion: nothing is stepping, so a control change has
         to be drawn explicitly or the panel appears dead. */
      if (state.paused || still.matches) { step(0); renderer.render(scene, camera); }
    },
    get(k){ return state[k]; },
    /* `heading` is the flow angle in degrees (90 = straight up, the rest state)
       and `v` a sampled slab velocity. Both exist so a heading change can be
       CHECKED rather than eyeballed — a reversal that looks smooth at 60fps can
       still contain a one-frame sign flip. */
    stats(){
      const s0 = slabs[0];
      return { fps, slabs: slabs.length, mood: mood.name,
               spin: +spinMul.now.toFixed(2),
               v: s0 ? +(s0.spin * s0.spinRate[1]).toFixed(2) : 0 };
    }
  };
}
