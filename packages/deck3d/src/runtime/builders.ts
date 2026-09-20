/**
 * 3D diagram builders (ported from the lab). Flowchart + sequence consume the
 * harvested IR; brain/loop/swarm are procedural. Every builder returns
 * `{ g, tick }` so the engine advances all of them from one clock.
 */
import type { Font } from "opentype.js";
import * as THREE from "three";
import type { MergedNode, MergedSlide } from "../ir/types.js";
import { diagramMaterial } from "./materials.js";
import { nodeGeometry } from "./node-geometry.js";
import type { PaletteColors } from "./palette.js";
import { makeRng } from "./rng.js";
import { buildLabel, buildTitle } from "./text.js";
import type { SlideConfig } from "./types.js";

export interface BuiltLabel {
  id: string;
  text: string;
  object: THREE.Object3D;
  height: number;
}

export interface DiagramBuild {
  g: THREE.Group;
  tick: (t: number) => void;
  /** Node meshes by id (flowchart) — used by measurement/occlusion. */
  nodes?: Record<string, THREE.Mesh>;
  /** Labelled objects (node/actor/message) for `measure()`. */
  labels?: BuiltLabel[];
  /** Sequence only: id of the currently lifted message group (F7). */
  lifted?: () => string | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const DIR = new THREE.Vector3();

function arrowHead(mat: THREE.Material, r: number): THREE.Mesh {
  const c = new THREE.Mesh(new THREE.ConeGeometry(Math.min(0.07, r * 3), Math.min(0.2, r * 8), 16), mat);
  c.geometry.rotateX(Math.PI / 2);
  return c;
}

function empty(): DiagramBuild {
  return { g: new THREE.Group(), tick: () => {} };
}

/* ---------------------------------------------------------------- *
 * Built topologies (D2). Each renders from `diagram.data` alone — no
 * mermaid harvest — and exposes its parts to `measure()` like flowchart
 * nodes: one `nodes` entry and one `labels` entry per series item, keyed
 * `n<i>` so a check finding can name it.
 * ---------------------------------------------------------------- */

/** Series view of a slide: captions always, magnitudes only when complete. */
function series(slide: MergedSlide, fallback: string[] = []): { labels: string[]; values?: number[] } {
  const data = slide.diagram.data;
  const labels = data?.labels?.length ? data.labels : fallback;
  const values = data?.values?.length === labels.length ? data.values : undefined;
  return { labels, values };
}

interface BuiltParts {
  nodes: Record<string, THREE.Mesh>;
  labels: BuiltLabel[];
}

/**
 * Evenly spaced point on a ring. Captioned members of the cloud topologies are
 * pinned to it: following the cloud's own random positions puts two captions in
 * the same screen region, which `check` correctly reports as overlap/occlusion.
 */
function ringPoint(i: number, n: number, rx: number, ry = rx): THREE.Vector3 {
  const a = Math.PI / 2 - (i * Math.PI * 2) / Math.max(1, n);
  return new THREE.Vector3(Math.cos(a) * rx, Math.sin(a) * ry, 0);
}

/**
 * Built-topology captions are labels, not prose: the slide card already shows
 * the bullet in full, so a sentence-length caption is clipped here rather than
 * allowed to grow wider than the topology it annotates.
 */
const CAPTION_MAX = 22;

function caption(text: string): string {
  return text.length <= CAPTION_MAX ? text : `${text.slice(0, CAPTION_MAX - 1).trimEnd()}\u2026`;
}

/** Attach a caption plane at `pos`, owned by `id`, and record it for `measure()`. */
function addPart(
  g: THREE.Group,
  parts: BuiltParts,
  id: string,
  text: string,
  mesh: THREE.Mesh,
  pos: THREE.Vector3,
  P: PaletteColors,
  cfg: SlideConfig,
): void {
  const shown = caption(text);
  mesh.userData.ownerId = id;
  mesh.userData.label = shown;
  parts.nodes[id] = mesh;
  const lb = buildLabel(shown, cfg.labels?.size ?? 0.13, P);
  lb.group.position.copy(pos);
  lb.group.userData.ownerId = id;
  g.add(lb.group);
  parts.labels.push({ id, text: shown, object: lb.group, height: lb.height });
}

/** Columns on a plinth, height ∝ value. A zero value keeps a stub so its label stays. */
function buildBars(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const { labels, values } = series(slide, ["A", "B", "C"]);
  if (!labels.length) return empty();
  const g = new THREE.Group();
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const matA = diagramMaterial(P, "accent", cfg);
  const matB = diagramMaterial(P, "second", cfg);
  const MAX_H = 2.4;
  const STUB = 0.12;
  // High enough that BOTH staggered caption rows clear the diagram disc
  // (its top sits at about y = -1.66).
  const BASE = -1.0;
  const DEPTH = 0.12;
  const PLINTH_D = 0.6;
  const peak = Math.max(...(values ?? [1]), Number.EPSILON);
  // Kept inside the diagram disc; a wider spread also costs ratio fidelity,
  // because off-axis columns sit further from the camera.
  const span = 2.2;
  const step = labels.length > 1 ? span / (labels.length - 1) : 0;
  const width = Math.min(0.62, (span / Math.max(1, labels.length)) * 0.7);

  labels.forEach((text, i) => {
    const v = values?.[i];
    // Heights are exactly proportional so the ratio survives projection; only a
    // genuine zero falls back to the stub.
    const h = v === undefined ? MAX_H : v === 0 ? STUB : (v / peak) * MAX_H;
    const x = labels.length > 1 ? -span / 2 + i * step : 0;
    // Shallow in z on purpose: the projected rect of a deep box picks up a
    // depth term that does not scale with `h`, which would skew the ratio a
    // reader (and `measure()`) is entitled to trust.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, h, DEPTH), i === 0 ? matA : matB);
    bar.position.set(x, BASE + h / 2, 0);
    bar.castShadow = true;
    g.add(bar);
    // In front of the plinth, not on it: a caption drawn on the light plinth
    // face loses its contrast and gets clipped by the plinth's front edge.
    // Real captions are words, not letters, so consecutive ones alternate rows
    // — at four columns a single row collides every time.
    const row = labels.length > 2 && i % 2 === 1 ? 0.34 : 0;
    addPart(g, parts, `n${i}`, text, bar, new THREE.Vector3(x, BASE - 0.26 - row, PLINTH_D / 2 + 0.15), P, cfg);
  });

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(span + 0.9, 0.1, PLINTH_D), diagramMaterial(P, "second", cfg));
  plinth.position.set(0, BASE - 0.05, 0);
  plinth.receiveShadow = true;
  g.add(plinth);

