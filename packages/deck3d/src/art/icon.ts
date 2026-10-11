/**
 * `art icon` (spec deck3d-art-tooling): an SVG parsed as DATA — no browser,
 * no script, no entity expansion — flattened into polylines in viewBox space.
 * Paths (`M L H V C S Q T A Z`, absolute and relative), lines, polylines,
 * polygons, rects, circles and ellipses; group and element transforms
 * composed. External references are ignored with a warning.
 */
import { hasDoctype } from "../pptx/zip.js";
import { parseXml, type XNode } from "../pptx/xml.js";

export const ICON_LIMITS = { maxBytes: 2 * 1024 * 1024, maxElements: 50_000, maxPoints: 500_000 };

export type P2 = [number, number];

export interface IconPolyline {
  points: P2[];
  width: number;
  closed: boolean;
}

export interface IconOutput {
  version: 1;
  viewBox: [number, number, number, number];
  polylines: IconPolyline[];
}

export class IconLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IconLimitError";
  }
}

/** Affine 2×3 matrix `[a, b, c, d, e, f]` (SVG order). */
type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, [x, y]: P2): P2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function parseTransform(src: string | undefined): M {
  let m: M = I;
  if (!src) return m;
  for (const [, fn, args] of src.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/-?[\d.]+(?:e-?\d+)?/gi) ?? []).map(Number);
    let t: M = I;
    if (fn === "matrix" && a.length === 6) t = a as M;
    else if (fn === "translate") t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const rot: M = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      t = a.length >= 3 ? mul(mul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot;
    } else if (fn === "skewX") t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

/** Flatness: max deviation of a flattened curve from the true curve, in user units. */
const TOL = 0.1;

function cubic(p0: P2, p1: P2, p2: P2, p3: P2, out: P2[]): void {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(4, Math.ceil(Math.sqrt(len / TOL)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

function quad(p0: P2, p1: P2, p2: P2, out: P2[]): void {
  cubic(p0, [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1] + (2 / 3) * (p1[1] - p0[1])], [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1] + (2 / 3) * (p1[1] - p2[1])], p2, out);
}

/** SVG elliptical arc (spec F.6.5 endpoint → centre parameterisation), sampled on the ellipse. */
export function arc(p0: P2, rxIn: number, ryIn: number, phiDeg: number, large: boolean, sweep: boolean, p1: P2, out: P2[]): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) {
    out.push(p1);
    return;
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const r = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(-1, 1 - TOL / r));
  const n = Math.max(2, Math.ceil(Math.abs(dt) / step));
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push(i === n ? p1 : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
}

/** Flatten SVG path data into subpaths (`closed` per subpath). */
export function flattenPath(d: string): Array<{ points: P2[]; closed: boolean }> {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const subs: Array<{ points: P2[]; closed: boolean }> = [];
  let cur: P2[] = [];
  let pos: P2 = [0, 0];
  let start: P2 = [0, 0];
  let lastCtrl: P2 | undefined;
  let lastCmd = "";
  let i = 0;
  let cmd = "";
  const n = () => Number(tokens[i++]);
  const flush = (closed: boolean) => {
    if (cur.length > 1) subs.push({ points: cur, closed });
    cur = [];
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const at = (x: number, y: number): P2 => (rel ? [pos[0] + x, pos[1] + y] : [x, y]);
    switch (C) {
      case "M": {
        flush(false);
        pos = at(n(), n());
        start = pos;
        cur = [pos];
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        pos = at(n(), n());
        cur.push(pos);
        break;
      case "H": {
        const x = n();
        pos = [rel ? pos[0] + x : x, pos[1]];
        cur.push(pos);
        break;
      }
      case "V": {
        const y = n();
        pos = [pos[0], rel ? pos[1] + y : y];
        cur.push(pos);
        break;
      }
      case "C": {
        const c1 = at(n(), n());
        const c2 = at(n(), n());
        const p = at(n(), n());
        cubic(pos, c1, c2, p, cur);
        lastCtrl = c2;
        pos = p;
        break;
      }
      case "S": {
        const c1: P2 = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
        const c2 = at(n(), n());
        const p = at(n(), n());
        cubic(pos, c1, c2, p, cur);
        lastCtrl = c2;
        pos = p;
        break;
      }
      case "Q": {
        const c = at(n(), n());
        const p = at(n(), n());
        quad(pos, c, p, cur);
        lastCtrl = c;
        pos = p;
        break;
      }
      case "T": {
        const c: P2 = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
        const p = at(n(), n());
        quad(pos, c, p, cur);
        lastCtrl = c;
        pos = p;
        break;
      }
      case "A": {
        const rx = n();
        const ry = n();
        const phi = n();
        const large = n() !== 0;
        const sweep = n() !== 0;
        const p = at(n(), n());
        arc(pos, rx, ry, phi, large, sweep, p, cur);
        pos = p;
        break;
      }
      case "Z":
        pos = start;
        flush(true);
        cur = [pos];
        break;
      default:
        i++;
    }
    lastCmd = C;
    if (!/[CSQT]/.test(C)) lastCtrl = undefined;
  }
  flush(false);
  return subs;
}

function attrNum(n: XNode, name: string, d = 0): number {
  const v = Number.parseFloat(n.attrs[name] ?? "");
  return Number.isFinite(v) ? v : d;
}

/** Presentation attribute or `style` declaration. */
function styleProp(n: XNode, name: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(n.attrs.style ?? "");
  return m?.[1].trim() ?? n.attrs[name];
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): P2[] {
  const n = Math.max(12, Math.ceil((2 * Math.PI) / (2 * Math.acos(Math.max(-1, 1 - TOL / Math.max(rx, ry, 1e-6))))));
  return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)] as P2);
}

