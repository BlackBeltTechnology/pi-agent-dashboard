/**
 * Finding model shared by every scanner layer.
 *
 * A finding is keyed by its `layer` id (e.g. `unicode-tags`, `html-display-none`).
 * Repeated hits on the same id aggregate into one finding: `count` grows, the
 * `sample` stays the FIRST occurrence. Insertion order is preserved, so the
 * same input always yields the same finding list (design D1 determinism).
 */

export type Severity = "high" | "low";

export interface Finding {
  /** Finding id, e.g. `unicode-tags`, `ansi`, `html-display-none`, `unresolved_css`. */
  layer: string;
  severity: Severity;
  /** Number of spans / occurrences. */
  count: number;
  /** Visible-escaped sample of the first occurrence, at most 80 characters. */
  sample: string;
}

const SAMPLE_MAX = 80;

/**
 * Code points rendered as `U+XXXX` in a sample: C0/C1 controls, format chars
 * (zero-width, BIDI, tags, …), variation selectors, and line/paragraph separators.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;

function hex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Escape every invisible code point as `U+XXXX`; visible text passes through. */
function visibleEscape(text: string): string {
  // Escaped code points and runs of visible text become space-separated parts:
  // "hi" + U+E0069 → "hi U+E0069".
  const parts: string[] = [];
  let visible = "";
  let length = 0;
  for (const ch of text) {
    if (INVISIBLE.test(ch) && ch !== "\n" && ch !== "\t") {
      if (visible) parts.push(visible);
      visible = "";
      parts.push(hex(ch.codePointAt(0) as number));
    } else {
      visible += ch;
    }
    if (++length > SAMPLE_MAX * 2) break; // bound work on huge inputs
  }
  if (visible) parts.push(visible);
  return truncateSample(parts.join(" "));
}

/** Cap a sample at SAMPLE_MAX characters (an ellipsis marks the cut). */
function truncateSample(sample: string): string {
  const flat = sample.replace(/\s+/g, " ").trim();
  return flat.length <= SAMPLE_MAX ? flat : `${flat.slice(0, SAMPLE_MAX - 1)}…`;
}

/** Aggregates findings by layer id, preserving first-seen order. */
export class FindingSet {
  private readonly byLayer = new Map<string, Finding>();

  add(layer: string, severity: Severity, rawSample: string, count = 1): void {
    const existing = this.byLayer.get(layer);
    if (existing) {
      existing.count += count;
      return;
    }
    this.byLayer.set(layer, { layer, severity, count, sample: visibleEscape(rawSample) });
  }

  merge(other: FindingSet): void {
    for (const f of other.list()) {
      const existing = this.byLayer.get(f.layer);
      if (existing) existing.count += f.count;
      else this.byLayer.set(f.layer, { ...f });
    }
  }

  get size(): number {
    return this.byLayer.size;
  }

  list(): Finding[] {
    return [...this.byLayer.values()].map((f) => ({ ...f }));
  }
}