  return { g, ...parts, tick: (t) => { g.rotation.y = Math.sin(t * 0.25) * 0.18; } };
}

/** Stacked slabs narrowing downward, one per label. */
function buildFunnel(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const { labels } = series(slide, ["Leads", "Qualified", "Won"]);
  if (!labels.length) return empty();
  const g = new THREE.Group();
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const n = labels.length;
  const slabH = Math.min(0.5, 2.6 / n);
  const top = ((n - 1) * slabH) / 2;

  labels.forEach((text, i) => {
    const rTop = 1.5 * (1 - i / (n + 1));
    const rBottom = 1.5 * (1 - (i + 1) / (n + 1));
    const y = top - i * slabH;
    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBottom, slabH * 0.82, 6),
      diagramMaterial(P, i === 0 ? "accent" : "second", cfg),
    );
    slab.position.set(0, y, 0);
    slab.castShadow = true;
    g.add(slab);
    addPart(g, parts, `n${i}`, text, slab, new THREE.Vector3(rTop + 0.95, y, 0.2), P, cfg);
  });

  return { g, ...parts, tick: (t) => { g.rotation.y = t * 0.2; } };
}

/** Milestone pucks along a rail; captions alternate above and below it. */
function buildTimelineRail(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const { labels } = series(slide, ["Now", "Next", "Later"]);
  if (!labels.length) return empty();
  const g = new THREE.Group();
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const span = 3.4;
  const step = labels.length > 1 ? span / (labels.length - 1) : 0;
  const RAIL_Y = 0;

  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, span + 0.6, 12), diagramMaterial(P, "second", cfg));
  rail.rotation.z = Math.PI / 2;
  rail.position.y = RAIL_Y;
  g.add(rail);

  labels.forEach((text, i) => {
    const x = labels.length > 1 ? -span / 2 + i * step : 0;
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 24), diagramMaterial(P, "accent", cfg));
    puck.rotation.x = Math.PI / 2;
    puck.position.set(x, RAIL_Y, 0);
    puck.castShadow = true;
    g.add(puck);
    // Alternating sides keep captions from colliding on a dense rail.
    const above = i % 2 === 0;
    addPart(g, parts, `n${i}`, text, puck, new THREE.Vector3(x, RAIL_Y + (above ? 0.55 : -0.55), 0.12), P, cfg);
  });

  return { g, ...parts, tick: (t) => { g.rotation.y = Math.sin(t * 0.3) * 0.25; } };
}