export function svgToPolylines(bytes: Uint8Array, name = "input.svg"): { icon: IconOutput; warnings: string[] } {
  if (bytes.length > ICON_LIMITS.maxBytes) throw new IconLimitError(`${name}: ${bytes.length} bytes exceeds the ${ICON_LIMITS.maxBytes / 1024 / 1024} MB limit`);
  if (hasDoctype(bytes)) throw new IconLimitError(`${name}: contains <!DOCTYPE (DTDs and entities are rejected)`);
  const text = new TextDecoder().decode(bytes);
  const elements = (text.match(/<[A-Za-z]/g) ?? []).length;
  if (elements > ICON_LIMITS.maxElements) throw new IconLimitError(`${name}: ${elements} elements exceeds the ${ICON_LIMITS.maxElements} element limit`);
  const root = parseXml(text);
  const warnings: string[] = [];
  const vb = (root.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
  const viewBox: [number, number, number, number] =
    vb.length === 4 && vb.every(Number.isFinite) ? (vb as [number, number, number, number]) : [0, 0, attrNum(root, "width", 24), attrNum(root, "height", 24)];
  const polylines: IconPolyline[] = [];
  let points = 0;
  const emit = (pts: P2[], closed: boolean, m: M, width: number) => {
    points += pts.length;
    if (points > ICON_LIMITS.maxPoints) throw new IconLimitError(`${name}: flattens to more than ${ICON_LIMITS.maxPoints} points (limit)`);
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    polylines.push({ points: pts.map((p) => apply(m, p).map((v) => Math.round(v * 1000) / 1000) as P2), width: Math.round(width * scale * 1000) / 1000, closed });
  };
  const walk = (n: XNode, parent: M, inheritedWidth: number) => {
    const local = n.name.replace(/^svg:/, "");
    const m = mul(parent, parseTransform(n.attrs.transform));
    const sw = Number.parseFloat(styleProp(n, "stroke-width") ?? "");
    const width = Number.isFinite(sw) ? sw : inheritedWidth;
    const href = n.attrs.href ?? n.attrs["xlink:href"];
    if (href !== undefined && (local === "image" || local === "use" || local === "feImage")) {
      warnings.push(`warning ${name}: <${local}> reference '${href}' ignored`);
      return;
    }
    switch (local) {
      case "path":
        for (const s of flattenPath(n.attrs.d ?? "")) emit(s.points, s.closed, m, width);
        break;
      case "line":
        emit([[attrNum(n, "x1"), attrNum(n, "y1")], [attrNum(n, "x2"), attrNum(n, "y2")]], false, m, width);
        break;
      case "polyline":
      case "polygon": {
        const nums = (n.attrs.points ?? "").match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
        const pts: P2[] = [];
        for (let k = 0; k + 1 < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
        if (pts.length > 1) emit(pts, local === "polygon", m, width);
        break;
      }
      case "rect": {
        const x = attrNum(n, "x");
        const y = attrNum(n, "y");
        const w = attrNum(n, "width");
        const h = attrNum(n, "height");
        const rx = Math.min(w / 2, attrNum(n, "rx", attrNum(n, "ry")));
        const ry = Math.min(h / 2, attrNum(n, "ry", rx));
        if (rx > 0 && ry > 0) {
          const d = `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
          for (const s of flattenPath(d)) emit(s.points, true, m, width);
        } else
          emit(
            [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ],
            true,
            m,
            width,
          );
        break;
      }
      case "circle":
        emit(ellipsePoints(attrNum(n, "cx"), attrNum(n, "cy"), attrNum(n, "r"), attrNum(n, "r")), true, m, width);
        break;
      case "ellipse":
        emit(ellipsePoints(attrNum(n, "cx"), attrNum(n, "cy"), attrNum(n, "rx"), attrNum(n, "ry")), true, m, width);
        break;
      case "defs":
      case "clipPath":
      case "mask":
      case "style":
      case "script":
      case "metadata":
      case "title":
      case "desc":
        return;
      default:
        break;
    }
    for (const c of n.children) walk(c, m, width);
  };
  walk(root, I, 1);
  return { icon: { version: 1, viewBox, polylines }, warnings };
}
