/**
 * Registry of the ArtCraft Crafting Apps (github.com/storytold, Apache-2.0).
 *
 * One readonly table drives provisioning (repo, host → asset names, glibc
 * floor), the MCP proxy (confinement, tool-count class, bridge flag) and the
 * skills (CLI dialect, discovery commands). Values come from the 2026-10 spike
 * and the cross-platform probes recorded in the change's design.md.
 *
 * See change: add-craft-apps-core (design D1).
 */

export const APP_IDS = [
  "photocraft",
  "vectorcraft",
  "filmcraft",
  "lightcraft",
  "pdfcraft",
  "effectcraft",
  "designcraft",
  "figcraft",
  "wordcraft",
  "soundcraft",
  "deckcraft",
  "cadcraft",
  "gridcraft",
] as const;

export type CraftAppId = (typeof APP_IDS)[number];

/** `<platform>/<arch>` as reported by Node (`process.platform` / `process.arch`). */
export type HostKey =
  | "darwin/x64"
  | "darwin/arm64"
  | "linux/x64"
  | "linux/arm64"
  | "linux/riscv64"
  | "win32/x64"
  | "win32/arm64"
  | "win32/ia32"
  | "freebsd/x64";

/** Asset name templates for one host; `{v}` is the normalised version. First existing candidate wins. */
export type AssetPatterns = Partial<Record<HostKey, readonly string[]>>;

/**
 * How the app's CLI spells discovery and execution. Informational: skills and the
 * drift check read it; the provisioner and proxy never branch on it.
 */
export interface CliDialect {
  /** Arguments that print the command list. */
  list: readonly string[];
  /** Arguments that describe one command (`<id>` placeholder), when the CLI has them. */
  describe?: readonly string[];
  /** One-line shape of the batch/run entry point. */
  run: string;
}

/**
 * How the MCP server confines file access: `automation-roots` = `--automation-read-root` +
 * `--automation-write-root`; `root` = a single `--root` (PdfCraft); `false` = none advertised.
 */
export type Confinement = false | "automation-roots" | "root";

export interface McpPolicy {
  /** Confinement mechanism the server advertises (probe 0.4, latest releases), or `false`. */
  confinement: Confinement;
  /** `--compact` lists only helper tools (every command stays reachable via a `run`/`tool_call` tool). */
  compactFlag?: "--compact";
  /** `large` = hundreds of tools; registering floods the model context. */
  toolClass: "small" | "large";
  /** Number of MCP tools the server advertises (spike, `tools/list`). */
  tools: number;
  /** Flag that attaches the server to a live desktop app (always rejected by the proxy). */
  bridgeFlag?: "--bridge" | "--connect";
}

export interface CraftApp {
  id: CraftAppId;
  /** Display name, also the desktop app bundle name. */
  name: string;
  /** One-line purpose for `pi-craft apps`. */
  purpose: string;
  repo: `storytold/${string}`;
  /** CLI binary basename, without `.exe`. */
  cli: string;
  assets: AssetPatterns;
  dialect: CliDialect;
  mcp: McpPolicy;
  /** Minimum glibc on Linux, `[major, minor]`. */
  glibcMin: readonly [number, number];
  /**
   * Pinned release of the browser (Trunk/eframe) build, `<id>-web-<ver>.zip`. Present only for apps whose
   * web build passed its spike (the claim ship gate); never "latest". See change: edit-office-in-pane-with-craft-web.
   */
  webVersion?: string;
  /** First-overwrite notice shown by the editor pane for this app's web build (≤ 300 chars). */
  webFidelityNote?: string;
}

/** Optional browser-build facts of an app (`CraftApp.webVersion` / `webFidelityNote`). */
export interface WebBuildInfo {
  webVersion: string;
  webFidelityNote: string;
}

const HOSTS_MACOS: HostKey[] = ["darwin/x64", "darwin/arm64"];
const LINUX: Record<string, string> = { "linux/x64": "x86_64", "linux/arm64": "aarch64", "linux/riscv64": "riscv64" };
const WINDOWS: Record<string, string> = { "win32/x64": "x64", "win32/arm64": "arm64", "win32/ia32": "x86" };

