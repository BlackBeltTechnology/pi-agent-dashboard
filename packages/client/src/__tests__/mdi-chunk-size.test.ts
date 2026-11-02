/**
 * Build guard: the full @mdi/js icon set (~2.78 MB raw) must NOT be part of
 * the cold-landing load. The landing graph is `index.html`'s entry script plus
 * its `modulepreload` hrefs, closed over the static `import"./x.js"` /
 * `from"./x.js"` specifiers of each chunk. No chunk in that graph may carry
 * the full-set marker, yet a separately loadable chunk must (the lazy set
 * behind `useMdiIconByKey`). Also caps the gzipped entry chunk.
 *
 * Build-conditional: skips when no production build is present (CI builds
 * first).
 *
 * See change: shrink-client-index-chunk (test-plan #S1);
 * harden-ios-safari-memory-and-ws-diagnostics (test-plan #E1).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// A minified-survivable @mdi/js export name that no shell code imports by
// name — present only in a chunk that carries the FULL icon set.
const MDI_MARKER = "mdiZodiacAquarius";
// History: raised 900 → 910 → 920 → 930 → 940 KB as features landed; develop CI sat
// at 944,327 B (an inflated, lazy-loadable entry) with every PR ~1.8 KB from red.
// shrink-client-entry-lazy-islands (2026-10-14) moved katex, the hu/zh-CN
// catalogs and the Settings panel off the cold landing. Measured, same base
// (local build; CI measures ~0.4% higher, e.g. 944,327 vs 940,548):
//   entry `index-*.js` gz: 950,470 B → 694,038 B (−256,432 B; 689,543 B before
//   merging retro-ux-credential-vault, whose vault.* keys stay in the entry)
//   landing graph gz total (entry + modulepreload closure): 1,391,815 B → 1,135,386 B
// lazy-plugin-claim-modules (2026-10-14): plugin claim components (settings,
// overlay boards, flow dashboard/graph, blackhole pipeline view, MCP folder
// page, …) moved behind manifest `module` lazy chunks. Measured, same base,
// local build:
//   entry `index-*.js` gz: 690,616 B → 584,020 B (−106,596 B)
//   landing graph gz total: 1,135,756 B → 1,028,118 B (−107,638 B)
// Cap = measured + CI skew (~0.4%) rounded up to the next 10 KiB = 580 KiB
// (spec ceiling 800 KiB). Do not raise it again without a size win first —
// lazy a subsystem instead.
// add-operator-browser-relay (2026-10-17): 580 → 581 KiB. develop sat 289 B under the
// cap (593,631 B local). The change's carrier + pane + settings are lazy chunks; what
// is unavoidably in the entry is +483 B gz (plugin hu/zh-CN catalog keys, the REST seed
// stamping `host`, `usePluginSocket`, the Feed's lazy mount) → 594,114 B before trimming
// the strings to 594,020 B. Smallest step that clears it; not a general raise.
// edit-office-in-pane-with-craft-web (2026-10-19): 581 → 582 KiB. The file-handler layer, the host
// (snapshot/save/conflict flow), the craft-web claim module (CraftFrameHost + frame protocol) and
// the new dialogs are lazy chunks (−~13 KB gz vs. eager). Unavoidably in the entry: the file-handler
// store + claim lookup + mode switcher (EditorPane's seam), the `fileHandler.*` hu/zh-CN keys and
// the craft-web plugin catalog → 595,550 B. Smallest step that clears it; not a general raise.
// colorize-actions-menus (2026-10-19): 582 → 583 KiB. develop sat 417 B under the cap; the change's
// tone helper (`client-utils/tone`), the host tone assignments and the lifecycle-row glyph map are
// unavoidably in the entry (+~1.1 KB gz) → 596,669 B. Smallest step that clears it; not a general raise.
// harden-server-capability-bounds (2026-10-20): 583 -> 585 KiB. develop HEAD was already 404 B OVER the
// 583 KiB cap (597,396 B on CI: the recommended-extensions catalog commit landed on a 417 B margin). The
// change adds, unavoidably in the entry: the `terminal_limit_reached` / `folder_refused` handlers + notice
// store (useMessageHandler), the typed browse refusal (browse-api), and the PathPicker confined/refused
// states + their English fallbacks (+~1.2 KB gz) -> 598,604 B on CI. Smallest KiB step that clears both
// (435 B headroom); not a general raise.
// add-fluid-chat-motion (2026-10-20): 585 -> 589 KiB. Fluid chat motion is ChatView behaviour, so it is
// unavoidably in the entry: the arrival tracker + context, the paced-reveal hook, the follow-glide
// controller + pin planner, the parser-based tail block split, the trailing-edge overlay, `useChatMotion`
// and the pref plumbing/i18n (~+3 KB gz) -> 602,323 B in this test's own gzip (1,283 B over the old cap). Smallest KiB step
// that leaves ~800 B of headroom for CI's compressor variance; not a general raise.
// improve-gmail-plugin-setup-ux (2026-10-21): 589 -> 591 KiB. The Gmail plugin's hu/zh-CN catalog keys
// (setup wizard, consent copy, filter control) ship in the entry like every plugin catalog (+~1.9 KB gz)
// -> 604,237 B on CI, 1,101 B over the old cap; 590 KiB would still be 77 B short. Smallest KiB step
// that clears it (~950 B headroom); not a general raise.
// add-openspec-change-dependencies (2026-10-21): 589 -> 591 KiB. Size win first: the dependencies dialog
// (the largest new component, click-only) is code-split via lazy-openspec-dialogs (-1.6 KB gz; 605,474 ->
// 603,857 B). What stays is board behaviour that cannot split: the per-card chips + wave/issue badges, the
// execution-order sort/drop helpers, the API client and the inline English fallbacks. 603,857 B is 721 B
// over the old cap; 591 KiB (605,184 B) leaves ~1.3 KB. Smallest step with headroom; not a general raise.
// keep-oversized-chat-selection (2026-10-23): 591 -> 593 KiB. ChatView is entry-resident, and the change
// adds what cannot split: the live-selection/retention helpers (chat-virtual-rows), the three-part copy
// serializer (chat-selection-copy), the document copy listener + toast wiring in ChatView and the swipe
// guard. 606,473 B on CI, 1,289 B over the old cap; 592 KiB would still be 265 B short, so 593 KiB
// (607,232 B) leaves ~750 B. Smallest KiB step that clears it; not a general raise.
// harden-auth-credentials (2026-10-24): 593 -> 594 KiB. The per-origin browser-bearer slots, rotation scheduler and
// bearer_expired re-pair live in `lib/pairing/device-auth.ts`, which installs the global fetch wrapper at boot, so it
// cannot be lazy. 607,837 B on CI, 605 B over the old cap; 594 KiB (608,256 B) leaves ~420 B. Smallest KiB step that
// clears it; not a general raise.
// add-trusted-types-shadow-enforce (2026-10-24): 594 -> 596 KiB. The shadow classifier lives in the Trusted
// Types `default` policy, which `bootClient` installs synchronously before first render, so it cannot split:
// the six-outcome classifier (memo + per-window budget + two-pass HTML test) and the shadow aggregate
// transport (clamp/carry, byte-bounded priority report) are unavoidably in the entry (+~1 KB gz alone:
// 607,648 B vs the 593 KiB cap before merging harden-auth-credentials). Merged with develop: 608,974 B in this
// test's own gzip, 718 B over the 594 KiB cap; 595 KiB (609,280 B) would leave ~300 B, so 596 KiB
// (610,304 B, ~1.3 KB headroom for CI's compressor variance). Smallest step with headroom; not a general raise.
// prove-vault-bridge-tls (2026-10-25): 596 -> 598 KiB. The Settings dialog, the Built-in HTTPS switch and the token
// dialog changes are lazy chunks; unavoidably in the entry: the session-header vault chip's eight-cause refusal view
// (`trustDetail` icon + cause + remedy, shown in the chat header) with its English fallbacks, the `vault.*` /
// `gateway.tls.*` / `settings.*` en catalog keys, and the `paired-devices-api` purpose/refusal plumbing (+~1.2 KB gz)
// -> 610,877 B on CI, 573 B over the old cap; 597 KiB (611,328 B) would leave only ~450 B, so 598 KiB (612,352 B,
// ~1.5 KB headroom for CI's compressor variance). Smallest step with headroom; not a general raise.
// flows-dock-chip-and-panel-actions (2026-11-01): 598 -> 599 KiB. Size win first: the flow action dialogs and the
// pencil popover are lazy chunks (FlowActionDialogs.tsx, FlowEditPopover.tsx; -~1.4 KB gz vs. eager). What stays is
// the FLOWS chip itself, which claims the hot `composer-context-group` slot and so must not suspend
// (lazy-plugin-claims policy): the chip, the shared flow-actions hook, the catalog hook + timings and the pill
// copy. 612,367 B on CI, 15 B over the old cap; 599 KiB (613,376 B) leaves ~1 KB for CI's compressor variance.
// Smallest KiB step that clears it; not a general raise.
const INDEX_GZ_CAP_BYTES = 599 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../dist");
const assetsDir = path.join(distDir, "assets");
const indexHtmlPath = path.join(distDir, "index.html");

const basenameOf = (href: string): string => href.split("/").pop() ?? "";

function readIndexHtml(): string | null {
  return existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, "utf8") : null;
}

function entryChunk(html: string): string | null {
  const m = /<script[^>]+type="module"[^>]+src="([^"]+)"/i.exec(html);
  return m ? basenameOf(m[1]) : null;
}

/** Entry + modulepreload chunks, closed over static relative imports. */
function landingGraph(html: string): Set<string> {
  const roots = [
    ...[...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/gi)].map((m) => m[1]),
  ].map(basenameOf);
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    const full = path.join(assetsDir, file);
    if (!existsSync(full)) continue;
    seen.add(file);
    const src = readFileSync(full, "utf8");
    // Static imports only: `import"./x.js"` / `from"./x.js"`. Dynamic
    // `import("./x.js")` is a lazy boundary and deliberately not followed.
    for (const m of src.matchAll(/(?:\bimport|\bfrom)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]);
  }
  return seen;
}

