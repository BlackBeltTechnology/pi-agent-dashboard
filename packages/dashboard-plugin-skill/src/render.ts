/**
 * Template renderer for `dashboard-plugin-scaffold`.
 *
 * Two modes:
 *   - `new`     → write a fresh packages/<id>-plugin/ tree under outDir.
 *   - `augment` → mutate package.json at outDir + create src/dashboard/*.
 *
 * Pure-ish: takes typed answers + a filesystem-write hook. Test exercises
 * the renderer with an in-memory write hook to snapshot the tree.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { SLOT_RENDER_ORDER, SLOT_SECTIONS } from "./templates/slot-sections.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, "templates");

/** Slot ids accepted by the renderer (the 10 React slots). */
export type SlotId =
  | "sidebar-folder-section"
  | "session-card-badge"
  | "session-card-action-bar"
  | "content-view"
  | "content-header-sticky"
  | "content-inline-footer"
  | "anchored-popover"
  | "command-route"
  | "settings-section"
  | "tool-renderer";

export interface NewModeAnswers {
  mode: "new";
  /** Kebab-case id; final dir is `packages/<id>-plugin/`. */
  id: string;
  displayName: string;
  /** Default 100. */
  priority: number;
  /** Slots the user picked in the multiselect. */
  slots: SlotId[];
  /** Scaffold src/server/index.ts? */
  server: boolean;
  /** Scaffold src/bridge/index.ts? */
  bridge: boolean;
  /** Scaffold configSchema.json? */
  configSchema: boolean;
  /** Absolute path to write into. */
  outDir: string;
  /** Optional: scope the package.json `name` (defaults to `@blackbelt-technology/<id>-plugin`). */
  packageScope?: string;
  /** Versions for the SDK deps; default to "^0.x" so we don't hardwire releases. */
  runtimeVersionRange?: string;
  sharedVersionRange?: string;
  /** Required-API range surfaced in the manifest. */
  requiredApi?: string;
}

export interface AugmentProposal {
  file: string;
  line: number;
  callsite: string;
  mappedSlot: SlotId;
  componentSuggestion?: string;
  notes?: string;
}

export interface AugmentModeAnswers {
  mode: "augment";
  /** Project root to mutate (the user's pi-extension cwd). */
  outDir: string;
  /** User-confirmed proposals from the per-callsite multiselect. */
  confirmedProposals: AugmentProposal[];
  /** Add a server entry? Driven by the analyzer. */
  addServer: boolean;
  /** Optional override for the SDK dep version range. */
  runtimeVersionRange?: string;
  sharedVersionRange?: string;
  requiredApi?: string;
}

export type Answers = NewModeAnswers | AugmentModeAnswers;

/** A virtual filesystem write — the test wires an in-memory map. */
export interface WriteSink {
  write(relativePath: string, content: string): void;
}

export class InMemorySink implements WriteSink {
  readonly files = new Map<string, string>();
  write(relativePath: string, content: string): void {
    this.files.set(relativePath.replace(/\\/g, "/"), content);
  }
}

