/**
 * Persistent per-tool path overrides at `~/.pi/dashboard/tool-overrides.json`.
 *
 * Schema:
 *   { "version": 1, "overrides": { "<toolName>": { "path": "<abs>" } } }
 *
 * Design notes (see change: consolidate-tool-resolution, design §5):
 *   - Separate from `config.json` — path overrides are machine-local and
 *     should NOT follow a user's dotfiles across machines.
 *   - Atomic write via the same tmp+rename pattern used by
 *     `server/src/json-store.ts` (duplicated here to keep `shared`
 *     self-contained; the two live in different packages).
 *   - Malformed files are treated as empty. No throw, no crash.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Path to the overrides file. Exposed for tests and the settings UI. */
export function defaultOverridesPath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "tool-overrides.json");
}

/** Internal shape persisted to disk. `version` lets us evolve later. */
interface OverridesFile {
  version: 1;
  overrides: Record<string, { path: string }>;
}

export interface OverridesStoreDeps {
  filePath?: string;
  /** Logger hook (defaults to console.warn). Tests inject a sink. */
  warn?(message: string): void;
}

/**
 * Read-through + write-through in-memory store. One instance per registry.
 * Keeps the disk read lazy — the file is only touched on first access.
 */
export class OverridesStore {
  private readonly filePath: string;
  private readonly warn: (message: string) => void;
  private cache: Record<string, string> | null = null;

  constructor(deps: OverridesStoreDeps = {}) {
    this.filePath = deps.filePath ?? defaultOverridesPath();
    this.warn = deps.warn ?? ((m) => console.warn(`[tool-registry] ${m}`));
  }

  /** Snapshot of current overrides. Lazy-loads from disk on first call. */
  list(): Readonly<Record<string, string>> {
    if (this.cache === null) this.cache = this.load();
    return this.cache;
  }

  /** Set one override + persist. */
  set(name: string, overridePath: string): void {
    const current = this.cache ?? this.load();
    current[name] = overridePath;
    this.cache = current;
    this.persist(current);
  }

  /** Remove one override + persist. No-op if absent. */
  clear(name: string): void {
    const current = this.cache ?? this.load();
    if (!(name in current)) return;
    delete current[name];
    this.cache = current;
    this.persist(current);
  }

  /**
   * Apply several overrides in ONE transaction. A `null` value clears that
   * key. Every change is applied to a COPY, persisted once, and the cache is
   * swapped only after the write succeeds — so a failed persist leaves both
   * the file and the in-memory cache untouched.
   *
   * `set()`/`clear()` are atomic per single write only; two sequential calls
   * leave a crash window in which one consumer is pinned and the other is
   * not. See change: select-pi-runtime-install (design D7).
   */
  setMany(changes: Record<string, string | null>): void {
    const current = this.cache ?? this.load();
    const next: Record<string, string> = { ...current };
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) delete next[name];
      else next[name] = value;
    }
    this.persist(next);
    this.cache = next;
  }

  /** Drop the in-memory cache; next `list()` re-reads the file. */
  invalidate(): void {
    this.cache = null;
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private load(): Record<string, string> {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const raw = fs.readFileSync(this.filePath, "utf-8");
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw) as Partial<OverridesFile>;
      if (!parsed || typeof parsed !== "object" || !parsed.overrides) {
        this.warn(`malformed overrides file at ${this.filePath}; ignoring`);
        return {};
      }
      const out: Record<string, string> = {};
      for (const [name, entry] of Object.entries(parsed.overrides)) {
        if (entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string") {
          out[name] = (entry as { path: string }).path;
        }
      }
      return out;
    } catch (err) {
      this.warn(
        `failed to read overrides file at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
  }

  /** Protected so tests can inject a throwing persist (fault-injection). */
  protected persist(overrides: Record<string, string>): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: OverridesFile = {
      version: 1,
      overrides: Object.fromEntries(
        Object.entries(overrides).map(([k, v]) => [k, { path: v }]),
      ),
    };
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmpPath, this.filePath);
  }
}
