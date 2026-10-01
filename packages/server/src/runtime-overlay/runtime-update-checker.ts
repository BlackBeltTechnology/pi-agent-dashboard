/**
 * Runtime-update checker (D3, D5): resolves the target runtime release X for
 * the selected source/channel and reports whether it differs from the active
 * runtime. NOTIFY-ONLY — it never stages or activates; both are explicit user
 * actions. Results are cached 24 h ("Check now" forces); a failed check keeps
 * the last good result.
 *
 * See change: electron-runtime-overlay-updates.
 */

import type { RuntimeChannel, RuntimeSource } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import semver from "semver";

export const RUNTIME_SERVER_PACKAGE = "@blackbelt-technology/pi-dashboard-server";
export const RUNTIME_GITHUB_REPO = "BlackBeltTechnology/pi-agent-dashboard";

const CACHE_TTL_MS = 24 * 3600_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface RuntimeReleaseFeeds {
  /** `npm view <server> dist-tags` (honours the npm registry config). */
  npmDistTags: () => Promise<Record<string, string>>;
  /** GitHub Releases of the dashboard repo. */
  githubReleases: () => Promise<Array<{ tag: string; prerelease: boolean; draft: boolean }>>;
}

export interface RuntimeSelection {
  source: RuntimeSource | "local";
  channel?: RuntimeChannel;
  pin?: string;
}

export type RuntimeCheckStatus =
  | { state: "not_applicable"; source: RuntimeSelection["source"]; checkedAt: number }
  | { state: "up_to_date" | "available"; target: string; active: string; checkedAt: number }
  | { state: "check_failed"; reason: string; checkedAt: number; lastGood?: RuntimeCheckStatus };

function newest(versions: string[]): string | null {
  const valid = versions.filter((v) => semver.valid(v));
  return valid.length ? (semver.rsort(valid)[0] ?? null) : null;
}

/** Target release X for a source/channel/pin. Throws on no release / bad pin. */
export async function resolveTarget(
  sel: { source: RuntimeSource; channel?: RuntimeChannel; pin?: string },
  feeds: RuntimeReleaseFeeds,
): Promise<string> {
  if (sel.pin !== undefined) {
    const pin = semver.valid(sel.pin);
    if (!pin) throw new Error(`invalid pin ${JSON.stringify(sel.pin)}`);
    return pin;
  }
  const beta = sel.channel === "beta";
  let target: string | null = null;
  if (sel.source === "npm") {
    const tags = await feeds.npmDistTags();
    // Beta = newest including prereleases; never below stable.
    target = newest(beta ? [tags.latest, tags.beta].filter(Boolean) as string[] : [tags.latest ?? ""]);
  } else if (sel.source === "github") {
    const rels = (await feeds.githubReleases()).filter((r) => !r.draft && (beta || !r.prerelease));
    target = newest(rels.map((r) => r.tag.replace(/^v/, "")));
  }
  if (!target) throw new Error(`no ${sel.channel ?? "stable"} release found on ${sel.source}`);
  return target;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`check timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class RuntimeUpdateChecker {
  /** Last good result per selection key (served for 24 h, and as `lastGood` on failure). */
  private readonly good = new Map<string, RuntimeCheckStatus>();
  /** Last result of any kind, for `peek()`. */
  private last: { key: string; status: RuntimeCheckStatus } | null = null;

  constructor(
    private readonly opts: {
      readSelection: () => RuntimeSelection;
      activeVersion: () => string;
      feeds: RuntimeReleaseFeeds;
      now?: () => number;
      timeoutMs?: number;
    },
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private selectionKey(sel: RuntimeSelection): string {
    return JSON.stringify([sel.source, sel.channel ?? "stable", sel.pin ?? null]);
  }

  /** Same-selection good result that is still within the 24 h TTL. */
  private freshGood(key: string, now: number): RuntimeCheckStatus | undefined {
    const g = this.good.get(key);
    return g && now - g.checkedAt < CACHE_TTL_MS ? g : undefined;
  }

  /** Last result for the CURRENT selection without a network call (null if none). */
  peek(): RuntimeCheckStatus | null {
    const key = this.selectionKey(this.opts.readSelection());
    return this.last?.key === key ? this.last.status : null;
  }

  async check(o: { force?: boolean } = {}): Promise<RuntimeCheckStatus> {
    const now = this.now();
    const sel = this.opts.readSelection();
    const key = this.selectionKey(sel);
    const cached = this.freshGood(key, now);
    if (!o.force && cached) {
      this.last = { key, status: cached };
      return cached;
    }
    const status = await this.compute(sel, now, key);
    if (status.state !== "check_failed") this.good.set(key, status);
    this.last = { key, status };
    return status;
  }

  private async compute(sel: RuntimeSelection, now: number, key: string): Promise<RuntimeCheckStatus> {
    if (sel.source === "bundled" || sel.source === "local") return { state: "not_applicable", source: sel.source, checkedAt: now };
    try {
      const target = await withTimeout(
        resolveTarget({ source: sel.source, channel: sel.channel, pin: sel.pin }, this.opts.feeds),
        this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      const active = this.opts.activeVersion();
      return { state: target === active ? "up_to_date" : "available", target, active, checkedAt: now };
    } catch (err) {
      const lastGood = this.freshGood(key, now);
      return {
        state: "check_failed",
        reason: err instanceof Error ? err.message : String(err),
        checkedAt: now,
        ...(lastGood ? { lastGood } : {}),
      };
    }
  }

  invalidate(): void {
    this.good.clear();
    this.last = null;
  }
}