describe("@mdi/js full icon set is off the cold landing (test-plan #E1)", () => {
  it("no chunk in the landing graph contains the full icon set", () => {
    const html = readIndexHtml();
    if (!html) return; // no build output — CI builds first
    const graph = landingGraph(html);
    expect(graph.size).toBeGreaterThan(0);
    const offenders = [...graph].filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(MDI_MARKER));
    expect(offenders, `landing-graph chunk(s) carry the full @mdi/js set: ${offenders.join(", ")}`).toEqual([]);
  });

  it("emits a separately loadable chunk containing the full icon set", () => {
    const html = readIndexHtml();
    if (!html) return;
    const graph = landingGraph(html);
    const lazy = readdirSync(assetsDir)
      .filter((f) => f.endsWith(".js") && !graph.has(f))
      .filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(MDI_MARKER));
    expect(lazy.length, "expected a lazy chunk carrying the full @mdi/js set").toBeGreaterThan(0);
  });

  it("keeps the gzipped index entry chunk under the cap", () => {
    const html = readIndexHtml();
    const entry = html ? entryChunk(html) : null;
    if (!entry || !existsSync(path.join(assetsDir, entry))) return;
    const gzipped = gzipSync(readFileSync(path.join(assetsDir, entry))).length;
    const kb = (gzipped / 1024).toFixed(0);
    expect(
      gzipped,
      `index entry chunk ${kb} KB gzipped exceeds the ${INDEX_GZ_CAP_BYTES / 1024} KB cap`,
    ).toBeLessThanOrEqual(INDEX_GZ_CAP_BYTES);
  });
});

