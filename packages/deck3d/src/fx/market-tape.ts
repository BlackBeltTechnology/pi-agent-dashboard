import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Scrolling ticker bands with a candlestick ridge (topics: money, data). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  // Default speed is 0.4, not 1: as a ticker this scrolled fast enough to pull
  // the eye off the slide text.
  const speed = typeof params.speed === "number" ? params.speed : 0.4;
  const barWidth = typeof params.barWidth === "number" ? params.barWidth : 0.06;
  const volatility = typeof params.volatility === "number" ? params.volatility : 0.45;
  const trace = params.trace !== false;
  const count = Math.max(20, Math.round((quality.particles / 10) * density));

  // Thin box, not a Line: a real line ignores width on most GPUs, and these
  // still need to catch the key light so the ridge reads as a chart.
  const barGeo = new THREE.BoxGeometry(barWidth, 1, barWidth);
  const barMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.8 });
  const bars = new THREE.InstancedMesh(barGeo, barMat, count);

  const m = new THREE.Matrix4();
  const rows = 3;
  const seeds = Array.from({ length: count }, (_, i) => ({
    h: 0.5 + rng() * 4,
    row: i % rows,
    x0: ((i / count) * 2 - 1) * 26,
    // Per-bar phase and rate, so the series moves like quotes rather than a wave.
    ph: rng() * Math.PI * 2,
    rate: 0.6 + rng() * 1.1,
  }));

  const group = new THREE.Group();
  group.add(bars);

  // Polyline joining the bar tops — the "line chart" read.
  const traceGeo = new THREE.BufferGeometry();
  // 6 floats per segment (two endpoints), one segment per bar: an undersized
  // buffer truncates the polyline and the unwritten tail collapses to the
  // origin, drawing spokes across the slide.
  const tracePos = new Float32Array(count * 6);
  traceGeo.setAttribute("position", new THREE.BufferAttribute(tracePos, 3));
  const traceMat = new THREE.LineBasicMaterial({ color: palette.second, transparent: true, opacity: 0.55 });
  const traceLine = new THREE.LineSegments(traceGeo, traceMat);
  if (trace) group.add(traceLine);

  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const baseY = (row: number): number => -4 + row * 4.2;
  const place = (t: number): void => {
    // Sorted per row so the trace connects left-to-right neighbours, not the
    // arbitrary seed order (which would draw a scribble).
    const byRow: Array<Array<{ x: number; y: number }>> = [[], [], []];
    seeds.forEach((s, i) => {
      const x = ((((s.x0 + t * 1.4 * speed + 13) % 26) + 26) % 26) - 13;
      // The value moves: this is what makes the bars grow and shrink in place.
      const h = Math.max(0.15, s.h * (1 + Math.sin(t * s.rate * speed + s.ph) * volatility));
      m.makeScale(1, h, 1);
      m.setPosition(x, baseY(s.row) + h / 2, -s.row * 1.5);
      bars.setMatrixAt(i, m);
      byRow[s.row].push({ x, y: baseY(s.row) + h });
    });
    bars.instanceMatrix.needsUpdate = true;

    if (trace) {
      let w = 0;
      for (let row = 0; row < rows; row++) {
        const pts = byRow[row].sort((a, b) => a.x - b.x);
        for (let i = 0; i + 1 < pts.length && w + 5 < tracePos.length; i++) {
          // Skip the wrap seam, else a segment shoots back across the deck.
          if (pts[i + 1].x - pts[i].x > 6) continue;
          tracePos[w++] = pts[i].x;
          tracePos[w++] = pts[i].y;
          tracePos[w++] = -row * 1.5;
          tracePos[w++] = pts[i + 1].x;
          tracePos[w++] = pts[i + 1].y;
          tracePos[w++] = -row * 1.5;
        }
      }
      tracePos.fill(0, w);
      traceGeo.attributes.position.needsUpdate = true;
    }
  };
  place(0);

  return {
    object: holder,
    tick: place,
    dispose: () => {
      barGeo.dispose();
      barMat.dispose();
      traceGeo.dispose();
      traceMat.dispose();
    },
  };
};
