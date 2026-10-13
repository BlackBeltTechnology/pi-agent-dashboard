/**
 * Exact-occurrence masker for vault values.
 *
 * Replaces every occurrence of a held value with `[REDACTED:<NAME>]` (longest
 * value first). It does NOT catch encoded or transformed forms.
 *
 *  - `mask(text)`             — replace complete occurrences.
 *  - `maskAndHold(text)`      — also split off a trailing run that could be the
 *                               START of a value (a proper prefix), so a secret
 *                               split across stream chunks is never emitted in
 *                               pieces. The held run is delayed, never dropped.
 *  - `maskDeep(value, opts)`  — mask every string in a JSON-like structure and
 *                               return a copy; unchanged subtrees keep their
 *                               identity, and the input is never mutated.
 *
 * The value set grows over the life of the process (a rotated or revoked value
 * stays masked), and the masker rebuilds itself when `getState().version` moves.
 *
 * See change: add-credential-vault (D5).
 */

export interface MaskerState {
  version: number;
  entries: Array<{ name: string; value: string }>;
}

interface DeepOptions {
  /** Hold back a trailing partial-prefix of each string (stream snapshots). */
  hold?: boolean;
  /**
   * Discriminator literals that are never touched: `{ role: new Set(["assistant"]) }`
   * skips a string only when it sits under that key AND is exactly one of those
   * literals. A secret in a field that merely happens to be called `type` is still masked.
   */
  skipLiterals?: Readonly<Record<string, ReadonlySet<string>>>;
}

export interface Masker {
  /** True when at least one value is held, i.e. masking can change something. */
  active(): boolean;
  mask(text: string): string;
  maskAndHold(text: string): { emit: string; held: string };
  maskDeep<T>(value: T, opts?: DeepOptions): T;
}

const MAX_DEPTH = 64;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Built {
  version: number;
  /** Longest first. */
  entries: Array<{ name: string; value: string; token: string }>;
  firstChars: Set<string>;
  longest: number;
}

function build(state: MaskerState): Built {
  const seen = new Set<string>();
  const entries = state.entries
    .filter((e) => typeof e.value === "string" && e.value.length > 0 && !seen.has(e.value) && seen.add(e.value))
    .map((e) => ({ name: e.name, value: e.value, token: `[REDACTED:${e.name}]` }))
    .sort((a, b) => b.value.length - a.value.length || a.name.localeCompare(b.name));
  return {
    version: state.version,
    entries,
    firstChars: new Set(entries.map((e) => e.value[0])),
    longest: entries.length > 0 ? entries[0].value.length : 0,
  };
}

class MaskerImpl implements Masker {
  private readonly getState: () => MaskerState;
  private built: Built | undefined;

  constructor(getState: () => MaskerState) {
    this.getState = getState;
  }

  private current(): Built {
    const state = this.getState();
    if (!this.built || this.built.version !== state.version) this.built = build(state);
    return this.built;
  }

  /** Replace complete occurrences; also reports where the last one ended. */
  private replaceAll(b: Built, text: string): { out: string; lastEnd: number } {
    const present = b.entries.filter((e) => text.includes(e.value));
    if (present.length === 0) return { out: text, lastEnd: 0 };
    const byValue = new Map(present.map((e) => [e.value, e.token]));
    const re = new RegExp(present.map((e) => escapeRegExp(e.value)).join("|"), "g");
    let lastEnd = 0;
    const out = text.replace(re, (m: string, offset: number) => {
      lastEnd = offset + m.length;
      return byValue.get(m) ?? m;
    });
    return { out, lastEnd };
  }

  active(): boolean {
    return this.current().entries.length > 0;
  }

  mask(text: string): string {
    const b = this.current();
    return b.entries.length === 0 || text.length === 0 ? text : this.replaceAll(b, text).out;
  }

  maskAndHold(text: string): { emit: string; held: string } {
    const b = this.current();
    if (b.entries.length === 0 || text.length === 0) return { emit: text, held: "" };
    const { lastEnd } = this.replaceAll(b, text);
    // The longest suffix, starting at or after the last full match, that is a
    // PROPER prefix of some value (so a match can never straddle the cut).
    let cut = text.length;
    for (let i = Math.max(lastEnd, text.length - (b.longest - 1)); i < text.length; i++) {
      if (b.firstChars.has(text[i]) && isProperPrefix(b, text.slice(i))) {
        cut = i;
        break;
      }
    }
    return { emit: this.mask(text.slice(0, cut)), held: text.slice(cut) };
  }

  maskDeep<T>(value: T, opts: DeepOptions = {}): T {
    return this.current().entries.length === 0 ? value : (this.walk(value, opts, 0) as T);
  }

  private walk(v: unknown, opts: DeepOptions, depth: number): unknown {
    if (typeof v === "string") return opts.hold ? this.maskAndHold(v).emit : this.mask(v);
    if (v === null || typeof v !== "object" || depth > MAX_DEPTH) return v;
    if (Array.isArray(v)) return this.walkArray(v, opts, depth);
    const toJSON = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") return this.walk((toJSON as () => unknown).call(v), opts, depth + 1);
    return this.walkObject(v as Record<string, unknown>, opts, depth);
  }

  private walkArray(v: unknown[], opts: DeepOptions, depth: number): unknown[] {
    let changed = false;
    const out = v.map((x) => {
      const y = this.walk(x, opts, depth + 1);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }

  private walkObject(v: Record<string, unknown>, opts: DeepOptions, depth: number): Record<string, unknown> {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const y = typeof x === "string" && opts.skipLiterals?.[k]?.has(x) ? x : this.walk(x, opts, depth + 1);
      if (y !== x) changed = true;
      out[k] = y;
    }
    return changed ? out : v;
  }
}

const isProperPrefix = (b: Built, suffix: string): boolean =>
  b.entries.some((e) => e.value.length > suffix.length && e.value.startsWith(suffix));

export function createMasker(getState: () => MaskerState): Masker {
  return new MaskerImpl(getState);
}
