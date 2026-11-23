/* =============================================================================
   LIFE FIELD — Conway's Game of Life as the pi-dashboard.dev page background
   -----------------------------------------------------------------------------
   Candidate replacement for `site/field.js` (the session-slab fleet). Same
   rules of the house, different subject:

   1. PHOTOREAL FROM LIGHT, NOT MAPS. One soft key with real PCF shadows, a
      sky/ground hemisphere fill, a cool rim. Every cell is a chamfered slab, so
      the key catches a hairline on the bevel — that hairline IS the "glass".
      Materially the cells stay matte clay (roughness .62, metalness 0) with a
      thin clearcoat: a glassy EDGE, not a transmissive block. Transmission at
      this instance count is both a frame-rate and an anti-slop problem.
   2. NO BLOOM / NO DOF / NO ENV MAP. Depth is fog + scale + perspective only.
   3. THE MESSAGE. Life is the honest metaphor for the product: dozens of cells
      evolving on their own, generation after generation, with no one watching —
      and exactly ONE lit in the accent colour, the one that needs you. The
      accent is sticky: it stays on the same cell for as long as that cell
      survives, so in the deep-stack layout it draws a blue thread back through
      the history of the board.

   THE PING-PONG RULE (inherited from field.js, and it is load-bearing):
   scroll may only ever change RATES, never positions. Nothing in here returns
   to a rest state. The generation conveyor runs one direction forever; the
   wheel adds to an unsigned energy pool that decays, and the pool multiplies
   the tick rate. Scrolling up and scrolling down both speed it up.

   THREE COMPOSITIONS, one switch (`set('layout', …)`):
     'stack' — deep 3D conveyor. Each generation is a slab layer; layers drift
               away from camera at a constant rate and dissolve into fog. You
               see the last ~8 generations at once: the board's own history.
     'board' — one generation on a tilted plane, read like a physical board.
               Cells rise out of the plane when born and sink when they die.
     'wall'  — one generation upright, square to camera, behind the copy.

   TEXT CORRIDOR: the page has no scrim behind its headline, so the field must
   leave the middle alone by itself. `corridor` shrinks + sinks cells near the
   frame centre on the layers closest to camera only. Far layers are already
   handled by fog.

   USAGE
     import { initLifeField } from './gol.js';
     const f = initLifeField(document.getElementById('field'));
     f?.set('layout', 'board');
   ========================================================================== */
import * as THREE from '../../site/vendor/three.module.min.js';