/** Wire sphere with arcs between seeded surface points. */
function buildGlobe(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const { labels } = series(slide, ["EMEA", "AMER", "APAC"]);
  const g = new THREE.Group();
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const R = 1.25;
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(R, 24, 16),
    new THREE.MeshBasicMaterial({ color: P.second, wireframe: true, transparent: true, opacity: 0.35 }),
  );
  g.add(globe);

  const rnd = makeRng(7);
  const sites = labels.map((_, i) => {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / Math.max(1, labels.length));
    const theta = rnd() * Math.PI * 2;
    return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).multiplyScalar(R);
  });

  labels.forEach((text, i) => {
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), diagramMaterial(P, "accent", cfg));
    pin.position.copy(sites[i]);
    g.add(pin);
    addPart(g, parts, `n${i}`, text, pin, sites[i].clone().multiplyScalar(1.28), P, cfg);
  });

  const arcMat = new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0.7 });
  for (let i = 0; i + 1 < sites.length; i++) {
    const mid = sites[i].clone().add(sites[i + 1]).normalize().multiplyScalar(R * 1.45);
    const curve = new THREE.QuadraticBezierCurve3(sites[i], mid, sites[i + 1]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.02, 8, false), arcMat));
  }

  return { g, ...parts, tick: (t) => { g.rotation.y = t * 0.18; } };
}

/** Hub sphere with one satellite per label, each on its own tilted ring. */
function buildOrbitCluster(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const { labels } = series(slide, ["Partner", "Reseller", "OEM"]);
  const g = new THREE.Group();
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), diagramMaterial(P, "accent", cfg));
  hub.castShadow = true;
  g.add(hub);

  const sats = labels.map((text, i) => {
    const radius = 0.9 + (i % 3) * 0.35;
    const tilt = (i / Math.max(1, labels.length)) * Math.PI;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.012, 8, 96),
      new THREE.MeshBasicMaterial({ color: P.second, transparent: true, opacity: 0.4 }),
    );
    ring.rotation.set(Math.PI / 2, 0, tilt);
    g.add(ring);

    const sat = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 1), diagramMaterial(P, "second", cfg));
    const holder = new THREE.Group();
    holder.rotation.set(Math.PI / 2, 0, tilt);
    holder.add(sat);
    g.add(holder);

    const phase = (i / Math.max(1, labels.length)) * Math.PI * 2;
    sat.position.set(Math.cos(phase) * radius, Math.sin(phase) * radius, 0);
    // Captions live on an even ring in the GROUP's own space. Following the
    // satellite through `getWorldPosition` reads a stale matrix at build time
    // and projects off-screen.
    const at = ringPoint(i, labels.length, radius + 0.75, radius + 0.55);
    addPart(g, parts, `n${i}`, text, sat, at, P, cfg);
    return { sat, radius, phase };
  });

  return {
    g,
    ...parts,
    tick(t) {
      for (const s of sats) {
        const a = s.phase + t * 0.35;
        s.sat.position.set(Math.cos(a) * s.radius, Math.sin(a) * s.radius, 0);
      }
      hub.rotation.y = t * 0.4;
    },
  };
}