export class FsSink implements WriteSink {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }
  write(relativePath: string, content: string): void {
    const abs = path.join(this.root, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
}

/** Pure entry point. Returns the sink for inspection. */
export function render(answers: Answers, sink: WriteSink = new InMemorySink()): WriteSink {
  if (answers.mode === "new") {
    renderNew(answers, sink);
  } else {
    renderAugment(answers, sink);
  }
  return sink;
}

// ───────── new mode ─────────

function renderNew(a: NewModeAnswers, sink: WriteSink): void {
  validateNew(a);

  const packageScope = a.packageScope ?? "@blackbelt-technology";
  const packageName = `${packageScope}/${a.id}-plugin`;
  const runtimeVersionRange = a.runtimeVersionRange ?? "^0.x";
  const sharedVersionRange = a.sharedVersionRange ?? "^0.x";
  const requiredApi = a.requiredApi ?? "^0.x";
  const ConfigTypeName = pascalCase(a.id) + "Config";

  // package.json
  const claims = buildClaims(a.slots, a.id);
  const exportsBlock = buildExportsBlock(a.server, a.bridge);

  const pkgJson = readTpl("plugin-package.json.tmpl")
    .replace(/\{\{ packageName \}\}/g, packageName)
    .replace(/\{\{ displayName \}\}/g, a.displayName)
    .replace(/\{\{ priority \}\}/g, String(a.priority))
    .replace(/\{\{ id \}\}/g, a.id)
    .replace(/\{\{ requiredApi \}\}/g, requiredApi)
    .replace(/\{\{ runtimeVersionRange \}\}/g, runtimeVersionRange)
    .replace(/\{\{ sharedVersionRange \}\}/g, sharedVersionRange)
    .replace(/\{\{ exportsBlock \}\}/g, exportsBlock)
    .replace(/\{\{ serverManifestField \}\}/g, a.server ? `,\n    "server": "./src/server/index.ts"` : "")
    .replace(/\{\{ bridgeManifestField \}\}/g, a.bridge ? `,\n    "bridge": "./src/bridge/index.ts"` : "")
    .replace(/\{\{ configSchemaManifestField \}\}/g, a.configSchema ? `,\n    "configSchema": "./configSchema.json"` : "")
    .replace(/\{\{ claimsBlock \}\}/g, JSON.stringify(claims, null, 6).replace(/\n/g, "\n    "));
  sink.write("package.json", pkgJson);

  // tsconfig + vitest config
  sink.write("tsconfig.json", readTpl("tsconfig.json.tmpl"));
  sink.write("vitest.config.ts", readTpl("vitest.config.ts.tmpl"));

  // configSchema.json (optional)
  if (a.configSchema) {
    sink.write(
      "configSchema.json",
      readTpl("configSchema.json.tmpl")
        .replace(/\{\{ packageName \}\}/g, packageName)
        .replace(/\{\{ displayName \}\}/g, a.displayName)
        .replace(/\{\{ id \}\}/g, a.id),
    );
  }

  // README
  const claimsList = a.slots.map((s) => `- \`${s}\` → \`${SLOT_SECTIONS[s]?.componentName ?? "?"}\``).join("\n");
  sink.write(
    "README.md",
    readTpl("README.md.tmpl")
      .replace(/\{\{ packageName \}\}/g, packageName)
      .replace(/\{\{ displayName \}\}/g, a.displayName)
      .replace(/\{\{ id \}\}/g, a.id)
      .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName)
      .replace(/\{\{ claimsList \}\}/g, claimsList || "(none)"),
  );

  // src/client.tsx
  const slotSections = renderSlotSections(a.slots, a.id, ConfigTypeName);
  sink.write(
    "src/client.tsx",
    readTpl("client.tsx.tmpl")
      .replace(/\{\{ displayName \}\}/g, a.displayName)
      .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName)
      .replace(/\{\{ slotSections \}\}/g, slotSections),
  );

  // src/server/index.ts (optional)
  if (a.server) {
    sink.write(
      "src/server/index.ts",
      readTpl("server-index.ts.tmpl")
        .replace(/\{\{ displayName \}\}/g, a.displayName)
        .replace(/\{\{ id \}\}/g, a.id)
        .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName),
    );
  }

  // src/bridge/index.ts (optional)
  if (a.bridge) {
    sink.write(
      "src/bridge/index.ts",
      readTpl("bridge-index.ts.tmpl")
        .replace(/\{\{ displayName \}\}/g, a.displayName)
        .replace(/\{\{ id \}\}/g, a.id)
        .replace(/\{\{ ToolName \}\}/g, pascalCase(a.id) + "Tool"),
    );
  }

  // test/index.test.ts
  sink.write(
    "test/index.test.ts",
    readTpl("test-index.test.ts.tmpl")
      .replace(/\{\{ displayName \}\}/g, a.displayName)
      .replace(/\{\{ packageName \}\}/g, packageName)
      .replace(/\{\{ id \}\}/g, a.id),
  );
}

function buildExportsBlock(server: boolean, bridge: boolean): string {
  const entries: Record<string, string> = { "./client": "./src/client.tsx" };
  if (server) entries["./server"] = "./src/server/index.ts";
  if (bridge) entries["./bridge"] = "./src/bridge/index.ts";
  // 4-space indent, then a tail indent of 2 to align inside the package.json template.
  const json = JSON.stringify(entries, null, 4);
  return json.replace(/\n/g, "\n  ");
}

function buildClaims(slots: SlotId[], id: string): Array<Record<string, unknown>> {
  // Stable order matching SLOT_RENDER_ORDER for deterministic output.
  const ordered = SLOT_RENDER_ORDER.filter((s) => slots.includes(s as SlotId)) as SlotId[];
  const out: Array<Record<string, unknown>> = [];
  for (const slot of ordered) {
    const sec = SLOT_SECTIONS[slot];
    if (!sec) continue;
    const claim: Record<string, unknown> = { slot, component: sec.componentName };
    if (slot === "command-route") claim.command = `/${id}`;
    if (slot === "anchored-popover") claim.trigger = `${id}-popover`;
    if (slot === "tool-renderer") claim.toolName = `${pascalCase(id)}Tool`;
    if (slot === "settings-section") claim.config = { tab: "general" };
    out.push(claim);
  }
  return out;
}

