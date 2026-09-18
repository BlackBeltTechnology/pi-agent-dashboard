/**
 * `check` rules — pure functions over `__deck3d.measure()` output (design D8).
 *
 * Geometric rules (fit/legibility/overlap/occlusion) are exact for a given IR +
 * viewport; contrast needs rendered pixels and is warn-only (GPU-dependent), so
 * it is excluded from the report byte-equality guarantee.
 */
export type Severity = "error" | "warn";
export type RuleName = "fit" | "legibility" | "overlap" | "occlusion" | "contrast";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Measurement {
  kind: string;
  id: string;
  text: string;
  rect: Rect;
  capHeight: number;
  /** Owner id of the first raycast hit between camera and label centre. */
  hit?: string | null;
  /** Label fill colour (canvas labels only). */
  color?: string | null;
}

export interface SlideRef {
  id: string;
  index: number;
}

export interface Finding {
  severity: Severity;
  rule: RuleName;
  slide: string;
  slideIndex: number;
  id?: string;
  text?: string;
  /** Human-measured value, e.g. `1844px`. */
  measured: string;
  /** Human threshold, e.g. `1843px`. */
  threshold: string;
  /** One-line detail, e.g. `right 1844px > 1843px`. */
  detail: string;
  /** Suggested `overrides` key (must resolve in schema.json). */
  suggest: string;
}

const px = (n: number): string => `${Math.round(n)}px`;

function isText(m: Measurement): boolean {
  return (m.kind === "label" || m.kind === "title") && m.text.length > 0;
}

/** Overrides grammar key for a slide-level knob. */
export function slideKnob(slideId: string, knob: string): string {
  return `overrides.slides["${slideId}"].${knob}`;
}

export function nodeKnob(slideId: string, nodeId: string, knob: string): string {
  return `overrides.nodes["${slideId}/${nodeId}"].${knob}`;
}

/** Union of all content rects inside the safe area (default 4 % margin). */
export function fitFindings(measurements: Measurement[], viewport: { w: number; h: number }, slide: SlideRef, margin = 0.04): Finding[] {
  const usable = measurements.filter(
    (m) => m.rect.w > 0 && m.rect.h > 0 && Number.isFinite(m.rect.x) && Number.isFinite(m.rect.y) && Number.isFinite(m.rect.w) && Number.isFinite(m.rect.h),
  );
  if (!usable.length) return [];
  const left = viewport.w * margin;
  const right = viewport.w * (1 - margin);
  const top = viewport.h * margin;
  const bottom = viewport.h * (1 - margin);
  const minX = Math.min(...usable.map((m) => m.rect.x));
  const maxX = Math.max(...usable.map((m) => m.rect.x + m.rect.w));
  const minY = Math.min(...usable.map((m) => m.rect.y));
  const maxY = Math.max(...usable.map((m) => m.rect.y + m.rect.h));
  const out: Finding[] = [];
  const add = (detail: string, measured: number, threshold: number): void => {
    out.push({
      severity: "error",
      rule: "fit",
      slide: slide.id,
      slideIndex: slide.index,
      measured: px(measured),
      threshold: px(threshold),
      detail,
      suggest: slideKnob(slide.id, "diagram.scale"),
    });
  };
  if (minX < left) add(`left ${px(minX)} < ${px(left)}`, minX, left);
  if (maxX > right) add(`right ${px(maxX)} > ${px(right)}`, maxX, right);
  if (minY < top) add(`top ${px(minY)} < ${px(top)}`, minY, top);
  if (maxY > bottom) add(`bottom ${px(maxY)} > ${px(bottom)}`, maxY, bottom);
  return out;
}

/** Every label cap height ≥ `minPx` scaled by viewport height (14 px at 1080). */
export function legibilityFindings(measurements: Measurement[], viewportH: number, slide: SlideRef, minPx = 14): Finding[] {
  const threshold = (minPx * viewportH) / 1080;
  return measurements
    .filter((m) => isText(m) && m.capHeight < threshold)
    .map((m) => ({
      severity: "warn" as const,
      rule: "legibility" as const,
      slide: slide.id,
      slideIndex: slide.index,
      id: m.id,
      text: m.text,
      measured: `${m.capHeight.toFixed(2)}px`,
      threshold: `${threshold.toFixed(2)}px`,
      detail: `${m.capHeight.toFixed(2)}px < ${threshold.toFixed(2)}px`,
      suggest: slideKnob(slide.id, "labels.size"),
    }));
}

export function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/** No two label rects intersect with IoU strictly above `maxIou`. */
export function overlapFindings(measurements: Measurement[], slide: SlideRef, maxIou = 0.1): Finding[] {
  const labels = measurements.filter(isText);
  const out: Finding[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const value = iou(labels[i].rect, labels[j].rect);
      if (value <= maxIou + 1e-9) continue;
      out.push({
        severity: "error",
        rule: "overlap",
        slide: slide.id,
        slideIndex: slide.index,
        id: labels[i].id,
        text: `${labels[i].id} ∩ ${labels[j].id}`,
        measured: value.toFixed(3),
        threshold: maxIou.toFixed(1),
        detail: `overlap ${labels[i].id} ∩ ${labels[j].id} IoU ${value.toFixed(3)} > ${maxIou}`,
        suggest: nodeKnob(slide.id, labels[i].id, "position"),
      });
    }
  }
  return out;
}

/** No label may be occluded by an object other than itself or its own node. */
export function occlusionFindings(measurements: Measurement[], slide: SlideRef): Finding[] {
  return measurements
    .filter((m) => isText(m) && m.hit != null && m.hit !== m.id)
    .map((m) => ({
      severity: "error" as const,
      rule: "occlusion" as const,
      slide: slide.id,
      slideIndex: slide.index,
      id: m.id,
      text: m.text,
      measured: String(m.hit),
      threshold: m.id,
      detail: `label ${m.id} occluded by ${m.hit}`,
      suggest: slideKnob(slide.id, "camera.distance"),
    }));
}

function luminanceFromHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = Number.parseInt(m[1], 16);
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of label text vs the mean luminance of the pixels behind it. */
export function contrastFindings(
  measurements: Array<Measurement & { bgLuminance?: number }>,
  slide: SlideRef,
  min = 3,
): Finding[] {
  return measurements
    .filter((m): m is Measurement & { bgLuminance: number } => isText(m) && Boolean(m.color) && m.bgLuminance != null)
    .map((m) => ({ m, ratio: contrastRatio(luminanceFromHex(m.color as string), m.bgLuminance) }))
    .filter(({ ratio }) => ratio < min)
    .map(({ m, ratio }) => ({
      severity: "warn" as const,
      rule: "contrast" as const,
      slide: slide.id,
      slideIndex: slide.index,
      id: m.id,
      text: m.text,
      measured: ratio.toFixed(1),
      threshold: min.toFixed(1),
      detail: `contrast ${ratio.toFixed(1)}:1 < ${min}:1`,
      suggest: slideKnob(slide.id, "mode"),
    }));
}

export function formatFinding(f: Finding): string {
  return `${f.severity} ${f.rule} slide ${f.slideIndex} ${f.detail}`;
}