/** Offset layered slabs, one per label — a compute/infra "stack". */
function buildStack(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const { labels } = series(slide, ["Edge", "Core", "Storage"]);
  if (!labels.length) return empty();
  const g = new THREE.Group();
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const n = labels.length;
  const gap = Math.min(0.46, 2.4 / n);
  const top = ((n - 1) * gap) / 2;

  labels.forEach((text, i) => {
    const y = top - i * gap;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, gap * 0.55, 1.2),
      diagramMaterial(P, i === 0 ? "accent" : "second", cfg),
    );
    // A small lateral offset per layer reads as depth rather than one block.
    slab.position.set(((i % 2 === 0 ? 1 : -1) * gap) / 3, y, 0);
    slab.castShadow = true;
    g.add(slab);
    addPart(g, parts, `n${i}`, text, slab, new THREE.Vector3(slab.position.x + 1.5, y, 0.62), P, cfg);
  });

  return { g, ...parts, tick: (t) => { g.rotation.y = -0.35 + Math.sin(t * 0.25) * 0.2; } };
}

/** Abstract network ("brain") — 14 nodes, proximity edges, travelling pulses. */
function buildBrain(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const g = new THREE.Group();
  const matA = diagramMaterial(P, "accent", cfg);
  const matB = diagramMaterial(P, "second", cfg);
  const rnd = makeRng(3);
  const nodes: Array<{ mesh: THREE.Mesh; base: THREE.Vector3; ph: number }> = [];
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 14; i++) {
    const v = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(0.9 + rnd() * 0.5);
    v.x *= 1.3;
    pts.push(v);
  }
  pts.forEach((p, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(i < 3 ? 0.22 : 0.12, 32, 32), i < 3 ? matA : matB);
    s.position.copy(p);
    s.castShadow = true;
    g.add(s);
    nodes.push({ mesh: s, base: p.clone(), ph: rnd() * 6 });
  });
  const eGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 8);
  const edges: Array<{ mesh: THREE.Mesh; a: number; b: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[i].distanceTo(pts[j]) < 1.1) {
        const e = new THREE.Mesh(eGeo, matB);
        g.add(e);
        edges.push({ mesh: e, a: i, b: j });
      }
    }
  }
  const pulses = edges.slice(0, 10).map((e, k) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), new THREE.MeshBasicMaterial({ color: P.accent }));
    g.add(m);
    return { m, e, off: k / 10 };
  });
  // Captioned cells are pinned to an even ring inside the cloud so their
  // captions never land on top of each other.
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const captioned = series(slide, []).labels.slice(0, nodes.length);
  captioned.forEach((text, i) => {
    const at = ringPoint(i, captioned.length, 1.05, 0.95);
    nodes[i].base.copy(at);
    nodes[i].mesh.position.copy(at);
    addPart(g, parts, `n${i}`, text, nodes[i].mesh, at.clone().multiplyScalar(1.3), P, cfg);
  });
  return {
    g,
    ...parts,
    tick(t) {
      nodes.forEach((n) => n.mesh.position.copy(n.base).addScaledVector(n.base, Math.sin(t * 1.3 + n.ph) * 0.06));
      captioned.forEach((_, i) => {
        parts.labels[i].object.position.copy(nodes[i].mesh.position).multiplyScalar(1.3);
      });

      edges.forEach((e) => {
        const a = nodes[e.a].mesh.position;
        const b = nodes[e.b].mesh.position;
        e.mesh.position.lerpVectors(a, b, 0.5);
        e.mesh.scale.y = a.distanceTo(b);
        e.mesh.quaternion.setFromUnitVectors(UP, DIR.subVectors(b, a).normalize());
      });
      pulses.forEach((p) => {
        const k = (t * 0.4 + p.off) % 1;
        p.m.position.lerpVectors(nodes[p.e.a].mesh.position, nodes[p.e.b].mesh.position, k);
      });
      g.rotation.y = t * 0.25;
    },
  };
}