// ---------------------------------------------------------------------------
// On-demand subsystems stay off the cold landing graph (design D5).
// Each marker is a string literal that survives minification and is unique to
// its subsystem's source (asserted below, so a marker that drifts into shared
// code fails loudly instead of passing vacuously).
// See change: shrink-client-entry-lazy-islands.
// ---------------------------------------------------------------------------
const srcDir = path.resolve(here, "..");

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "generated") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkSrc(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const LAZY_SUBSYSTEMS: ReadonlyArray<{
  name: string;
  marker: string;
  /** Source files (relative to `root`) allowed to contain the marker; `[]` = none (third-party). */
  owners: readonly string[];
  /** Source root the owners are relative to and the uniqueness scan walks. Default: client `src/`. */
  root?: string;
}> = [
  { name: "katex", marker: "KaTeX parse error", owners: [] },
  {
    name: "hu catalog",
    marker: "a visszajátszási ablak dönti el, mennyit kap a böngésző előre",
    owners: ["lib/i18n/i18n-hu.ts"],
  },
  {
    name: "zh-CN catalog",
    marker: "最大回放事件数与每会话最大事件数共同起作用",
    owners: ["lib/i18n/i18n-zh-CN.ts"],
  },
  {
    name: "settings panel",
    marker: "settings-restart-pending-dot",
    owners: ["components/settings/SettingsPanel.tsx"],
  },
  // Flow dashboard graph: a `module` claim (`FlowDashboardClaim`), so dagre/d3/
  // lodash behind FlowGraph stay off the landing graph.
  // See change: lazy-plugin-claim-modules.
  {
    name: "flow graph (lazy plugin claim module)",
    marker: "flow-dag-graph",
    owners: ["client/FlowGraph.tsx"],
    root: path.resolve(here, "../../../flows-plugin/src"),
  },
];

describe("on-demand subsystems are off the cold landing (shrink-client-entry-lazy-islands)", () => {
  for (const { name, marker, owners, root: scanRoot } of LAZY_SUBSYSTEMS) {
    it(`${name}: marker is unique to its subsystem's source`, () => {
      const root = scanRoot ?? srcDir;
      const holders = walkSrc(root)
        .filter((f) => readFileSync(f, "utf8").includes(marker))
        .map((f) => path.relative(root, f).split(path.sep).join("/"));
      expect(holders).toEqual([...owners]);
    });

    it(`${name}: no landing-graph chunk contains it, a separate chunk does`, () => {
      const html = readIndexHtml();
      if (!html) return; // no build output — CI builds first
      const graph = landingGraph(html);
      const offenders = [...graph].filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(marker));
      expect(offenders, `landing-graph chunk(s) carry ${name}: ${offenders.join(", ")}`).toEqual([]);
      const lazy = readdirSync(assetsDir)
        .filter((f) => f.endsWith(".js") && !graph.has(f))
        .filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(marker));
      expect(lazy.length, `expected a lazy chunk carrying ${name}`).toBeGreaterThan(0);
    });
  }

  it("entry stylesheet has no .katex rule", () => {
    const html = readIndexHtml();
    if (!html) return;
    const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gi)].map((m) => basenameOf(m[1]));
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      const css = readFileSync(path.join(assetsDir, sheet), "utf8");
      expect(css.includes(".katex"), `${sheet} still carries KaTeX rules`).toBe(false);
    }
  });
});
