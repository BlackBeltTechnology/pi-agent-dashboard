/**
 * Repo-level invariant: the jsdom virtualizer shim's post-unmount drain is
 * scoped to ONE testid, so that scope must stay exhaustive.
 *
 * `packages/client/src/test-support/virtualizer-jsdom.ts` waits 160 ms in
 * `afterEach` ONLY for tests that mounted the ChatView scroll container
 * (`data-testid="chat-scroll-container"`). The wait exists because TanStack
 * Virtual leaves a 150 ms scroll-reset callback scheduled after unmount; if it
 * fires after the vitest fork's jsdom teardown, React's scheduler throws
 * `ReferenceError: window is not defined` and the run exits 1 with every
 * assertion passing (vitest reports it as `Errors 1`).
 *
 * That narrow scope is only safe while ChatView is the ONLY `useVirtualizer`
 * call site in the client. A second virtualized list rendering under a
 * different testid would leave its own callback scheduled, the drain would
 * silently skip it, and the flake class would return — with NO failing test to
 * point at it, because the failure lands on whichever spec the `pool: "forks"`
 * scheduler happened to run next.
 *
 * If this test fails you added a `useVirtualizer` call site. Do NOT just bump
 * the count: widen the drain predicate in `virtualizer-jsdom.ts` to cover the
 * new scroll container too, then update the expected sites here.
 *
 * See change: restore-dashboard-subagents-dependency (PR #519 follow-up).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CLIENT_SRC = path.join(REPO_ROOT, "packages", "client", "src");

// The drain predicate in virtualizer-jsdom.ts matches exactly these testids.
// Keep in lockstep with `DRAINED_TESTIDS` in that file.
const DRAINED_TESTIDS = ["chat-scroll-container"];

// Files permitted to call `useVirtualizer`. Every entry MUST render a scroll
// container carrying one of DRAINED_TESTIDS.
const EXPECTED_VIRTUALIZER_SITES = ["components/chat/ChatView.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("virtualizer jsdom drain scope", () => {
  it("keeps ChatView as the only useVirtualizer call site in the client", () => {
    const sites = walk(CLIENT_SRC)
      .filter((f) => /\buseVirtualizer\s*\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(CLIENT_SRC, f).split(path.sep).join("/"))
      .sort();

    expect(sites).toEqual(EXPECTED_VIRTUALIZER_SITES);
  });

  it("renders a drained testid at every useVirtualizer call site", () => {
    for (const site of EXPECTED_VIRTUALIZER_SITES) {
      const source = fs.readFileSync(path.join(CLIENT_SRC, site), "utf8");
      const covered = DRAINED_TESTIDS.some((id) => source.includes(`data-testid="${id}"`));
      expect(covered, `${site} renders no drained testid — the afterEach drain would skip it`).toBe(true);
    }
  });

  it("drains exactly the testids this lint tracks", () => {
    const shim = fs.readFileSync(path.join(CLIENT_SRC, "test-support", "virtualizer-jsdom.ts"), "utf8");
    const declared = shim.match(/const DRAINED_TESTIDS = \[([^\]]*)\]/)?.[1] ?? "";
    const parsed = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

    expect(parsed).toEqual([...DRAINED_TESTIDS].sort());
  });
});
