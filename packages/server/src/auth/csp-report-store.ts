/**
 * Persisted CSP violation counter behind the baseline report sink
 * (`csp-report-sink.ts`).
 *
 * Counts accepted reports by `policy × effective-directive` (directives from a fixed
 * allow-set, else `other` — report text never becomes a key), plus a `dropped` count of
 * reports the sink refused (limiter / size cap / read deadline) and a global `since`.
 * Trusted Types reports land in the `require-trusted-types-for` bucket and never in the
 * strict `script-src*` measure ({@link strictScriptSrcMeasure}). A bounded document-path
 * breakdown (path only, top {@link MAX_DOCUMENT_PATHS} per policy, rest under `other`) supports
 * the soak review; it is persisted but never disclosed over `/api/health`.
 *
 * Persisted to `~/.pi/dashboard/csp-reports.json` (0600) via a tmp-file + rename, so a reader
 * never sees a torn file. Writes are debounced ({@link FLUSH_DEBOUNCE_MS}: one write per window,
 * not trailing) and flushed on {@link CspReportStore.close}. A write failure never throws: counting
 * continues in memory with one warning per fault episode. A file that is unparseable at boot is
 * moved to `csp-reports.json.corrupt` and counting starts at zero with a new `since`.
 *
 * A separate fixed-key `ttShadow` block (six Trusted Types shadow outcomes, own `since`) is
 * persisted in the same file. It is fed only by {@link CspReportStore.recordShadow} — never through
 * the `policy × directive` path, so shadow text cannot reach `other` or the strict measure. Its
 * `since` is renewed whenever the shadow evidence restarts from zero other than by an operator reset
 * (fresh store, block missing after a rollback, malformed block), so lost evidence shows as a later
 * window start, never as a zero. A malformed block restarts only the shadow counters and is never
 * "file corruption" (no `.corrupt` move, core counters kept).
 *
 * See change: harden-cors-and-csp-reporting (D8); add-trusted-types-shadow-enforce (D7, D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CSP_REPORT_POLICIES, type CspReportPolicy, isCspReportPolicy } from "./csp-report-paths.js";

/** Debounce for counter-file writes (a change is on disk within this window). */
const FLUSH_DEBOUNCE_MS = 5_000;
/** Distinct document paths kept per policy; the rest count under {@link OTHER_KEY}. */
const MAX_DOCUMENT_PATHS = 20;
const MAX_PATH_CHARS = 128;

const OTHER_KEY = "other";
const TRUSTED_TYPES_DIRECTIVE = "require-trusted-types-for";

/** Fixed directive allow-set: anything else is counted under {@link OTHER_KEY}. */
export const CSP_DIRECTIVE_ALLOW_SET: readonly string[] = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "img-src",
  "font-src",
  "connect-src",
  "media-src",
  "object-src",
  "child-src",
  "frame-src",
  "worker-src",
  "manifest-src",
  "prefetch-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
  "sandbox",
  "navigate-to",
  "trusted-types",
  TRUSTED_TYPES_DIRECTIVE,
];
const ALLOWED = new Set(CSP_DIRECTIVE_ALLOW_SET);

/** Map any directive text onto the allow-set (lowercased) or `other`. */
export function normalizeDirective(raw: string): string {
  const d = raw.trim().toLowerCase();
  return ALLOWED.has(d) ? d : OTHER_KEY;
}

/**
 * The six Trusted Types shadow outcomes the client classifies in report mode. The client keeps its own
 * copy of this list (`packages/client/src/lib/security/trusted-types.ts`); keep both in step.
 */
export const SHADOW_OUTCOMES = [
  "would-block-script",
  "would-block-script-url",
  "would-alter-html",
  "would-throw-html",
  "not-evaluated",
  "shadow-error",
] as const;
export type ShadowOutcome = (typeof SHADOW_OUTCOMES)[number];
const SHADOW_SET: ReadonlySet<string> = new Set(SHADOW_OUTCOMES);
export const isShadowOutcome = (v: string): v is ShadowOutcome => SHADOW_SET.has(v);

/** Shadow counts plus the start of their evidence window (flat form: counts only, no per-key timestamps). */
type TtShadowSnapshot = { since: string } & Record<ShadowOutcome, number>;

/** Counts only — no URL, path or report content. Shape served as `cspReports` in `/api/health`. */
export interface CspReportsSnapshot {
  since: string;
  dropped: number;
  counts: Record<CspReportPolicy, Record<string, number>>;
  ttShadow: TtShadowSnapshot;
}

/** The strict `script-src*` measure the follow-up soak gate reads (`strict` counters starting `script-src`). */
export function strictScriptSrcMeasure(s: CspReportsSnapshot): number {
  let n = 0;
  for (const [directive, count] of Object.entries(s.counts.strict)) if (directive.startsWith("script-src")) n += count;
  return n;
}

function defaultCspReportsPath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "csp-reports.json");
}

interface Bucket {
  count: number;
  firstSeen: string;
  lastSeen: string;
}

