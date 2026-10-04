/**
 * Root set for the agent path gate (D2): workspace (cwd + bound checkout roots),
 * built-in read-only roots (pi agent dir, skills, pi docs, loaded context files)
 * and built-in read+write roots (tmpdir, `/tmp`, session dir). All real-pathed once.
 *
 * The checkout probe starts at `session_start` and is bounded; a decision that
 * needs it waits up to `PROBE_BOUND_MS`, else falls back to cwd only (fail closed).
 * See change: ask-agent-file-access-in-chat.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { checkoutRootsAsync, isBoundCheckoutAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { samePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import type { GateRoots } from "./decide.js";

/** Same per-probe budget `file-read-containment` uses. */
const PROBE_TIMEOUT_MS = 2_000;
/** How long a decision waits for the checkout probe before using cwd only. */
const PROBE_BOUND_MS = 3_000;

export interface PiResources {
  agentDir: string;
  docsDir?: string;
  skillDirs: string[];
  contextFiles: string[];
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Bound checkout roots of `cwd`; `[]` on any failure (never throws). */
async function probeCheckoutRoots(cwd: string): Promise<string[]> {
  try {
    const roots = await checkoutRootsAsync({ cwd, timeout: PROBE_TIMEOUT_MS });
    if (!roots) return [];
    const cands: string[] = [];
    for (const c of [roots.thisCheckout, roots.mainCheckout]) {
      if (c && !cands.some((s) => samePath(s, c))) cands.push(c);
    }
    const bound: string[] = [];
    for (const c of cands) {
      if (await isBoundCheckoutAsync(c, roots.commonDir, { timeout: PROBE_TIMEOUT_MS })) bound.push(realpathOr(c));
    }
    return bound;
  } catch {
    return [];
  }
}

/** Race a promise against a bound; resolves `fallback` on timeout. */
export function withBound<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    t.unref?.();
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}

export interface RootsProviderOptions {
  getCwd: () => string;
  getSessionDir: () => string | undefined;
  getPiResources: () => PiResources;
  probe?: (cwd: string) => Promise<string[]>;
  probeBoundMs?: number;
}

export class RootsProvider {
  private probePromise: Promise<string[]> | null = null;
  private probeCwd: string | null = null;
  private settled: string[] | null = null;
  private cachedKey = "";
  private cachedStatic: Omit<GateRoots, "grants" | "workspace"> | null = null;

  constructor(private readonly opts: RootsProviderOptions) {}

  /** Start (or restart for a new cwd) the bounded checkout probe. */
  startProbe(cwdArg?: string): void {
    const cwd = cwdArg ?? this.opts.getCwd();
    if (this.probeCwd === cwd && this.probePromise !== null) return;
    this.probeCwd = cwd;
    this.settled = null;
    const probe = this.opts.probe ?? probeCheckoutRoots;
    this.probePromise = withBound(probe(cwd), this.opts.probeBoundMs ?? PROBE_BOUND_MS, [] as string[]).then((r) => {
      this.settled = r;
      return r;
    });
  }

  /** Workspace + built-ins. Awaits the probe only when it has not settled yet. */
  async roots(grants: readonly string[], needsCheckout: boolean, cwdArg?: string): Promise<GateRoots> {
    const cwd = cwdArg ?? this.opts.getCwd();
    this.startProbe(cwd);
    let checkout: string[] = this.settled ?? [];
    if (this.settled === null && needsCheckout) checkout = await (this.probePromise as Promise<string[]>);
    const workspace = [realpathOr(cwd), ...checkout];
    return { workspace, grants, ...this.staticRoots() };
  }

  /** True when probe has settled (in-root latency budget applies from then). */
  get probeSettled(): boolean {
    return this.settled !== null;
  }

  private staticRoots(): Omit<GateRoots, "grants" | "workspace"> {
    const res = this.opts.getPiResources();
    const sessionDir = this.opts.getSessionDir();
    const key = JSON.stringify([res, sessionDir]);
    if (this.cachedStatic && key === this.cachedKey) return this.cachedStatic;
    const ro = [res.agentDir, res.docsDir, ...res.skillDirs, ...res.contextFiles]
      .filter((x): x is string => !!x)
      .map(realpathOr);
    const rw = [os.tmpdir(), ...(nodePath.sep === "/" ? ["/tmp"] : []), ...(sessionDir ? [sessionDir] : [])].map(realpathOr);
    this.cachedKey = key;
    this.cachedStatic = { readOnly: ro, readWrite: rw };
    return this.cachedStatic;
  }
}
