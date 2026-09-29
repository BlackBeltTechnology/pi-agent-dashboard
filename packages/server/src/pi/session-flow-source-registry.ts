/**
 * Per-session store of the flow definition files a live session reported in its
 * `flows_list` (`FlowInfo.source`, the absolute `flow.yaml` path pi-flows
 * discovered — including extension-registered flow dirs via
 * `flow:register-flows-dir`, which sit outside `/api/pi-resource-file`'s
 * `.pi` / `node_modules` allow-list).
 *
 * `has(path)` lets that endpoint serve EXACTLY those files — never a sibling or
 * parent dir. Only absolute `.yaml`/`.yml` sources are retained. Paths are
 * canonicalized (realpath) on both sides so a symlinked or `..` spelling
 * cannot bypass or miss the match. Entries are replaced on every `flows_list`
 * and dropped on `session_unregister`.
 * See change: attach-flow-before-run.
 */
import * as path from "node:path";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { canonicalPath } from "./session-skill-registry.js";

const YAML_FILE = /\.ya?ml$/i;

class SessionFlowSourceRegistry {
  private readonly bySession = new Map<string, Set<string>>();

  retain(sessionId: string, flows: readonly FlowInfo[] | undefined): void {
    const sources = new Set<string>();
    for (const f of flows ?? []) {
      const src = f?.source;
      if (typeof src !== "string" || !path.isAbsolute(src) || !YAML_FILE.test(src)) continue;
      sources.add(canonicalPath(path.resolve(src)));
    }
    this.bySession.set(sessionId, sources);
  }

  remove(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /** True when `filePath` is exactly a flow source some live session reported. */
  has(filePath: string): boolean {
    if (!path.isAbsolute(filePath) || !YAML_FILE.test(filePath)) return false;
    const wanted = canonicalPath(path.resolve(filePath));
    for (const set of this.bySession.values()) if (set.has(wanted)) return true;
    return false;
  }

  /** @internal test-only */
  clearForTests(): void {
    this.bySession.clear();
  }
}

export const sessionFlowSourceRegistry = new SessionFlowSourceRegistry();