/** Ring of three or more stations with travelling pulses. */
function buildLoop(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig, font: Font): DiagramBuild {
  const g = new THREE.Group();
  const matA = diagramMaterial(P, "accent", cfg);
  const matB = diagramMaterial(P, "second", cfg);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.09, 24, 128), matB);
  ring.castShadow = true;
  g.add(ring);
  const labels = series(slide, ["Plan", "Act", "Observe"]).labels;
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const nodes: THREE.Group[] = [];
  labels.forEach((l, i) => {
    const a = Math.PI / 2 - (i * Math.PI * 2) / labels.length;
    const n = new THREE.Group();
    const at = new THREE.Vector3(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0);
    n.position.copy(at);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 32), matA);
    s.castShadow = true;
    n.add(s);
    const tx = buildTitle(font, l, 0.16, 0.04, new THREE.MeshStandardMaterial({ color: P.text, metalness: 0.3, roughness: 0.4 }));
    const bb = new THREE.Box3().setFromObject(tx.group);
    tx.group.position.set(-(bb.max.x - bb.min.x) / 2, 0.42, 0);
    n.add(tx.group);
    g.add(n);
    nodes.push(n);
    addPart(g, parts, `n${i}`, l, s, at.clone().multiplyScalar(1.42), P, cfg);
  });
  const cone = new THREE.ConeGeometry(0.14, 0.32, 16);
  const arrows = labels.map((_, i) => {
    const m = new THREE.Mesh(cone, matA);
    g.add(m);
    return { m, off: i / labels.length };
  });
  return {
    g,
    ...parts,
    tick(t) {
      arrows.forEach((ar) => {
        const a = -Math.PI / 2 + (t * 0.5 + ar.off) * Math.PI * 2 + Math.PI / 3;
        ar.m.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0);
        ar.m.rotation.z = a + Math.PI / 2 + Math.PI;
      });
      nodes.forEach((n, i) => n.scale.setScalar(1 + Math.sin(t * 2 + i * 2.1) * 0.06));
      g.rotation.y = Math.sin(t * 0.3) * 0.35;
    },
  };
}

/** Hub with orbiting agents — octahedra with proximity lines. */
function buildSwarm(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const g = new THREE.Group();
  const matA = diagramMaterial(P, "accent", cfg);
  const matB = diagramMaterial(P, "second", cfg);
  const rnd = makeRng(11);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.32, 32, 32), matA);
  hub.castShadow = true;
  g.add(hub);
  const agents: Array<{ m: THREE.Mesh; r: number; sp: number; ph: number; tilt: number }> = [];
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(i % 5 === 0 ? 0.2 : 0.11, 1), i % 5 === 0 ? matA : matB);
    m.castShadow = true;
    g.add(m);
    agents.push({ m, r: 0.5 + rnd() * 1.1, sp: 0.3 + rnd() * 0.6, ph: rnd() * 6, tilt: rnd() * Math.PI });
  }
  const lineGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(agents.length * agents.length * 6);
  lineGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: P.second, transparent: true, opacity: 0.35 })));
  // Captioned agents become fixed stations on an even ring around the hub; the
  // rest keep orbiting. Captions on moving agents cross and occlude each other.
  const parts: BuiltParts = { nodes: {}, labels: [] };
  const captioned = series(slide, []).labels.slice(0, agents.length);
  const pinned = new Set<number>();
  captioned.forEach((text, i) => {
    const at = ringPoint(i, captioned.length, 1.1, 0.95);
    agents[i].m.position.copy(at);
    pinned.add(i);
    addPart(g, parts, `n${i}`, text, agents[i].m, at.clone().add(new THREE.Vector3(0, 0.3, 0)), P, cfg);
  });
  return {
    g,
    ...parts,
    tick(t) {
      agents.forEach((a, i) => {
        if (pinned.has(i)) {
          a.m.rotation.set(t * 0.5, t * 0.35, 0);
          return;
        }
        const th = t * a.sp + a.ph;
        a.m.position.set(Math.cos(th) * a.r, Math.sin(th * 1.3 + a.tilt) * a.r * 0.5, Math.sin(th) * a.r);
        a.m.rotation.set(t, t * 0.7, 0);
      });
      let k = 0;
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          const pa = agents[i].m.position;
          const pb = agents[j].m.position;
          if (pa.distanceTo(pb) < 0.75) {
            pos.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], k);
            k += 6;
          }
        }
      }
      lineGeo.setDrawRange(0, k / 3);
      lineGeo.attributes.position.needsUpdate = true;
    },
  };
}