type PolicyMap<T> = Record<CspReportPolicy, Map<string, T>>;
const emptyPolicyMap = <T>(): PolicyMap<T> => ({
  baseline: new Map(),
  strict: new Map(),
  "trusted-types": new Map(),
});

export interface CspReportStoreOptions {
  /** Counter file (default `~/.pi/dashboard/csp-reports.json`). */
  filePath?: string;
  /** Wall clock for `since` / `firstSeen` / `lastSeen` (default `Date.now`). */
  now?: () => number;
  /** Warning sink (default `console.warn`). */
  warn?: (msg: string) => void;
}

export class CspReportStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;
  private since = "";
  private dropped = 0;
  private counts = emptyPolicyMap<Bucket>();
  private documents = emptyPolicyMap<number>();
  private shadow = new Map<ShadowOutcome, Bucket>();
  private shadowSince = "";
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private warned = false;

  constructor(opts: CspReportStoreOptions = {}) {
    this.file = opts.filePath ?? defaultCspReportsPath();
    this.now = opts.now ?? Date.now;
    this.warn = opts.warn ?? ((m) => console.warn(m));
    this.load();
  }

  /** Count one accepted report. `directive` is normalised onto the allow-set; `docPath` is a path (no query). */
  record(policy: CspReportPolicy, directive: string, docPath?: string): void {
    const key = normalizeDirective(directive);
    const at = new Date(this.now()).toISOString();
    const bucket = this.counts[policy].get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.lastSeen = at;
    } else {
      this.counts[policy].set(key, { count: 1, firstSeen: at, lastSeen: at });
    }
    if (docPath !== undefined) {
      const docs = this.documents[policy];
      const p = docPath.slice(0, MAX_PATH_CHARS);
      const k = docs.has(p) || docs.size < MAX_DOCUMENT_PATHS ? p : OTHER_KEY;
      docs.set(k, (docs.get(k) ?? 0) + 1);
    }
    this.markDirty();
  }

  /** Count one report the sink refused (limiter / size cap / read deadline). */
  recordDropped(): void {
    this.dropped += 1;
    this.markDirty();
  }

  /** Add `n` (a validated 1..1,000,000 count) to one shadow outcome. Never touches the policy counters. */
  recordShadow(outcome: ShadowOutcome, n: number): void {
    const at = new Date(this.now()).toISOString();
    const bucket = this.shadow.get(outcome);
    if (bucket) {
      bucket.count = Math.min(Number.MAX_SAFE_INTEGER, bucket.count + n);
      bucket.lastSeen = at;
    } else {
      this.shadow.set(outcome, { count: n, firstSeen: at, lastSeen: at });
    }
    this.markDirty();
  }

  /** Zero every counter incl. `dropped` and the shadow block; returns the new `since` (ISO-8601). */
  reset(): string {
    this.counts = emptyPolicyMap();
    this.documents = emptyPolicyMap();
    this.dropped = 0;
    this.since = new Date(this.now()).toISOString();
    this.shadow = new Map();
    this.shadowSince = this.since;
    this.markDirty();
    return this.since;
  }

  snapshot(): CspReportsSnapshot {
    const counts = { baseline: {}, strict: {}, "trusted-types": {} } as CspReportsSnapshot["counts"];
    for (const policy of CSP_REPORT_POLICIES) {
      for (const [d, b] of this.counts[policy]) counts[policy][d] = b.count;
    }
    const ttShadow = { since: this.shadowSince } as TtShadowSnapshot;
    for (const o of SHADOW_OUTCOMES) ttShadow[o] = this.shadow.get(o)?.count ?? 0;
    return { since: this.since, dropped: this.dropped, counts, ttShadow };
  }

  /** Bounded per-policy document-path breakdown (operator/soak review; not served over health). */
  documentBreakdown(): Record<CspReportPolicy, Record<string, number>> {
    // Null-prototype maps: a path segment such as `__proto__` is attacker-controlled and must stay a plain key.
    const out = {
      baseline: Object.create(null),
      strict: Object.create(null),
      "trusted-types": Object.create(null),
    } as Record<CspReportPolicy, Record<string, number>>;
    for (const policy of CSP_REPORT_POLICIES) {
      for (const [p, n] of this.documents[policy]) out[policy][p] = n;
    }
    return out;
  }

  /** Write now when there are unsaved changes; never throws. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.serialize()), { mode: 0o600 });
      // `mode` only applies at creation: a stale tmp from a killed process keeps its old mode.
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, this.file);
      this.dirty = false;
      this.warned = false;
    } catch (err) {
      // Stay dirty: the next change (or shutdown) retries. One warning per fault episode.
      if (!this.warned) {
        this.warned = true;
        this.warn(`[csp] counter file write failed (${(err as NodeJS.ErrnoException)?.code ?? "error"}); counting in memory`);
      }
    }
  }

  /** Flush and stop the debounce timer (graceful shutdown). */
  close(): void {
    this.flush();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  private serialize() {
    const counts: Record<string, Record<string, Bucket>> = {};
    const documents: Record<string, Record<string, number>> = {};
    for (const policy of CSP_REPORT_POLICIES) {
      counts[policy] = Object.fromEntries(this.counts[policy]);
      documents[policy] = Object.fromEntries(this.documents[policy]);
    }
    const ttShadow = { since: this.shadowSince, counts: Object.fromEntries(this.shadow) };
    return { version: 1, since: this.since, dropped: this.dropped, counts, documents, ttShadow };
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") this.warn(`[csp] counter file unreadable (${(err as NodeJS.ErrnoException)?.code ?? "error"}); starting at zero`);
      this.since = new Date(this.now()).toISOString();
      this.shadowSince = this.since;
      return;
    }
    if (this.parse(raw)) return;
    // Corrupt: keep the bytes for inspection, start at zero with a new `since`.
    this.counts = emptyPolicyMap();
    this.documents = emptyPolicyMap();
    this.dropped = 0;
    this.since = new Date(this.now()).toISOString();
    this.shadow = new Map();
    this.shadowSince = this.since;
    try {
      fs.renameSync(this.file, `${this.file}.corrupt`);
    } catch {
      /* best effort — the next flush replaces the file anyway */
    }
    this.warn("[csp] counter file corrupt; moved to csp-reports.json.corrupt and restarted counting");
  }

  /**
   * Populate the shadow block. Absent (first upgrade, or an older-server rewrite) or malformed → zero counts
   * with a new `since` (malformed also warns once); the core counters are never affected. Unknown outcome keys
   * are ignored, so a newer version's extra key does not invalidate the block.
   */
  private loadShadow(v: unknown): void {
    const restart = () => {
      this.shadow = new Map();
      this.shadowSince = new Date(this.now()).toISOString();
    };
    if (v === undefined) return restart();
    const block = parseShadow(v);
    if (!block) {
      restart();
      this.warn("[csp] counter file shadow block malformed; restarted the shadow counters");
      return;
    }
    this.shadow = block.counts;
    this.shadowSince = block.since;
  }

  /** Populate from the file text; `false` when malformed (state is only replaced on success). */
  private parse(raw: string): boolean {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (!j || typeof j !== "object" || j.version !== 1) return false;
      const since = j.since;
      if (typeof since !== "string" || Number.isNaN(Date.parse(since))) return false;
      if (!Number.isInteger(j.dropped) || (j.dropped as number) < 0) return false;
      const counts = parseCounts(j.counts);
      const documents = parseDocuments(j.documents);
      if (!counts || !documents) return false;
      this.since = since;
      this.dropped = j.dropped as number;
      this.counts = counts;
      this.documents = documents;
      this.loadShadow(j.ttShadow);
      return true;
    } catch {
      return false;
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const isPlainObject = (v: unknown): v is Record<string, unknown> => isRecord(v) && !Array.isArray(v);

/** One persisted bucket, or `null` when malformed. */
function parseBucket(b: unknown): Bucket | null {
  const bucket = b as Partial<Bucket> | null;
  if (!bucket || !Number.isInteger(bucket.count) || (bucket.count as number) < 0) return null;
  return { count: bucket.count as number, firstSeen: String(bucket.firstSeen), lastSeen: String(bucket.lastSeen) };
}

/** Validate the persisted `counts` block (unknown directives are dropped); `null` = malformed. */
function parseCounts(v: unknown): PolicyMap<Bucket> | null {
  const out = emptyPolicyMap<Bucket>();
  for (const [policy, dirs] of Object.entries(isRecord(v) ? v : {})) {
    if (!isCspReportPolicy(policy) || !isRecord(dirs)) return null;
    for (const [d, b] of Object.entries(dirs)) {
      if (!ALLOWED.has(d) && d !== OTHER_KEY) continue;
      const bucket = parseBucket(b);
      if (!bucket) return null;
      out[policy].set(d, bucket);
    }
  }
  return out;
}

/** Validate the persisted document-path block (bounded); `null` = malformed. */
function parseDocuments(v: unknown): PolicyMap<number> | null {
  const out = emptyPolicyMap<number>();
  for (const [policy, docs] of Object.entries(isRecord(v) ? v : {})) {
    if (!isCspReportPolicy(policy) || !isRecord(docs)) return null;
    for (const [p, c] of Object.entries(docs)) {
      if (!Number.isInteger(c) || (c as number) < 0) return null;
      if (out[policy].size < MAX_DOCUMENT_PATHS) out[policy].set(p.slice(0, MAX_PATH_CHARS), c as number);
    }
  }
  return out;
}

/** Validate the persisted `ttShadow` block; `null` = malformed. Unknown outcome keys are dropped. */
function parseShadow(v: unknown): { since: string; counts: Map<ShadowOutcome, Bucket> } | null {
  if (!isPlainObject(v)) return null;
  const { since, counts } = v;
  if (typeof since !== "string" || Number.isNaN(Date.parse(since)) || !isPlainObject(counts)) return null;
  const out = new Map<ShadowOutcome, Bucket>();
  for (const [k, b] of Object.entries(counts)) {
    if (!isShadowOutcome(k)) continue;
    const bucket = parseBucket(b);
    if (!bucket) return null;
    out.set(k, bucket);
  }
  return { since, counts: out };
}