function renderSlotSections(slots: SlotId[], id: string, configTypeName: string): string {
  const ordered = SLOT_RENDER_ORDER.filter((s) => slots.includes(s as SlotId)) as SlotId[];
  return ordered
    .map((s) => SLOT_SECTIONS[s]?.render({ id, configTypeName }) ?? "")
    .join("\n")
    .trim() + "\n";
}

function validateNew(a: NewModeAnswers): void {
  if (!/^[a-z][a-z0-9-]*$/.test(a.id)) {
    throw new Error(`id "${a.id}" must be kebab-case (^[a-z][a-z0-9-]*$)`);
  }
  if (!Number.isInteger(a.priority) || a.priority < 0) {
    throw new Error(`priority must be a non-negative integer; got ${a.priority}`);
  }
  if (!Array.isArray(a.slots) || a.slots.length === 0) {
    throw new Error("must claim at least one slot");
  }
  for (const s of a.slots) {
    if (!(s in SLOT_SECTIONS)) {
      throw new Error(`unknown slot id: ${s}`);
    }
  }
}

// ───────── augment mode ─────────

function renderAugment(a: AugmentModeAnswers, sink: WriteSink): void {
  const requiredApi = a.requiredApi ?? "^0.x";
  const runtimeVersionRange = a.runtimeVersionRange ?? "^0.x";
  const sharedVersionRange = a.sharedVersionRange ?? "^0.x";

  // Read the existing package.json from disk.
  const pkgPath = path.join(a.outDir, "package.json");
  const existing = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;

  // Derive a plugin id from the package name (strip scope, strip leading "pi-").
  const pkgName = String(existing.name ?? "");
  const id = pkgName
    .replace(/^@[^/]+\//, "")
    .replace(/^pi-/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "augmented-plugin";
  const displayName = String(existing.description ?? id);

  // Derive slots from confirmed proposals; collapse duplicates.
  const slots = Array.from(new Set(a.confirmedProposals.map((p) => p.mappedSlot)));
  const claims = buildClaims(slots as SlotId[], id);
  // Fold per-proposal componentSuggestion when provided.
  for (const p of a.confirmedProposals) {
    const claim = claims.find((c) => c.slot === p.mappedSlot);
    if (claim && p.componentSuggestion) claim.component = p.componentSuggestion;
  }

  // Merge dependencies — preserve existing, add SDK deps in alpha order.
  const deps: Record<string, string> = { ...((existing.dependencies as Record<string, string>) ?? {}) };
  deps["@blackbelt-technology/dashboard-plugin-runtime"] = runtimeVersionRange;
  deps["@blackbelt-technology/pi-dashboard-shared"] = sharedVersionRange;
  const sortedDeps: Record<string, string> = {};
  for (const k of Object.keys(deps).sort()) sortedDeps[k] = deps[k];
  existing.dependencies = sortedDeps;

  // Merge exports.
  const existingExports = (existing.exports as Record<string, unknown>) ?? {};
  existingExports["./client"] = "./src/dashboard/client.tsx";
  if (a.addServer) existingExports["./server"] = "./src/dashboard/server.ts";
  existing.exports = existingExports;

  // Inject manifest field at top level.
  const manifest: Record<string, unknown> = {
    id,
    displayName,
    priority: 100,
    requiredApi,
    client: "./src/dashboard/client.tsx",
  };
  if (a.addServer) manifest.server = "./src/dashboard/server.ts";
  manifest.claims = claims;
  existing["pi-dashboard-plugin"] = manifest;

  sink.write("package.json", JSON.stringify(existing, null, 2) + "\n");

  // Scaffold src/dashboard/client.tsx with stubs for each confirmed claim.
  const ConfigTypeName = pascalCase(id) + "Config";
  const slotSections = renderSlotSections(slots as SlotId[], id, ConfigTypeName);
  sink.write(
    "src/dashboard/client.tsx",
    readTpl("client.tsx.tmpl")
      .replace(/\{\{ displayName \}\}/g, displayName)
      .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName)
      .replace(/\{\{ slotSections \}\}/g, slotSections),
  );

  // Server entry only if needed.
  if (a.addServer) {
    sink.write(
      "src/dashboard/server.ts",
      readTpl("server-index.ts.tmpl")
        .replace(/\{\{ displayName \}\}/g, displayName)
        .replace(/\{\{ id \}\}/g, id)
        .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName),
    );
  }
}

// ───────── helpers ─────────

function readTpl(name: string): string {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
}

function pascalCase(kebab: string): string {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}