interface FlowLayout {
  sc: number;
  scale: number;
  toW: (x: number, y: number) => THREE.Vector3;
  horiz: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function computeLayout(nodes: MergedNode[], slide: MergedSlide): FlowLayout {
  const minX = Math.min(...nodes.map((n) => n.x - n.w / 2));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w / 2));
  const minY = Math.min(...nodes.map((n) => n.y - n.h / 2));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h / 2));
  const sc = Math.min(4.4 / Math.max(0.001, maxX - minX), 2.9 / Math.max(0.001, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = slide.diagram.scale ?? 1;
  const off = slide.diagram.offset ?? {};
  const horiz = slide.diagram.dir === "LR" || slide.diagram.dir === "RL";
  const rank = (x: number, y: number) => (horiz ? (x - minX) / (maxX - minX || 1) : (y - minY) / (maxY - minY || 1));
  const toW = (x: number, y: number) =>
    new THREE.Vector3((x - cx) * sc * scale + (off.x ?? 0), -(y - cy) * sc * scale + (off.y ?? 0), (rank(x, y) - 0.5) * 0.7);
  return { sc, scale, toW, horiz, minX, maxX, minY, maxY };
}

function meshForNode(n: MergedNode, degree: Record<string, number>, layout: FlowLayout, P: PaletteColors, cfg: SlideConfig): THREE.Mesh {
  const w = (n.size?.w ?? n.w) * layout.sc * layout.scale;
  const h = (n.size?.h ?? n.h) * layout.sc * layout.scale;
  const hub = (degree[n.id] ?? 0) >= 3 || n.shape === "diamond" || n.shape === "hexagon";
  const cfgN = n.material ? { ...cfg, material: n.material } : cfg;
  const m = new THREE.Mesh(nodeGeometry(n.shape, w, h), diagramMaterial(P, hub ? "accent" : "second", cfgN));
  const pos = layout.toW(n.x, n.y);
  if (n.position) pos.add(new THREE.Vector3(n.position.x ?? 0, n.position.y ?? 0, n.position.z ?? 0));
  m.position.copy(pos);
  m.castShadow = true;
  m.userData.label = n.label;
  m.userData.ownerId = n.id;
  return m;
}

function placeFlowNodes(
  nodes: MergedNode[],
  layout: FlowLayout,
  edges: NonNullable<MergedSlide["diagram"]["edges"]>,
  P: PaletteColors,
  cfg: SlideConfig,
  g: THREE.Group,
): { meshes: Record<string, THREE.Mesh>; labels: BuiltLabel[] } {
  const degree: Record<string, number> = {};
  for (const e of edges) {
    degree[e.from] = (degree[e.from] ?? 0) + 1;
    degree[e.to] = (degree[e.to] ?? 0) + 1;
  }
  const meshes: Record<string, THREE.Mesh> = {};
  const labels: BuiltLabel[] = [];
  for (const n of nodes) {
    const m = meshForNode(n, degree, layout, P, cfg);
    g.add(m);
    meshes[n.id] = m;
    const h = (n.size?.h ?? n.h) * layout.sc * layout.scale;
    const round = n.shape === "circle" || n.shape === "doublecircle" || n.shape === "round" || n.shape === "stadium";
    const lb = buildLabel(n.label, cfg.labels?.size ?? Math.min(0.13, h * 0.45), P);
    lb.group.position.set(m.position.x, m.position.y, m.position.z + (round ? h / 2 : 0.09) + 0.01);
    lb.group.userData.ownerId = n.id;
    g.add(lb.group);
    labels.push({ id: n.id, text: n.label, object: lb.group, height: lb.height });
  }
  return { meshes, labels };
}

function buildFlowEdges(
  edges: NonNullable<MergedSlide["diagram"]["edges"]>,
  layout: FlowLayout,
  P: PaletteColors,
  cfg: SlideConfig,
  g: THREE.Group,
): Array<{ m: THREE.Mesh; curve: THREE.CatmullRomCurve3; off: number }> {
  const matA = diagramMaterial(P, "accent", cfg);
  const matB = diagramMaterial(P, "second", cfg);
  const rnd = makeRng(31);
  const pulses: Array<{ m: THREE.Mesh; curve: THREE.CatmullRomCurve3; off: number }> = [];
  for (const e of edges) {
    if (e.path.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(e.path.map(([x, y]) => layout.toW(x, y)));
    const thick = e.kind === "thick";
    const r = thick ? 0.04 : 0.024;
    const mat =
      e.kind === "dotted"
        ? new THREE.MeshStandardMaterial({ color: P.second, transparent: true, opacity: 0.45, metalness: 0.6, roughness: 0.3 })
        : thick
          ? matA
          : matB;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, r, 10, false), mat);
    tube.castShadow = true;
    g.add(tube);
    const end = curve.getPoint(1);
    const pre = curve.getPoint(0.94);
    const tn = end.clone().sub(pre).normalize();
    const head = arrowHead(thick ? matA : matB, r);
    head.position.copy(end).addScaledVector(tn, -r * 4.5);
    head.lookAt(end.clone().add(tn));
    g.add(head);
    if (e.label) {
      const lb = buildLabel(e.label, cfg.labels?.size ?? 0.09, P);
      lb.group.position.copy(curve.getPoint(0.5)).add(new THREE.Vector3(0, 0.14, 0.05));
      lb.group.userData.ownerId = e.id;
      g.add(lb.group);
    }
    const pm = new THREE.Mesh(new THREE.SphereGeometry(r * 2.2, 12, 12), new THREE.MeshBasicMaterial({ color: P.accent }));
    g.add(pm);
    pulses.push({ m: pm, curve, off: rnd() });
  }
  return pulses;
}