/** Every app publishes the same release layout (spike: 13/13 identical). */
function standardAssets(id: string): AssetPatterns {
  const out: Record<string, readonly string[]> = {};
  for (const h of HOSTS_MACOS) out[h] = [`${id}-cli-{v}-macos-universal.zip`];
  for (const [h, arch] of Object.entries(LINUX)) out[h] = [`${id}-cli-{v}-linux-${arch}.tar.gz`, `${id}-{v}-linux-${arch}.tar.gz`];
  for (const [h, arch] of Object.entries(WINDOWS)) out[h] = [`${id}-{v}-windows-${arch}-portable.zip`];
  out["freebsd/x64"] = [`${id}-{v}-freebsd-x86_64.tar.gz`];
  return out;
}

function app(
  id: CraftAppId,
  name: string,
  purpose: string,
  dialect: CliDialect,
  mcp: McpPolicy,
  glibcMin: readonly [number, number] = [2, 35],
  web?: WebBuildInfo,
): CraftApp {
  return { id, name, purpose, repo: `storytold/${id}`, cli: `${id}-cli`, assets: standardAssets(id), dialect, mcp, glibcMin, ...web };
}

const COMMANDS_JSON: CliDialect["list"] = ["commands", "--json"];

export const CRAFT_APPS: readonly CraftApp[] = [
  app(
    "photocraft",
    "PhotoCraft",
    "raster image editing (layers, adjustments, filters, content-aware fill)",
    { list: COMMANDS_JSON, run: "run (FILE | --new JSON) --cmd ID [--params JSON]… --out OUT | batch" },
    { confinement: "automation-roots", toolClass: "small", tools: 25, bridgeFlag: "--bridge" },
  ),
  app(
    "vectorcraft",
    "VectorCraft",
    "vector illustration and SVG/PDF export",
    { list: COMMANDS_JSON, run: "run [--in FILE] --cmd ID [--params JSON]… [--export OUT]" },
    { confinement: "automation-roots", toolClass: "small", tools: 32, bridgeFlag: "--connect" },
  ),
  app(
    "filmcraft",
    "FilmCraft",
    "non-linear video editing: import, sequence, timeline, export",
    { list: COMMANDS_JSON, describe: ["describe", "<id>"], run: "[--project P --save] exec <id> [key=value…] | run script.jsonl [--keep-going]" },
    { confinement: false, toolClass: "small", tools: 17, bridgeFlag: "--bridge" },
  ),
  app(
    "lightcraft",
    "LightCraft",
    "RAW photo development (exposure, colour, denoise, merge)",
    { list: COMMANDS_JSON, run: "render IN -o OUT [--set CONTROL=VALUE…] | run [--import P | --demo] <cmd> key=value…" },
    { confinement: false, compactFlag: "--compact", toolClass: "large", tools: 330, bridgeFlag: "--connect" },
  ),
  app(
    "pdfcraft",
    "PdfCraft",
    "PDF combine, split, extract, edit, render and audit",
    { list: ["tools"], run: "<combine|split|extract|edit|render|text|audit> … | run" },
    { confinement: "root", compactFlag: "--compact", toolClass: "large", tools: 163 },
    undefined,
    {
      webVersion: "0.9.0",
      webFidelityNote: "PdfCraft appends your changes as an incremental update and keeps the original bytes. A copy is the safe way to compare.",
    },
  ),
  app(
    "effectcraft",
    "EffectCraft",
    "motion graphics and compositing (comps, text, effects, alpha render)",
    { list: COMMANDS_JSON, run: "run <id> <json> [<id> <json>…] | exec <id> --params JSON | render" },
    { confinement: "automation-roots", toolClass: "small", tools: 27, bridgeFlag: "--bridge" },
  ),
  app(
    "designcraft",
    "DesignCraft",
    "page layout and desktop publishing (stories, styles, PDF export)",
    { list: ["commands"], describe: ["describe", "<id>"], run: "run [--in FILE | --sample] --cmd ID[=JSON]… [--export OUT]" },
    { confinement: false, toolClass: "small", tools: 25, bridgeFlag: "--connect" },
    undefined,
    {
      webVersion: "0.9.0",
      webFidelityNote: "Saves are rewritten by DesignCraft with its assets embedded; content it does not support may change. A copy is the safe way to compare.",
    },
  ),
  app(
    "figcraft",
    "FigCraft",
    "UI and interface design (frames, components, export)",
    { list: COMMANDS_JSON, run: "run SCRIPT.jsonl [--in FILE] [--out FILE] | render | export" },
    { confinement: false, toolClass: "small", tools: 18 },
  ),
  app(
    "wordcraft",
    "WordCraft",
    "word processing: DOCX/ODT/RTF documents, conversion, PDF export",
    { list: COMMANDS_JSON, run: "run [--file F] --cmd 'id={json}'… [--save OUT] | convert | render | text" },
    { confinement: "automation-roots", toolClass: "small", tools: 16, bridgeFlag: "--connect" },
    undefined,
    {
      webVersion: "0.8.0",
      webFidelityNote:
        "Saves are re-rendered by WordCraft's own writer; formatting of unsupported features may change. A copy is the safe way to compare.",
    },
  ),
  app(
    "soundcraft",
    "SoundCraft",
    "audio editing, mixing and bounce (loudness and peak reporting)",
    { list: ["commands"], describe: ["describe", "<id>"], run: "run --cmd ID[=JSON]… [--bounce OUT] | script" },
    { confinement: "automation-roots", toolClass: "small", tools: 17, bridgeFlag: "--connect" },
    [2, 34], // probe 0.1: highest glibc symbol 2.34 (all other apps 2.35)
    {
      webVersion: "0.8.0",
      webFidelityNote: "Saves are rewritten by SoundCraft with the session's audio files; content it does not support may change. A copy is the safe way to compare.",
    },
  ),
  app(
    "deckcraft",
    "DeckCraft",
    "presentation slides and export",
    { list: ["commands"], describe: ["describe", "<id>"], run: "run [--in FILE] [--cmd ID[=JSON]…] [--save OUT] [--export OUT] | render | convert" },
    { confinement: false, toolClass: "small", tools: 25, bridgeFlag: "--connect" },
  ),
  app(
    "cadcraft",
    "CADCraft",
    "2D/3D CAD drawings (DXF/DWG) and conversion",
    { list: ["commands"], run: "run [FILE] --cmd 'id {json}'… [--save OUT.dxf] [--export OUT] | convert | info" },
    { confinement: false, toolClass: "small", tools: 12, bridgeFlag: "--connect" },
    undefined,
    {
      webVersion: "0.8.0",
      webFidelityNote: "Saves are rewritten by CADCraft as DXF R2000; entities it does not support may change. A copy is the safe way to compare.",
    },
  ),
  app(
    "gridcraft",
    "GridCraft",
    "spreadsheets: formulas, evaluation, conversion",
    { list: COMMANDS_JSON, run: "run [--in FILE] --cmd 'id={json}'… [--out FILE] | eval | check | convert" },
    { confinement: false, toolClass: "small", tools: 21, bridgeFlag: "--connect" },
    undefined,
    {
      webVersion: "0.8.0",
      webFidelityNote: "Saves are rewritten by GridCraft's own writer; formulas, charts or formatting it does not support may change. A copy is the safe way to compare.",
    },
  ),
];