export function initLifeField(canvas, opts = {}) {
  if (!canvas) return null;
  const root = document.documentElement;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.warn('life field: WebGL unavailable, skipping', e);
    return null;
  }
  renderer.outputColorSpace  = THREE.SRGBColorSpace;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  const narrow = () => window.innerWidth / window.innerHeight < 1;
  let wasNarrow = narrow();

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 400);
  scene.fog = new THREE.Fog(0x0a0a0a, 40, 150);

  /* ------------------------------------------------------------------ lights */
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.position.set(-30, 40, 44);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far  = 200;
  key.shadow.camera.left = -60; key.shadow.camera.right  = 60;
  key.shadow.camera.top  =  60; key.shadow.camera.bottom = -60;
  key.shadow.bias   = -0.0012;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.HemisphereLight(0xdfe8ff, 0x0b0d12, 0.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x9dc0ff, 1.3);
  rim.position.set(34, -18, -26);
  scene.add(rim);

  /* ----------------------------------------------------------------- palette */
  /* Product tokens, nudged in value only so the LIT result lands where the CSS
     token does after ACES. Four neutral tones, exactly one accent. */
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
  const theme = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  /* ---------------------------------------------------------------- geometry */
  /* Rounded + chamfered, exactly like the session slabs: the corner radius is
     in the 2D shape, the chamfer comes from a single bevel ring, and that ring
     is the only thing that has to survive at background scale. 3 curve segments
     is a quarter of the triangles of a smooth fillet and indistinguishable. */
  function slabGeometry(w, h, r, depth) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);       s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);   s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);       s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);           s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1,
      bevelSegments: 1, curveSegments: 3
    });
    g.center();
    return g;
  }
  const PITCH = 2.4;                                   /* grid spacing         */
  const GEO_CELL = slabGeometry(1.96, 1.96, 0.34, 0.62);

  /* ------------------------------------------------------------- icon atlas */
  /* Twelve Pictogrammers (MDI 7.4.47) file-type glyphs baked once into a 4×3
     canvas atlas: language-typescript, -javascript, -python, -go, -rust,
     -markdown, -css3, code-json, file-pdf-box, file-word-box, file-excel-box,
     file-powerpoint-box. Path data vendored verbatim (24×24 viewBox,
     nonzero winding — the letter cut-outs are counter-wound, so plain Path2D
     fill renders them correctly). Hues are muted mid-tones, NOT the brand
     colours — a saturated JS-yellow board would out-shout the accent cell —
     and the FINAL saturation/prominence lives in the shader behind the
     'Icon colour' dial, so calibrating never re-bakes the atlas. */
  const ICON_DEFS = [
    ['#4f7cc0', 'M3,3H21V21H3V3M13.71,17.86C14.21,18.84 15.22,19.59 16.8,19.59C18.4,19.59 19.6,18.76 19.6,17.23C19.6,15.82 18.79,15.19 17.35,14.57L16.93,14.39C16.2,14.08 15.89,13.87 15.89,13.37C15.89,12.96 16.2,12.64 16.7,12.64C17.18,12.64 17.5,12.85 17.79,13.37L19.1,12.5C18.55,11.54 17.77,11.17 16.7,11.17C15.19,11.17 14.22,12.13 14.22,13.4C14.22,14.78 15.03,15.43 16.25,15.95L16.67,16.13C17.45,16.47 17.91,16.68 17.91,17.26C17.91,17.74 17.46,18.09 16.76,18.09C15.93,18.09 15.45,17.66 15.09,17.06L13.71,17.86M13,11.25H8V12.75H9.5V20H11.25V12.75H13V11.25Z'],
    ['#a9953f', 'M3,3H21V21H3V3M7.73,18.04C8.13,18.89 8.92,19.59 10.27,19.59C11.77,19.59 12.8,18.79 12.8,17.04V11.26H11.1V17C11.1,17.86 10.75,18.08 10.2,18.08C9.62,18.08 9.38,17.68 9.11,17.21L7.73,18.04M13.71,17.86C14.21,18.84 15.22,19.59 16.8,19.59C18.4,19.59 19.6,18.76 19.6,17.23C19.6,15.82 18.79,15.19 17.35,14.57L16.93,14.39C16.2,14.08 15.89,13.87 15.89,13.37C15.89,12.96 16.2,12.64 16.7,12.64C17.18,12.64 17.5,12.85 17.79,13.37L19.1,12.5C18.55,11.54 17.77,11.17 16.7,11.17C15.19,11.17 14.22,12.13 14.22,13.4C14.22,14.78 15.03,15.43 16.25,15.95L16.67,16.13C17.45,16.47 17.91,16.68 17.91,17.26C17.91,17.74 17.46,18.09 16.76,18.09C15.93,18.09 15.45,17.66 15.09,17.06L13.71,17.86Z'],
    ['#4e8f6a', 'M19.14,7.5A2.86,2.86 0 0,1 22,10.36V14.14A2.86,2.86 0 0,1 19.14,17H12C12,17.39 12.32,17.96 12.71,17.96H17V19.64A2.86,2.86 0 0,1 14.14,22.5H9.86A2.86,2.86 0 0,1 7,19.64V15.89C7,14.31 8.28,13.04 9.86,13.04H15.11C16.69,13.04 17.96,11.76 17.96,10.18V7.5H19.14M14.86,19.29C14.46,19.29 14.14,19.59 14.14,20.18C14.14,20.77 14.46,20.89 14.86,20.89A0.71,0.71 0 0,0 15.57,20.18C15.57,19.59 15.25,19.29 14.86,19.29M4.86,17.5C3.28,17.5 2,16.22 2,14.64V10.86C2,9.28 3.28,8 4.86,8H12C12,7.61 11.68,7.04 11.29,7.04H7V5.36C7,3.78 8.28,2.5 9.86,2.5H14.14C15.72,2.5 17,3.78 17,5.36V9.11C17,10.69 15.72,11.96 14.14,11.96H8.89C7.31,11.96 6.04,13.24 6.04,14.82V17.5H4.86M9.14,5.71C9.54,5.71 9.86,5.41 9.86,4.82C9.86,4.23 9.54,4.11 9.14,4.11C8.75,4.11 8.43,4.23 8.43,4.82C8.43,5.41 8.75,5.71 9.14,5.71Z'],
    ['#4596b8', 'M2.64,10.33L2.62,10.27L2.84,10L2.96,9.92H6.8L6.83,10L6.65,10.26L6.54,10.32L2.64,10.33M1.03,11.31L1,11.26L1.22,10.97L1.34,10.91H6.24L6.29,11L6.21,11.24L6.11,11.31H1.03M3.63,12.3L3.59,12.24L3.75,11.96L3.85,11.9H6L6.07,11.97L6.05,12.22L5.97,12.3H3.63M14.78,10.14L13,10.61C12.81,10.65 12.8,10.66 12.66,10.5C12.5,10.32 12.39,10.21 12.16,10.1C11.5,9.76 10.83,9.86 10.22,10.25C9.5,10.73 9.11,11.42 9.12,12.3C9.13,13.16 9.72,13.87 10.57,14C11.3,14.09 11.91,13.83 12.4,13.28L12.69,12.89H10.62C10.4,12.89 10.35,12.75 10.42,12.57L10.97,11.39C11,11.33 11.08,11.22 11.24,11.22H14.68C14.83,10.72 15.09,10.26 15.43,9.81C16.21,8.78 17.16,8.24 18.43,8C19.5,7.82 20.56,7.93 21.5,8.57C22.34,9.15 22.87,9.93 23,10.96C23.19,12.41 22.76,13.59 21.76,14.61C21.05,15.33 20.18,15.78 19.19,16L18.33,16.08C17.35,16.06 16.46,15.78 15.71,15.13C15.19,14.68 14.83,14.14 14.65,13.5C14.5,13.74 14.38,13.97 14.21,14.2C13.44,15.22 12.43,15.85 11.15,16C10.1,16.16 9.12,15.95 8.26,15.31C7.47,14.71 7,13.91 6.9,12.92C6.76,11.75 7.1,10.7 7.81,9.78C8.57,8.78 9.58,8.15 10.82,7.92C11.82,7.74 12.79,7.86 13.66,8.44C14.23,8.82 14.63,9.34 14.9,9.96C14.94,10.05 14.9,10.11 14.78,10.14M20.89,11.74L20.86,11.38C20.67,10.32 19.69,9.72 18.67,9.95C17.66,10.17 17,10.8 16.79,11.81C16.6,12.65 17,13.5 17.77,13.84C18.36,14.1 18.96,14.06 19.53,13.78C20.37,13.35 20.84,12.66 20.89,11.74Z'],
    ['#b0714f', 'M21.9 11.7L21 11.2V11L21.7 10.3C21.8 10.2 21.8 10 21.7 9.9L21.6 9.8L20.7 9.5C20.7 9.4 20.7 9.3 20.6 9.3L21.2 8.5C21.3 8.4 21.3 8.2 21.1 8.1C21.1 8.1 21 8.1 21 8L20 7.8C20 7.7 19.9 7.7 19.9 7.6L20.3 6.7V6.4C20.2 6.3 20.1 6.3 20 6.3H19C19 6.3 19 6.2 18.9 6.2L19.1 5.2C19.1 5 19 4.9 18.9 4.9H18.8L17.8 5.1C17.8 5 17.7 5 17.6 4.9V3.9C17.6 3.7 17.5 3.6 17.3 3.6H17.2L16.3 4H16.2L16 3C16 2.8 15.8 2.7 15.7 2.8H15.6L14.8 3.4C14.7 3.4 14.6 3.4 14.6 3.3L14.3 2.4C14.2 2.3 14.1 2.2 13.9 2.2C13.9 2.2 13.8 2.2 13.8 2.3L13 3H12.8L12.3 2.2C12.2 2 12 2 11.8 2L11.7 2.1L11.2 3H11L10.3 2.3C10.2 2.2 10 2.2 9.9 2.3L9.8 2.4L9.5 3.3C9.4 3.3 9.3 3.3 9.3 3.4L8.5 2.8C8.3 2.7 8.1 2.7 8 2.9V3L7.8 4C7.8 4 7.7 4 7.6 4.1L6.7 3.7C6.6 3.6 6.4 3.7 6.3 3.8V4.9C6.3 5 6.2 5 6.2 5.1L5.2 4.9C5 4.8 4.9 4.9 4.9 5.1V5.2L5.1 6.2C5 6.2 5 6.3 4.9 6.3H3.9C3.7 6.3 3.6 6.4 3.6 6.6V6.7L4 7.6V7.8L3 8C2.8 8 2.7 8.2 2.7 8.3V8.4L3.3 9.2C3.3 9.3 3.3 9.4 3.2 9.4L2.4 9.8C2.3 9.9 2.2 10 2.2 10.2C2.2 10.2 2.2 10.3 2.3 10.3L3 11V11.2L2.2 11.7C2 11.8 2 12 2 12.1L2.1 12.2L3 12.8V13L2.3 13.7C2.2 13.8 2.2 14 2.3 14.1L2.4 14.2L3.3 14.5C3.3 14.6 3.3 14.7 3.4 14.7L2.8 15.5C2.7 15.6 2.7 15.8 2.9 15.9C2.9 15.9 3 15.9 3 16L4 16.2C4 16.3 4.1 16.3 4.1 16.4L3.7 17.3C3.6 17.4 3.7 17.6 3.8 17.7H4.9C5 17.7 5 17.8 5.1 17.8L4.9 18.8C4.9 19 5 19.1 5.1 19.1H5.2L6.2 18.9C6.2 19 6.3 19 6.4 19.1V20.1C6.4 20.3 6.5 20.4 6.7 20.4H6.8L7.7 20H7.8L8 21C8 21.2 8.2 21.3 8.3 21.2H8.4L9.2 20.6C9.3 20.6 9.4 20.6 9.4 20.7L9.7 21.6C9.8 21.7 9.9 21.8 10.1 21.8C10.1 21.8 10.2 21.8 10.2 21.7L11 21H11.2L11.7 21.8C11.8 21.9 12 22 12.1 21.9L12.2 21.8L12.7 21H12.9L13.6 21.7C13.7 21.8 13.9 21.8 14 21.7L14.1 21.6L14.4 20.7C14.5 20.7 14.6 20.7 14.6 20.6L15.4 21.2C15.5 21.3 15.7 21.3 15.8 21.1C15.8 21.1 15.8 21 15.9 21L16.1 20C16.2 20 16.2 19.9 16.3 19.9L17.2 20.3C17.3 20.4 17.5 20.3 17.6 20.2V19.1L17.8 18.9L18.8 19.1C19 19.1 19.1 19 19.1 18.9V18.8L18.9 17.8L19.1 17.6H20.1C20.3 17.6 20.4 17.5 20.4 17.3V17.2L20 16.3C20 16.2 20.1 16.2 20.1 16.1L21.1 15.9C21.3 15.9 21.4 15.7 21.3 15.6V15.5L20.7 14.7L20.8 14.5L21.7 14.2C21.8 14.1 21.9 14 21.9 13.8C21.9 13.8 21.9 13.7 21.8 13.7L21 13V12.8L21.8 12.3C22 12.2 22 12 21.9 11.7C21.9 11.8 21.9 11.8 21.9 11.7M16.2 18.7C15.9 18.6 15.7 18.3 15.7 18C15.8 17.7 16.1 17.5 16.4 17.5C16.7 17.6 16.9 17.9 16.9 18.2C16.9 18.6 16.6 18.8 16.2 18.7M16 16.8C15.7 16.7 15.4 16.9 15.4 17.2L15 18.6C14.1 19 13.1 19.2 12 19.2C10.9 19.2 9.9 19 8.9 18.5L8.6 17.1C8.5 16.8 8.3 16.6 8 16.7L6.8 17C6.6 16.8 6.4 16.5 6.2 16.3H12.2C12.3 16.3 12.3 16.3 12.3 16.2V14.1C12.3 14 12.3 14 12.2 14H10.5V12.7H12.4C12.6 12.7 13.3 12.7 13.6 13.7C13.7 14 13.8 15 14 15.3C14.1 15.6 14.6 16.3 15.1 16.3H18.2C18 16.6 17.8 16.8 17.5 17.1L16 16.8M7.7 18.7C7.4 18.8 7.1 18.6 7 18.2C6.9 17.9 7.1 17.6 7.5 17.5S8.1 17.6 8.2 18C8.2 18.3 8 18.6 7.7 18.7M5.4 9.5C5.5 9.8 5.4 10.2 5.1 10.3C4.8 10.4 4.4 10.3 4.3 10C4.2 9.7 4.3 9.3 4.6 9.2C5 9.1 5.3 9.2 5.4 9.5M4.7 11.1L6 10.6C6.3 10.5 6.4 10.2 6.3 9.9L6 9.3H7V14H5C4.7 13 4.6 12.1 4.7 11.1M10.3 10.7V9.3H12.8C12.9 9.3 13.7 9.4 13.7 10C13.7 10.5 13.1 10.7 12.6 10.7H10.3M19.3 11.9V12.4H18.5C18.4 12.4 18.4 12.4 18.4 12.5V12.8C18.4 13.6 17.9 13.8 17.5 13.8C17.1 13.8 16.7 13.6 16.6 13.4C16.4 12.1 16 11.9 15.4 11.4C16.1 10.9 16.9 10.2 16.9 9.3C16.9 8.3 16.2 7.7 15.8 7.4C15.1 7 14.4 6.9 14.2 6.9H6.6C7.7 5.7 9.1 4.9 10.7 4.6L11.6 5.6C11.8 5.8 12.1 5.8 12.4 5.6L13.4 4.6C15.5 5 17.3 6.3 18.4 8.2L17.7 9.8C17.6 10.1 17.7 10.4 18 10.5L19.3 11.1V11.9M11.6 3.9C11.8 3.7 12.2 3.7 12.4 3.9C12.6 4.1 12.6 4.5 12.4 4.7C12.1 5 11.8 5 11.5 4.7C11.3 4.5 11.4 4.2 11.6 3.9M18.5 9.5C18.6 9.2 19 9.1 19.3 9.2C19.6 9.3 19.7 9.7 19.6 10C19.5 10.3 19.1 10.4 18.8 10.3C18.5 10.2 18.4 9.8 18.5 9.5Z'],
    ['#7d7f9b', 'M20.56 18H3.44C2.65 18 2 17.37 2 16.59V7.41C2 6.63 2.65 6 3.44 6H20.56C21.35 6 22 6.63 22 7.41V16.59C22 17.37 21.35 18 20.56 18M6.81 15.19V11.53L8.73 13.88L10.65 11.53V15.19H12.58V8.81H10.65L8.73 11.16L6.81 8.81H4.89V15.19H6.81M19.69 12H17.77V8.81H15.85V12H13.92L16.81 15.28L19.69 12Z'],
    ['#7d5fa8', 'M5,3L4.35,6.34H17.94L17.5,8.5H3.92L3.26,11.83H16.85L16.09,15.64L10.61,17.45L5.86,15.64L6.19,14H2.85L2.06,18L9.91,21L18.96,18L20.16,11.97L20.4,10.76L21.94,3H5Z'],
    ['#6f8291', 'M5,3H7V5H5V10A2,2 0 0,1 3,12A2,2 0 0,1 5,14V19H7V21H5C3.93,20.73 3,20.1 3,19V15A2,2 0 0,0 1,13H0V11H1A2,2 0 0,0 3,9V5A2,2 0 0,1 5,3M19,3A2,2 0 0,1 21,5V9A2,2 0 0,0 23,11H24V13H23A2,2 0 0,0 21,15V19A2,2 0 0,1 19,21H17V19H19V14A2,2 0 0,1 21,12A2,2 0 0,1 19,10V5H17V3H19M12,15A1,1 0 0,1 13,16A1,1 0 0,1 12,17A1,1 0 0,1 11,16A1,1 0 0,1 12,15M8,15A1,1 0 0,1 9,16A1,1 0 0,1 8,17A1,1 0 0,1 7,16A1,1 0 0,1 8,15M16,15A1,1 0 0,1 17,16A1,1 0 0,1 16,17A1,1 0 0,1 15,16A1,1 0 0,1 16,15Z'],
    ['#a8625c', 'M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9.5 11.5C9.5 12.3 8.8 13 8 13H7V15H5.5V9H8C8.8 9 9.5 9.7 9.5 10.5V11.5M14.5 13.5C14.5 14.3 13.8 15 13 15H10.5V9H13C13.8 9 14.5 9.7 14.5 10.5V13.5M18.5 10.5H17V11.5H18.5V13H17V15H15.5V9H18.5V10.5M12 10.5H13V13.5H12V10.5M7 10.5H8V11.5H7V10.5Z'],
    ['#5677a8', 'M15.5,17H14L12,9.5L10,17H8.5L6.1,7H7.8L9.34,14.5L11.3,7H12.7L14.67,14.5L16.2,7H17.9M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3Z'],
    ['#4d8a5e', 'M16.2,17H14.2L12,13.2L9.8,17H7.8L11,12L7.8,7H9.8L12,10.8L14.2,7H16.2L13,12M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3Z'],
    ['#b0764a', 'M9.8,13.4H12.3C13.8,13.4 14.46,13.12 15.1,12.58C15.74,12.03 16,11.25 16,10.23C16,9.26 15.75,8.5 15.1,7.88C14.45,7.29 13.83,7 12.3,7H8V17H9.8V13.4M19,3A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5C3,3.89 3.9,3 5,3H19M9.8,12V8.4H12.1C12.76,8.4 13.27,8.65 13.6,9C13.93,9.35 14.1,9.72 14.1,10.24C14.1,10.8 13.92,11.19 13.6,11.5C13.28,11.81 12.9,12 12.22,12H9.8Z']
  ];
  function makeIconAtlas() {
    const T = 128, c = document.createElement('canvas');
    c.width = T * 4; c.height = T * 3;
    const g = c.getContext('2d');
    ICON_DEFS.forEach(([hue, path], i) => {
      /* flipY texture: shader tile-row 0 is the BOTTOM half of the canvas. */
      const x0 = (i % 4) * T, y0 = (2 - (i >> 2)) * T;
      g.save();
      /* 24×24 viewBox scaled to ~72% of the tile, centered — glyph only, no
         plate behind it: the cell face itself is the chip. */
      g.translate(x0 + T * 0.14, y0 + T * 0.14);
      g.scale((T * 0.72) / 24, (T * 0.72) / 24);
      g.fillStyle = hue;
      g.fill(new Path2D(path));
      g.restore();
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
  const iconAtlas = makeIconAtlas();

  /* Written by build() (layout base) and read by the parallax every frame, so
     it must exist before the first build — declaring it down in the parallax
     section put build() in its temporal dead zone and killed the whole field. */
  let baseYaw = 0;
  let maskZoom = 1;      /* camera retreat factor when a mask must fit in frame */

  /* ------------------------------------------------------------------ dials */
  const state = {
    layout: opts.layout || 'stack',
    cols: 30, rows: 20,
    gps: 2.2,          /* generations per second — the base rate              */
    depth: 8,          /* stack only: how many generations are on screen      */
    fog: 1,
    corridor: 1,       /* 0 = field crosses the type, 1 = full keep-out       */
    sway: 1.6,         /* pointer coupling: 0 = locked off, 1 = the old slide  */
    icons: true,       /* file-type glyph on each live cell's face             */
    iconTone: 0.35,    /* 0 = mono engraving, 1 = full hue — 'Icon colour' dial */
    mask: 'none',      /* confine Life to a glyph silhouette: none|ts|js|py|md */

    density: 0.30,     /* seed soup                                           */
    paused: false
  };

  /* ============================ THE SIMULATION ==============================
     Toroidal Conway. One Uint8Array, one scratch buffer, no allocation per
     generation. A background must never stall, so a stagnation watchdog drops
     a fresh soup patch in when the board goes still or falls into a period-2
     blinker soup — which a random start reliably does inside ~200 gens. */
  let W = state.cols, H = state.rows;
  let cur = new Uint8Array(W * H), nxt = new Uint8Array(W * H);
  let generation = 0, population = 0;
  const hist = [0, 0, 0, 0];        /* population ring, for the watchdog       */

  /* --------------------------------------------------------------- the mask */
  /* A glyph rendered at GRID resolution and thresholded: cells outside it are
     structurally dead — not culled at draw time but absent from the SIMULATION,
     so gliders bounce around inside the letterforms instead of clipping
     through an invisible wall of live-but-hidden neighbours. */
  let mask = null, maskArea = W * H;
  function buildMask() {
    if (state.mask === 'none') { mask = null; maskArea = W * H; return; }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const label = state.mask.toUpperCase();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    /* Fit by shrinking: at 30×20 a fixed font either overflows or leaves the
       glyph too thin for Life — letter strokes must be ≥3 cells wide or the
       rules cannot sustain anything inside them. */
    let fs = H * 1.3;
    do { g.font = `900 ${fs}px Arial, sans-serif`; fs -= 1; }
    while (g.measureText(label).width > W * 0.96 && fs > 4);
    g.fillText(label, W / 2, H / 2 + fs * 0.04);
    const d = g.getImageData(0, 0, W, H).data;
    mask = new Uint8Array(W * H); maskArea = 0;
    for (let i = 0; i < W * H; i++) {
      const m = d[i * 4 + 3] > 96 ? 1 : 0;
      mask[i] = m; maskArea += m;
    }
    if (maskArea < 12) { mask = null; maskArea = W * H; }   /* degenerate glyph */
  }

  function seed() {
    cur = new Uint8Array(W * H); nxt = new Uint8Array(W * H);
    for (let i = 0; i < cur.length; i++)
      cur[i] = (!mask || mask[i]) && Math.random() < state.density ? 1 : 0;
    /* A handful of gliders so there is always something TRAVELLING: pure soup
       settles into still lifes, and a still background is a dead background. */
    for (let g = 0; g < 5; g++) glider(1 + ((Math.random() * (W - 4)) | 0), 1 + ((Math.random() * (H - 4)) | 0));
    generation = 0;
  }
  function glider(x, y) {
    const p = [[1,0],[2,1],[0,2],[1,2],[2,2]];
    for (const [dx, dy] of p) {
      const j = ((y + dy) % H) * W + ((x + dx) % W);
      if (!mask || mask[j]) cur[j] = 1;
    }
  }
  function soupPatch() {
    const x0 = (Math.random() * W) | 0, y0 = (Math.random() * H) | 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const j = ((y0 + y) % H) * W + ((x0 + x) % W);
      if (!mask || mask[j]) cur[j] = Math.random() < 0.45 ? 1 : 0;
    }
  }
  function stepLife() {
    let pop = 0;
    for (let y = 0; y < H; y++) {
      const yn = ((y - 1 + H) % H) * W, yp = ((y + 1) % H) * W, y0 = y * W;
      for (let x = 0; x < W; x++) {
        const xn = (x - 1 + W) % W, xp = (x + 1) % W;
        const n = cur[yn + xn] + cur[yn + x] + cur[yn + xp]
                + cur[y0 + xn] +               cur[y0 + xp]
                + cur[yp + xn] + cur[yp + x] + cur[yp + xp];
        const a = cur[y0 + x];
        const v = (mask && !mask[y0 + x]) ? 0
                : (a ? (n === 2 || n === 3) : n === 3) ? 1 : 0;
        nxt[y0 + x] = v; pop += v;
      }
    }
    const t = cur; cur = nxt; nxt = t;
    generation++; population = pop;

    hist.shift(); hist.push(pop);
    /* Still life (4 identical counts) or a period-2 oscillator soup (a,b,a,b)
       both mean the board has stopped telling a story. */
    const still = hist[0] === hist[1] && hist[1] === hist[2] && hist[2] === hist[3];
    const osc2  = hist[0] === hist[2] && hist[1] === hist[3] && hist[0] !== hist[1];
    /* 7%, not the 4% a Life purist would use: measured on the wall layout, a
       board that has thinned to ~6% reads as a dying background rather than as
       a running one. The patch is small enough that it never looks like a
       reset — the surviving structures keep going. */
    /* Watchdog threshold is relative to the mask AREA, not the grid: a "PY"
       silhouette is ~20% of the board, and 7% of the full grid would mean the
       watchdog reseeds on every single generation. */
    if (still || osc2 || pop < maskArea * 0.07) { soupPatch(); glider((Math.random() * W) | 0, (Math.random() * H) | 0); }
  }

  /* ------------------------------------------------------ the accent ("you") */
  /* ONE cell, sticky: it keeps the accent for as long as it stays alive, so the
     eye can follow it across generations instead of the accent flickering
     around the board every tick. When it finally dies, the next one is chosen
     as the densest live neighbourhood — the busiest place on the board. */
  let acc = { x: -1, y: -1 };
  function pickAccent() {
    if (acc.x >= 0 && cur[acc.y * W + acc.x]) return;
    let best = -1, bx = -1, by = -1;
    for (let k = 0; k < 140; k++) {
      const x = (Math.random() * W) | 0, y = (Math.random() * H) | 0;
      if (!cur[y * W + x]) continue;
      /* Never behind the headline. The corridor shrinks ordinary cells until
         they stop competing with type, but the accent is the ONE thing the eye
         is meant to find — shrink it and it stops reading as a card, leave it
         full size and it sits on the words. So it is placed outside the
         corridor instead, exactly like the hero card in the slab field. */
      /* With a mask on, nearly every live cell IS in the middle (the glyph is
         centered) — keeping the keep-out would strand the accent forever. */
      if (!mask && state.layout !== 'board' && Math.abs(x - (W - 1) / 2) < W * 0.28) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        n += cur[((y + dy + H) % H) * W + ((x + dx + W) % W)];
      if (n > best) { best = n; bx = x; by = y; }
    }
    if (bx < 0) return;                 /* nothing outside the corridor: keep  */
    acc = { x: bx, y: by };
  }

  /* ============================== RENDERING =================================
     Instancing, not one Mesh per cell: a 30×20 board is 600 cells and the stack
     shows 8 generations of them at once, so a per-cell Mesh would mean ~5k
     draw calls. One InstancedMesh per generation-layer means 8. Per-cell colour
     variety comes from instanceColor (a flat constant per instance — still no
     maps, no gradients, no vertex colours).

     The accent is a SEPARATE single Mesh per layer, because emissive is a
     material property and cannot be set per instance. */
  const world = new THREE.Group();
  scene.add(world);

  const cellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,        /* white base: instanceColor multiplies into it   */
    roughness: 0.62, metalness: 0,
    clearcoat: 0.35,        /* the "glassy" part — a sheen on the chamfer,    */
    clearcoatRoughness: 0.5 /* NOT transmission                               */
  });
  const accMat = new THREE.MeshPhysicalMaterial({
    color: 0x2f6fe0, roughness: 0.45, metalness: 0,
    clearcoat: 0.5, clearcoatRoughness: 0.35,
    emissive: 0x3b82f6, emissiveIntensity: 1.0
  });

  /* The glyph lives INSIDE the standard material, not on a decal mesh: a
     second InstancedMesh per layer would double the matrix bookkeeping for the
     stack's 8 layers. onBeforeCompile samples the atlas on the cell's local +Z
     face only (the face the camera sees in every layout — board rotates the
     whole cell, so local +Z is still the top) and mixes it over the tinted
     body AFTER instanceColor, so icons inherit the per-cell tone shift. */
  cellMat.onBeforeCompile = s => {
    s.uniforms.uAtlas = { value: iconAtlas };
    s.uniforms.uIcons = { value: state.icons ? 1 : 0 };
    s.uniforms.uIconTone = { value: state.iconTone };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float iconIdx;
        varying vec2 vCellUv; varying float vIco; varying float vNz;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCellUv = position.xy / 2.16 + 0.5;   /* 1.96 face + 0.1 bevel ring */
        vIco = iconIdx; vNz = normal.z;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uAtlas; uniform float uIcons; uniform float uIconTone;
        varying vec2 vCellUv; varying float vIco; varying float vNz;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uIcons > 0.5 && vNz > 0.9) {
          vec2 uv = clamp(vCellUv, 0.03, 0.97);
          vec2 tile = vec2(mod(vIco, 4.0), floor(vIco / 4.0));
          vec4 gl = texture2D(uAtlas, (uv + tile) * vec2(0.25, 1.0 / 3.0));
          /* One dial, two effects: uIconTone desaturates the glyph toward its
             own luminance AND pulls its opacity down, so 0 = faint monochrome
             engraving, 1 = full baked hue. Calibration never re-bakes. */
          vec3 icoc = mix(vec3(dot(gl.rgb, vec3(0.299, 0.587, 0.114))), gl.rgb, uIconTone);
          diffuseColor.rgb = mix(diffuseColor.rgb, icoc, gl.a * (0.35 + 0.5 * uIconTone));
        }`);
    cellMat.userData.shader = s;
  };

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
  const V = new THREE.Vector3(), S = new THREE.Vector3();
  const C = new THREE.Color();

  /* A layer = one generation's worth of geometry. In 'stack' there are
     `depth` of them on a conveyor; in 'board'/'wall' there is exactly one. */
  let layers = [];

  function makeLayer() {
    const g = new THREE.Group();
    /* Instanced attributes live on the GEOMETRY, and every layer orders its
       instances differently — a shared GEO_CELL would have all 8 layers
       fighting over one iconIdx array. clone() copies vertex data (cheap, the
       slab is ~300 tris) and gives each layer its own instanced attribute. */
    const geo = GEO_CELL.clone();
    geo.setAttribute('iconIdx', new THREE.InstancedBufferAttribute(new Float32Array(W * H), 1));
    const inst = new THREE.InstancedMesh(geo, cellMat, W * H);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.receiveShadow = true;
    inst.count = 0;
    /* Per-instance colour is assigned once from a hash of the cell index: the
       same cell always gets the same tone, so a layer does not shimmer. */
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(W * H * 3), 3);
    g.add(inst);
    const accent = new THREE.Mesh(GEO_CELL, accMat);
    accent.castShadow = true; accent.visible = false;
    g.add(accent);
    world.add(g);
    return { g, inst, accent, grid: null, born: null, age: 0, z: 0 };
  }

  /* Where a cell sits, per composition. Returns false when the cell is culled.
     `near` (0 = far, 1 = closest) drives the text corridor: only the layers by
     the camera have to get out of the headline's way. */
  function place(x, y, near, a) {
    const cx = (x - (W - 1) / 2) * PITCH;
    const cy = ((H - 1) / 2 - y) * PITCH;
    let sc = 0.2 + 0.8 * a;                 /* birth pop / death shrink        */

    if (state.layout === 'board') {
      /* Tilted board: the grid lies flat in XZ and the rake comes from the
         CAMERA, not from a second rotation on the group — stacking both tilts
         stood the board up in the middle of the frame, right across the
         headline. Flat plane + a raised camera keeps it below the copy and
         lets the far rows recede into fog on their own.
         After the -90° X rotation the extrude axis is up, so S.z is the cell's
         HEIGHT: kept low so a live cell reads as a tile, not a brick. */
      /* The board's corridor is a DEPTH ramp, not a middle keep-out: the far
         rows are the ones that end up behind the copy, so they shrink away
         while the near tabletop stays dense. Same dial, different axis. */
      const far = Math.max(0, cy) / (((H - 1) / 2) * PITCH || 1);
      sc *= 1 - state.corridor * far * 0.75;
      if (sc < 0.06) return false;
      V.set(cx, -12 + 1.4 * a, -cy * 1.2);
      Q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      S.set(sc, sc, 0.28 + 0.55 * a);
      M.compose(V, Q, S);
      return true;
    }

    /* 'wall' and 'stack' both hang the grid in XY facing camera, so both have
       to respect the corridor. The ramp shrinks and pushes cells back rather
       than deleting them: a rectangular HOLE in a Life board reads as a bug,
       a receding middle reads as depth. */
    const half = (W - 1) / 2 * PITCH;
    const t = Math.min(1, Math.abs(cx) / (half * 0.56));
    const ramp = t * t * (3 - 2 * t);                       /* smoothstep      */
    /* The corridor applies to EVERY layer, not just the ones near camera.
       Measured: weighting it by distance left the far generations at full size
       straight across the headline — they are the ones the eye reads as "on
       top of the type", because perspective has made them small and busy.
       Depth only softens it (`near` keeps a floor), so the hollow reads as a
       tunnel around the copy rather than as a rectangular hole punched in one
       plane. */
    if (state.layout === 'wall') {
      /* One layer has no depth to hide behind, so shrinking cells to nothing in
         the middle just produced dust. The wall clears the type by pushing the
         corridor BACKWARDS instead: cells stay recognisable cells, they simply
         fall away from camera and let fog take them. */
      const keep = 1 - state.corridor * (1 - ramp) * 0.55;
      sc *= keep;
      if (sc < 0.06) return false;
      V.set(cx, cy, a * 1.4 - state.corridor * (1 - ramp) * 18);
      Q.identity();
      S.set(sc, sc, 0.4 + 0.6 * a);
      M.compose(V, Q, S);
      return true;
    }

    /* Stack: the corridor applies to every layer with only a depth-weighted
       softening, so the hollow reads as a tunnel around the copy. */
    const w = 0.55 + 0.45 * near;
    const keep = 1 - state.corridor * w * (1 - ramp) * 0.96;
    sc *= keep;
    if (sc < 0.06) return false;

    V.set(cx, cy, -(1 - keep) * 5);
    Q.identity();
    S.set(sc, sc, 0.4 + 0.6 * a);
    M.compose(V, Q, S);
    return true;
  }

  /* Fill a layer's instance buffer from a generation snapshot. `alpha` is a
     per-cell 0..1 that the caller animates (birth/death); `near` is the
     corridor weight for this layer. */
  function fillLayer(L, alpha, near) {
    const pal = PAL[theme()];
    const ico = L.inst.geometry.getAttribute('iconIdx');
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = alpha[i];
      if (a <= 0.02) continue;
      if (acc.x === x && acc.y === y) continue;     /* drawn by the accent mesh */
      if (!place(x, y, near, a)) continue;
      L.inst.setMatrixAt(n, M);
      C.setHex(pal.body[(x * 7 + y * 13) & 3]);
      L.inst.setColorAt(n, C);
      /* Same hash family as the tint: a cell keeps its file type for life, so
         the board doesn't reshuffle its "files" every generation. */
      ico.setX(n, (x * 5 + y * 11) % 12);
      n++;
    }
    L.inst.count = n;
    L.inst.instanceMatrix.needsUpdate = true;
    ico.needsUpdate = true;
    if (L.inst.instanceColor) L.inst.instanceColor.needsUpdate = true;

    const live = acc.x >= 0 && L.grid && L.grid[acc.y * W + acc.x];
    L.accent.visible = !!live;
    if (live && place(acc.x, acc.y, near, Math.max(0.55, alpha[acc.y * W + acc.x]))) {
      L.accent.position.setFromMatrixPosition(M);
      L.accent.quaternion.setFromRotationMatrix(M);
      M.decompose(V, Q, S); L.accent.scale.copy(S).multiplyScalar(1.08);
    } else L.accent.visible = false;
  }

  /* ------------------------------------------------------------ layout setup */
  const LAYER_GAP = 13;                 /* z between successive generations    */
  const Z_NEAR    = 8;                  /* the newest layer sits here          */

  /* Per-cell animation state for the single-layer layouts. */
  const DEAD_FLOOR = 0.14;          /* see the substrate note in step()       */
  /* Inside a mask the substrate is the LETTERFORM — at 0.14 the glyph was 70%
     gaps and read as dust. 0.55 keeps the plates near-contiguous, so the
     silhouette reads as a solid slab and the live cells sparkle on top of it. */
  const MASK_FLOOR = 0.55;
  let alphaCur = new Float32Array(W * H);
  let alphaOne = new Float32Array(W * H);

  function build() {
    for (const L of layers) { world.remove(L.g); L.inst.geometry.dispose(); L.inst.dispose(); }
    layers = [];
    alphaCur = new Float32Array(W * H);
    alphaOne = new Float32Array(W * H);

    const n = state.layout === 'stack' ? (narrow() ? Math.min(6, state.depth) : state.depth) : 1;
    for (let i = 0; i < n; i++) {
      const L = makeLayer();
      L.grid = cur.slice();
      L.z = Z_NEAR - i * LAYER_GAP;
      L.g.position.z = L.z;
      layers.push(L);
    }
    /* The base yaw is stored rather than written into world.rotation, because
       pointer sway now writes that same channel every frame — setting it here
       too would fight the parallax and snap the board back on every rebuild. */
    baseYaw = state.layout === 'board' ? 0.18 : 0;
    world.rotation.set(0, baseYaw, 0);
    /* Only the two layers nearest camera cast: past that the shadow is smaller
       than the softness radius and costs a depth pass for nothing. */
    layers.forEach((L, i) => { L.inst.castShadow = i < 2; });
    applyCamera();
    refillAll();
  }

  function refillAll() {
    if (state.layout === 'stack') {
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        for (let k = 0; k < alphaOne.length; k++) alphaOne[k] = L.grid[k] ? 1 : 0;
        fillLayer(L, alphaOne, nearOf(L));
      }
    } else if (layers[0]) {
      for (let k = 0; k < alphaCur.length; k++)
        alphaCur[k] = cur[k] ? 1 : (mask ? (mask[k] ? MASK_FLOOR : 0) : DEAD_FLOOR);
      fillLayer(layers[0], alphaCur, 1);
    }
  }
  const nearOf = L => Math.max(0, Math.min(1, (L.g.position.z + 30) / 40));

  function applyCamera() {
    if (state.layout === 'board') {
      camera.position.set(0, 12, narrow() ? 70 : 56);
      camera.lookAt(0, -10, -4);
    } else if (state.layout === 'wall') {
      /* Close enough that the grid OVERFILLS the frame: a wall with visible
         margins reads as a widget sitting on the page, not as a background. */
      camera.position.set(0, 0, narrow() ? 58 : 44);
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.set(0, 0, narrow() ? 68 : 52);
      camera.lookAt(0, 0, 0);
    }
    /* A mask inverts the framing contract. The free field OVERFILLS the frame
       (a background, not a widget); a glyph silhouette is a LOGO and is
       meaningless cropped. So with a mask on, the camera backs off until the
       whole grid fits — and maskZoom carries the same factor into the fog
       distances, or the retreated glyph sits entirely inside the fog band. */
    maskZoom = 1;
    if (mask && state.layout !== 'board') {
      const t = Math.tan((narrow() ? 42 : 32) * Math.PI / 360);
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      const need = Math.max(H * PITCH * 0.62 / t, W * PITCH * 0.62 / (t * aspect));
      maskZoom = Math.max(1, need / camera.position.z);
      camera.position.z *= maskZoom;
    }
    applyFog();
  }

  function applyTheme() {
    const pal = PAL[theme()];
    scene.fog.color.setHex(pal.fog);
    key.intensity = pal.key;
    fill.color.setHex(pal.fillSky); fill.groundColor.setHex(pal.fillGround);
    fill.intensity = pal.fillI;
    rim.color.setHex(pal.rim); rim.intensity = pal.rimI;
    renderer.toneMappingExposure = pal.exposure;
    accMat.color.setHex(pal.accent); accMat.emissive.setHex(pal.emissive);
    refillAll();
  }
  function applyFog() {
    const f = Math.max(0.001, state.fog);
    /* The stack needs a much deeper fog throw than a single layer, or the
       conveyor dissolves two generations back and stops reading as history. */
    const base = state.layout === 'stack' ? [46, 190] : [40, 150];
    scene.fog.near = base[0] * maskZoom / f;
    scene.fog.far  = base[1] * maskZoom / f;
  }

  /* --------------------------------------------------------------- parallax */
  /* Two couplings from one pointer, because translation alone cannot show a
     SIDE of anything: the camera slides (parallax), and the world yaws/pitches
     toward the pointer (rotation). Translation moves the grid across the frame;
     rotation is what makes the far end of the stack swing and reveals the
     chamfer on the cell edges. Both are eased — a 1:1 pointer response is the
     tell of a demo, a lagged one reads as a camera with mass. */
  const cam = { tx: 0, ty: 0, x: 0, y: 0, tyaw: 0, tpit: 0, yaw: 0, pit: 0 };
  let lastPx = 0, lastPy = 0;
  function aimPointer(px, py) {
    lastPx = px; lastPy = py;
    const s = state.sway;
    cam.tx =  px * 5.0 * s;
    cam.ty = -py * 3.0 * s;
    /* Yaw is NEGATIVE px: the field turns to face the pointer rather than
       fleeing it, which is the difference between looking around an object and
       pushing it. Pitch is half the yaw — an equal amount tips the grid off its
       own plane and the text corridor stops lining up with the copy. */
    cam.tyaw = -px * 0.26 * s;
    cam.tpit =  py * 0.11 * s;
  }
  window.addEventListener('pointermove', e => aimPointer(
    e.clientX / window.innerWidth  - 0.5,
    e.clientY / window.innerHeight - 0.5), { passive: true });

  /* ------------------------------------------------------- scroll: rates only */
  /* Unsigned energy pool. Scroll adds, time drains, and the pool multiplies the
     GENERATION RATE (and, in the stack, the conveyor speed that is derived from
     it). Nothing here is a position, so nothing can retrace itself. */
  let lastY = window.scrollY, energy = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY, d = Math.abs(y - lastY); lastY = y;
    energy = Math.min(2.4, energy + Math.min(1, d / 90) * 0.85);
  }, { passive: true });

  /* Per-section mood: same idea as the slab field. A reading block slows the
     board down so the type owns the frame; the feature grid can afford to run. */
  const MOODS = {
    hero:     { gpsX: 1.00, fogX: 1.00 },
    control:  { gpsX: 0.30, fogX: 1.70 },
    features: { gpsX: 1.90, fogX: 0.85 },
    close:    { gpsX: 1.40, fogX: 0.75 }
  };
  const mood = { name: 'hero', gpsX: 1, fogX: 1, to: MOODS.hero };
  function watchSections() {
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

  /* ------------------------------------------------------------- frame loop */
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0, last = performance.now(), acc_t = 0;
  let frames = 0, fpsT = 0, fps = 0;

  function tick() {
    stepLife(); pickAccent();
    if (state.layout === 'stack') {
      /* CONVEYOR: recycle the layer that has fallen off the back and bring it
         to the front with the new generation. Recycling instead of allocating
         means a generation costs zero GC, and because every layer only ever
         moves in -z there is no return path to ping-pong along. */
      const L = layers.pop();
      if (!L) return;
      L.grid = cur.slice();
      L.g.position.z = layers.length ? layers[0].g.position.z + LAYER_GAP : Z_NEAR;
      layers.unshift(L);
      layers.forEach((l, i) => { l.inst.castShadow = i < 2; });
      for (let k = 0; k < alphaOne.length; k++) alphaOne[k] = L.grid[k] ? 1 : 0;
      fillLayer(L, alphaOne, nearOf(L));
    }
  }

  function step(dt) {
    const k = Math.min(1, dt * 1.5);
    mood.gpsX += (mood.to.gpsX - mood.gpsX) * k;
    mood.fogX += (mood.to.fogX - mood.fogX) * k;
    energy *= Math.exp(-dt * 0.45);

    const rate = state.gps * mood.gpsX * (1 + energy * 1.1);   /* gens / second */

    const f = Math.max(0.001, state.fog * mood.fogX);
    const base = state.layout === 'stack' ? [46, 190] : [40, 150];
    scene.fog.near = base[0] * maskZoom / f;
    scene.fog.far  = base[1] * maskZoom / f;

    /* Generation clock. Fixed accumulator so a dropped frame does not skip a
       generation, capped at 3 catch-up ticks so a backgrounded tab returning
       does not simulate a thousand of them in one frame. */
    acc_t += dt * rate;
    let guard = 0;
    while (acc_t >= 1 && guard++ < 3) { acc_t -= 1; tick(); }

    if (state.layout === 'stack') {
      /* Continuous drift, derived from the same rate as the clock so the
         conveyor and the simulation never desynchronise. */
      const v = LAYER_GAP * rate;
      for (const L of layers) L.g.position.z -= v * dt;
      /* Corridor weight changes with distance, so the near layers have to be
         refilled as they travel; the far ones are static geometry. */
      for (let i = 0; i < Math.min(2, layers.length); i++) {
        const L = layers[i];
        for (let m = 0; m < alphaOne.length; m++) alphaOne[m] = L.grid[m] ? 1 : 0;
        fillLayer(L, alphaOne, nearOf(L));
      }
    } else {
      /* Single-layer layouts animate per cell instead: births ease in, deaths
         ease out, so a generation change is a swell rather than a cut. */
      const L = layers[0];
      if (L) {
        L.grid = cur;
        const ease = Math.min(1, dt * 7.5);
        let moving = false;
        for (let i = 0; i < alphaCur.length; i++) {
          /* DEAD CELLS ARE NOT ABSENT. A single generation is only ~10% alive,
             and drawing only the live ones left the wall reading as scattered
             dust rather than as a board executing. Every cell is therefore a
             recessed plate at a floor alpha; birth is a cell coming FORWARD out
             of the substrate, death is it sinking back. Costs nothing extra
             (the instance count was never the bottleneck) and it is what the
             rules actually look like. */
          /* With a mask on, the substrate stops at the letterform edge: dead
             cells INSIDE the glyph keep their recessed plate (so the shape
             reads even where Life has thinned), outside there is nothing. */
          const target = cur[i] ? 1 : (mask ? (mask[i] ? MASK_FLOOR : 0) : DEAD_FLOOR);
          const d = target - alphaCur[i];
          if (Math.abs(d) > 0.002) { alphaCur[i] += d * ease; moving = true; }
          else alphaCur[i] = target;
        }
        if (moving) fillLayer(L, alphaCur, 1);
      }
    }

    /* The accent breathes — 1.4s in the product UI, slowed to ~3s here because
       at background scale a fast pulse is a distraction, not a signal. */
    const b = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 2.1);
    accMat.emissiveIntensity = 0.55 + 1.05 * b;

    const ease = Math.min(1, dt * 2.2);
    cam.x += (cam.tx - cam.x) * ease;
    cam.y += (cam.ty - cam.y) * ease;
    cam.yaw += (cam.tyaw - cam.yaw) * ease;
    cam.pit += (cam.tpit - cam.pit) * ease;
    /* Rotation goes on the WORLD, not the camera: rotating the camera would
       swing the text corridor (which is computed in grid space) off the copy,
       while turning the grid keeps the corridor welded to the cells it hollows. */
    world.rotation.y = baseYaw + cam.yaw;
    world.rotation.x = cam.pit;
    const home = camera.position.clone();
    camera.position.x = cam.x;
    camera.position.y = (state.layout === 'board' ? 12 : 0) + cam.y;
    camera.position.z = home.z;
    if (state.layout === 'board') camera.lookAt(0, -10, -4);
    else camera.lookAt(0, cam.y * 0.25, 0);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.hidden || state.paused) return;
    step(dt);
    renderer.render(scene, camera);
    frames++;
    if (now - fpsT > 500) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  }

  function composeStill() {
    /* Reduced motion still gets a real composition: run the board forward
       headlessly so it is mid-story, then render exactly one frame. */
    for (let i = 0; i < 60; i++) { stepLife(); pickAccent(); }
    build(); refillAll();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = narrow() ? 42 : 32;
    camera.updateProjectionMatrix();
    if (narrow() !== wasNarrow) { wasNarrow = narrow(); build(); applyTheme(); }
    else applyCamera();
  }
  window.addEventListener('resize', resize);

  seed(); pickAccent();
  build(); applyTheme(); applyFog(); resize(); watchSections();
  new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  if (still.matches) composeStill(); else raf = requestAnimationFrame(frame);
  still.addEventListener('change', () => {
    cancelAnimationFrame(raf);
    if (still.matches) composeStill();
    else { last = performance.now(); raf = requestAnimationFrame(frame); }
  });

  return {
    set(k, v) {
      state[k] = v;
      if (k === 'layout' || k === 'depth' || k === 'cols' || k === 'rows') {
        if (k === 'cols' || k === 'rows') {
          W = state.cols; H = state.rows; buildMask(); seed(); pickAccent();
        }
        build(); applyTheme();
      }
      if (k === 'fog') applyFog();
      if (k === 'corridor') refillAll();
      if (k === 'mask') { buildMask(); seed(); pickAccent(); build(); applyTheme(); }
      if (k === 'icons' && cellMat.userData.shader)
        cellMat.userData.shader.uniforms.uIcons.value = v ? 1 : 0;
      if (k === 'iconTone' && cellMat.userData.shader)
        cellMat.userData.shader.uniforms.uIconTone.value = v;
      /* Targets are only written on pointermove, so a sway change would not be
         visible — including sway 0 — until the mouse next moved. Re-aim at the
         last known pointer instead of waiting for one. */
      if (k === 'sway') aimPointer(lastPx, lastPy);
      if (state.paused || still.matches) { renderer.render(scene, camera); }
    },
    get(k) { return state[k]; },
    reseed() { seed(); pickAccent(); build(); applyTheme(); },
    stats() {
      return { fps, gen: generation, pop: population, mood: mood.name,
               layers: layers.length, cells: layers.reduce((a, L) => a + L.inst.count, 0) };
    }
  };
}