function buildGroupPlates(
  groups: NonNullable<MergedSlide["diagram"]["groups"]>,
  meshes: Record<string, THREE.Mesh>,
  P: PaletteColors,
  cfg: SlideConfig,
  g: THREE.Group,
): void {
  for (const sg of groups) {
    const mem = sg.nodes.map((id) => meshes[id]).filter(Boolean);
    if (!mem.length) continue;
    const bb = new THREE.Box3();
    mem.forEach((m) => bb.expandByObject(m));
    bb.expandByScalar(0.22);
    const sz = bb.getSize(new THREE.Vector3());
    const c = bb.getCenter(new THREE.Vector3());
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(sz.x, sz.y, 0.05),
      new THREE.MeshPhysicalMaterial({
        color: P.card,
        transmission: cfg.material === "glass" ? 0.6 : 0,
        transparent: true,
        opacity: 0.75,
        roughness: 0.3,
        envMapIntensity: cfg.envReflections !== false ? 0.8 : 0,
      }),
    );
    plate.position.set(c.x, c.y, bb.min.z - 0.08);
    g.add(plate);
    const lb = buildLabel(sg.title, cfg.labels?.size ?? 0.09, P);
    lb.group.position.set(c.x, bb.max.y + 0.02, bb.min.z - 0.05);
    g.add(lb.group);
  }
}

/** Harvested flowchart → 3D staircase with tubes, arrow-heads and group plates. */
function buildFlowchart(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const ir = slide.diagram;
  const g = new THREE.Group();
  const nodes = ir.nodes ?? [];
  if (!nodes.length) return empty();
  const layout = computeLayout(nodes, slide);
  const edges = ir.edges ?? [];
  const { meshes, labels } = placeFlowNodes(nodes, layout, edges, P, cfg, g);
  const pulses = buildFlowEdges(edges, layout, P, cfg, g);
  buildGroupPlates(ir.groups ?? [], meshes, P, cfg, g);
  return {
    g,
    nodes: meshes,
    labels,
    tick(t) {
      pulses.forEach((p) => p.m.position.copy(p.curve.getPoint((t * 0.35 + p.off) % 1)));
      g.rotation.y = Math.sin(t * 0.25) * 0.28;
    },
  };
}

