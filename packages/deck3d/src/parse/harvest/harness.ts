/**
 * Browser-side harvest harness. Bundled by esbuild into an IIFE and injected
 * into a blank Playwright page. Semantics come from mermaid's diagram model
 * (`db`); layout geometry comes from mermaid's own rendered SVG.
 *
 * This module never runs in Node — it is only ever bundled (see `bundle.ts`).
 */
import mermaid from "mermaid";
import { mapEdgeKind, mapMessageKind, mapNodeShape } from "./shapes.js";

/** Raw harvest payload returned to Node, before edge/message ids are assigned. */
export interface RawHarvest {
  kind: "flowchart" | "sequence" | "none";
  /** Set when `kind` is `none` because the diagram type is unsupported. */
  unsupported?: string;
  dir?: string;
  nodes?: RawNode[];
  edges?: RawEdge[];
  groups?: Array<{ id: string; title: string; nodes: string[] }>;
  actors?: Array<{ id: string; label: string }>;
  messages?: Array<{ from: string; to: string; text: string; kind: "solid" | "dotted" }>;
}

interface RawNode {
  id: string;
  label: string;
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  group?: string;
}

interface RawEdge {
  from: string;
  to: string;
  kind: string;
  label?: string;
  path: Array<[number, number]>;
}

interface RawGroup {
  id: string;
  title: string;
  nodes: string[];
}

declare global {
  interface Window {
    __deck3dHarvest: (source: string, renderId: string) => Promise<RawHarvest>;
    __DECK3D_STALL?: boolean;
  }
}

type AnyRecord = Record<string, unknown>;

function mapVals(value: unknown): AnyRecord[] {
  if (value instanceof Map) return [...(value as Map<unknown, AnyRecord>).values()];
  if (value && typeof value === "object") return Object.values(value as Record<string, AnyRecord>);
  return [];
}

function call(db: AnyRecord, name: string): unknown {
  const fn = db[name];
  return typeof fn === "function" ? (fn as (...args: unknown[]) => unknown).call(db) : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function readSequence(db: AnyRecord): RawHarvest {
  const actors = mapVals(call(db, "getActors")).map((a) => ({
    id: String(a.name ?? a.id ?? ""),
    label: String(a.description ?? a.name ?? a.id ?? ""),
  }));
  const messages = mapVals(call(db, "getMessages"))
    .map((m) => ({
      from: String(m.from ?? ""),
      to: String(m.to ?? ""),
      text: String(m.message ?? ""),
      kind: mapMessageKind(typeof m.type === "number" ? m.type : undefined),
    }))
    .filter((m): m is { from: string; to: string; text: string; kind: "solid" | "dotted" } =>
      Boolean(m.from && m.to && m.kind),
    );
  return { kind: "sequence", actors, messages };
}

function readGroups(db: AnyRecord, groupByNode: Map<string, string>): RawGroup[] {
  return mapVals(call(db, "getSubGraphs")).map((sg) => {
    const nodes = Array.isArray(sg.nodes) ? (sg.nodes as unknown[]).map(String) : [];
    const title = String(sg.title ?? sg.id ?? "");
    for (const n of nodes) groupByNode.set(n, title);
    return { id: String(sg.id ?? title), title, nodes };
  });
}

function readNodes(db: AnyRecord, gnodes: Element[], groupByNode: Map<string, string>): RawNode[] {
  const nodes: RawNode[] = [];
  for (const v of mapVals(call(db, "getVertices"))) {
    const id = String(v.id ?? "");
    const el = gnodes.find((n) => n.id.includes(`flowchart-${id}-`));
    if (!el) continue;
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(el.getAttribute("transform") ?? "");
    const box = (el as SVGGraphicsElement).getBBox();
    const node: RawNode = {
      id,
      label: String(v.text ?? id),
      shape: mapNodeShape(typeof v.type === "string" ? v.type : undefined),
      x: round2(m ? Number(m[1]) : 0),
      y: round2(m ? Number(m[2]) : 0),
      w: round2(box.width),
      h: round2(box.height),
    };
    const group = groupByNode.get(id);
    if (group) node.group = group;
    nodes.push(node);
  }
  return nodes;
}

function samplePath(p: Element | undefined): Array<[number, number]> {
  if (!p) return [];
  const path = p as SVGPathElement;
  const length = path.getTotalLength();
  const points: Array<[number, number]> = [];
  for (let s = 0; s <= 16; s++) {
    const q = path.getPointAtLength((length * s) / 16);
    points.push([round2(q.x), round2(q.y)]);
  }
  return points;
}

function readEdges(db: AnyRecord, paths: Element[]): RawEdge[] {
  const rawEdges = mapVals(call(db, "getEdges"));
  const seen: Record<string, number> = {};
  return rawEdges.map((e, i) => {
    const from = String(e.start ?? "");
    const to = String(e.end ?? "");
    const key = `L_${from}_${to}_`;
    const k = (seen[key] = (seen[key] ?? -1) + 1);
    const p = paths.find((x) => x.id.endsWith(key + k)) ?? paths[i];
    const label = String(e.text ?? "").trim();
    const edge: RawEdge = {
      from,
      to,
      kind: mapEdgeKind(typeof e.stroke === "string" ? e.stroke : undefined),
      path: samplePath(p),
    };
    if (label) edge.label = label;
    return edge;
  });
}

async function harvestFlowchart(db: AnyRecord, source: string, renderId: string): Promise<RawHarvest> {
  const { svg } = await mermaid.render(renderId, source);
  const host = document.getElementById("mmhost") as HTMLElement;
  host.innerHTML = svg;
  const root = host.querySelector("svg") as SVGSVGElement;
  const groupByNode = new Map<string, string>();
  const groups = readGroups(db, groupByNode);
  const nodes = readNodes(db, [...root.querySelectorAll("g.node")], groupByNode);
  const edges = readEdges(db, [...root.querySelectorAll("path.flowchart-link")]);
  const dir = String(call(db, "getDirection") ?? "TB");
  return { kind: "flowchart", dir, nodes, edges, groups };
}

async function harvest(source: string, renderId: string): Promise<RawHarvest> {
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    fontFamily: "Poppins, sans-serif",
    flowchart: { htmlLabels: false, curve: "basis" },
  });
  const diagram = (await mermaid.mermaidAPI.getDiagramFromText(source)) as unknown as { type?: string; db: AnyRecord };
  const db = diagram.db;
  const type = String(diagram.type ?? "");
  if (type === "sequence") return readSequence(db);
  if (type !== "flowchart" && type !== "flowchart-v2" && type !== "graph") {
    return { kind: "none", unsupported: type || "unknown" };
  }
  return harvestFlowchart(db, source, renderId);
}

window.__deck3dHarvest = (source: string, renderId: string): Promise<RawHarvest> => {
  if (window.__DECK3D_STALL) return new Promise<RawHarvest>(() => {});
  return harvest(source, renderId);
};