const BY_ID: ReadonlyMap<string, CraftApp> = new Map(CRAFT_APPS.map((a) => [a.id, a]));

export function isAppId(id: string): id is CraftAppId {
  return BY_ID.has(id);
}

/** Registry row for `id`; unknown ids throw an error that lists the supported ids (no I/O). */
export function getApp(id: string): CraftApp {
  const found = BY_ID.get(id);
  if (!found) throw new UnknownAppError(id);
  return found;
}

export class UnknownAppError extends Error {
  override name = "UnknownAppError";
  constructor(id: string) {
    super(`unknown craft app "${id}"; supported apps: ${APP_IDS.join(", ")}`);
  }
}

/** Upper-cased id used as the env-var prefix, e.g. `FILMCRAFT` for `FILMCRAFT_BIN`. */
export function envPrefix(app: CraftApp): string {
  return app.id.toUpperCase();
}

/** Binary file name for the host (`<cli>.exe` on Windows). */
export function binName(app: CraftApp, platform: string): string {
  return platform === "win32" ? `${app.cli}.exe` : app.cli;
}

/** Desktop executable shipped beside the CLI in portable archives (deleted after extraction). */
export function desktopName(app: CraftApp, platform: string): string {
  return platform === "win32" ? `${app.id}.exe` : app.id;
}

export function hostKey(platform: string, arch: string): HostKey | undefined {
  const key = `${platform}/${arch}`;
  return key in standardAssets("x") ? (key as HostKey) : undefined;
}