/** Harvested sequence → actor slabs, time staircase, messages lighting in order. */
function buildSequence(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig): DiagramBuild {
  const ir = slide.diagram;
  const g = new THREE.Group();
  const matB = diagramMaterial(P, "second", cfg);
  const actors = ir.actors ?? [];
  const messages = ir.messages ?? [];
  const n = actors.length;
  const m = messages.length;
  const X: Record<string, number> = {};
  const labels: BuiltLabel[] = [];
  actors.forEach((a, i) => {
    X[a.id] = (i - (n - 1) / 2) * (3.8 / Math.max(1, n - 1 || 1));
  });
  const yz = (k: number): [number, number] => [0.9 - k * (2.0 / Math.max(1, m - 1 || 1)), 0.7 - k * (2.0 / Math.max(1, m - 1 || 1))];
  actors.forEach((a) => {
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.38, 0.14), matB);
    head.position.set(X[a.id], 1.4, 0.9);
    head.castShadow = true;
    g.add(head);
    const lb = buildLabel(a.label, cfg.labels?.size ?? 0.13, P);
    lb.group.position.set(X[a.id], 1.4, 0.98);
    lb.group.userData.ownerId = a.id;
    g.add(lb.group);
    labels.push({ id: a.id, text: a.label, object: lb.group, height: lb.height });
    const [y0, z0] = yz(-0.5);
    const [y1, z1] = yz(m - 0.5);
    const life = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.LineCurve3(new THREE.Vector3(X[a.id], y0 + 0.2, z0 + 0.2), new THREE.Vector3(X[a.id], y1, z1)),
        1,
        0.015,
        8,
        false,
      ),
      new THREE.MeshStandardMaterial({ color: P.second, transparent: true, opacity: 0.5 }),
    );
    g.add(life);
  });
  const msgs = messages.map((msg, k) => {
    const [y, z] = yz(k);
    // A self-message has no horizontal span; give it a short stub so the tube
    // is not zero-length (degenerate geometry would poison measurement/raycast).
    const same = msg.from === msg.to;
    const a = new THREE.Vector3(X[msg.from] ?? 0, y, z);
    const b = new THREE.Vector3((X[msg.to] ?? 0) + (same ? 0.35 : 0), y, z);
    const dir = b.clone().sub(a).normalize();
    const dotted = msg.kind === "dotted";
    const mat = new THREE.MeshStandardMaterial({
      color: dotted ? P.second : P.accent,
      metalness: 0.7,
      roughness: 0.3,
      transparent: dotted,
      opacity: dotted ? 0.55 : 1,
      emissive: P.accent,
      emissiveIntensity: 0,
    });
    const mg = new THREE.Group();
    mg.userData.ownerId = msg.id;
    g.add(mg);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b.clone().addScaledVector(dir, -0.14)), 1, 0.03, 10, false), mat);
    tube.castShadow = true;
    mg.add(tube);
    const head = arrowHead(mat, 0.03);
    head.position.copy(b).addScaledVector(dir, -0.11);
    head.lookAt(b);
    mg.add(head);
    const lb = buildLabel(msg.text, cfg.labels?.size ?? 0.105, P);
    lb.group.position.copy(a).lerp(b, 0.5).add(new THREE.Vector3(0, 0.15, 0.02));
    lb.group.userData.ownerId = msg.id;
    mg.add(lb.group);
    labels.push({ id: msg.id, text: msg.text, object: lb.group, height: lb.height });
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: P.accent }));
    pulse.visible = false;
    mg.add(pulse);
    return { mat, mg, pulse, a, b };
  });
  const period = 1.1;
  let active: string | null = null;
  return {
    g,
    labels,
    lifted: () => active,
    tick(t) {
      const act = Math.floor(t / period) % Math.max(1, m);
      active = messages[act]?.id ?? null;
      const ph = (t / period) % 1;
      msgs.forEach((x, k) => {
        const on = k === act;
        x.mat.emissiveIntensity += ((on ? 0.7 : 0) - x.mat.emissiveIntensity) * 0.15;
        x.mg.position.z += ((on ? 0.12 : 0) - x.mg.position.z) * 0.15;
        x.pulse.visible = on;
        if (on) x.pulse.position.lerpVectors(x.a, x.b, ph);
      });
      g.rotation.y = -0.22 + Math.sin(t * 0.25) * 0.1;
    },
  };
}

export function buildDiagram(slide: MergedSlide, P: PaletteColors, cfg: SlideConfig, font: Font): DiagramBuild {
  const kind = slide.diagram.kind;
  switch (kind) {
    case "flowchart":
      return buildFlowchart(slide, P, cfg);
    case "sequence":
      return buildSequence(slide, P, cfg);
    case "brain":
      return buildBrain(slide, P, cfg);
    case "loop":
      return buildLoop(slide, P, cfg, font);
    case "swarm":
      return buildSwarm(slide, P, cfg);
    case "bars":
      return buildBars(slide, P, cfg);
    case "funnel":
      return buildFunnel(slide, P, cfg);
    case "timeline-rail":
      return buildTimelineRail(slide, P, cfg);
    case "globe":
      return buildGlobe(slide, P, cfg);
    case "orbit-cluster":
      return buildOrbitCluster(slide, P, cfg);
    case "stack":
      return buildStack(slide, P, cfg);
    default:
      return empty();
  }
}
