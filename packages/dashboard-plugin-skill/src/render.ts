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
import { PLUGIN_HOST_API_VERSION } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-api.js";
import {
  MAX_MARKERS_PER_TYPE,
  markerPatternError,
  PROJECT_NAME_RE,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/project-markers.js";
import { SLOT_RENDER_ORDER, SLOT_SECTIONS } from "./templates/slot-sections.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * Manifest `hostApi` range a scaffolded plugin declares: `^<major>.<minor>.0` of the host API
 * it was scaffolded against (derived from `PLUGIN_HOST_API_VERSION`, never hand-maintained).
 * See change: decouple-plugins-from-core (D7).
 */
export function scaffoldHostApiRange(version: string = PLUGIN_HOST_API_VERSION): string {
  const [major, minor] = version.split(".");
  return `^${major}.${minor}.0`;
}
const TEMPLATE_DIR = path.join(__dirname, "templates");

/** Keyword that marks a package as a pi-dashboard plugin for registry search / `pi install`. */
const PLUGIN_KEYWORD = "pi-dashboard-plugin";

/** Dedicated client output dir of a runtime-delivered augmented project (never holds the server/bridge entry). */
const CLIENT_BUNDLE_DIR = "dist/client";

/** devDependencies `npm run build:dashboard` needs (added only when absent, so the author's pins win). */
const BUILD_DEV_DEPS: Record<string, string> = {
  "@types/react": "^19.0.0",
  react: "^19.0.0",
  vite: "^6.0.0",
};
const STYLES_DEV_DEPS: Record<string, string> = { "@tailwindcss/vite": "^4.1.0", tailwindcss: "^4.1.0" };

/** `pi-coding-agent`, or a scoped fork of it (`@scope/pi-coding-agent`). */
const PI_CODING_AGENT_RE = /^(?:@[^/]+\/)?pi-coding-agent$/;

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

/**
 * Embedded-app scope for mode `new` (the up-front batch answers).
 *  - `none`             no app is generated.
 *  - `global`           depth-1 content route, no folder entry.
 *  - `project-type`     folders of a project `type` (manifest `projectTypes` markers).
 *  - `project-specific` folders declaring project `id` (optionally written to `folderPath`).
 * See change: add-project-scoped-apps.
 */
export type AppScopeAnswers =
  | { scope: "none" }
  | { scope: "global" }
  | { scope: "project-type"; type: string; markers: string[] }
  | { scope: "project-specific"; projectId: string; folderPath?: string };

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
  /** Embedded app + scope; absent = `none`. */
  appScope?: AppScopeAnswers;
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
  /** Emit `clientStyles` (`dist/client/client.css`, utilities-only Tailwind). Default false. */
  styles?: boolean;
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

  const app = a.appScope && a.appScope.scope !== "none" ? a.appScope : null;
  const pkgJson = readTpl("plugin-package.json.tmpl")
    .replace(/\{\{ packageName \}\}/g, packageName)
    .replace(/\{\{ displayName \}\}/g, a.displayName)
    .replace(/\{\{ priority \}\}/g, String(a.priority))
    .replace(/\{\{ id \}\}/g, a.id)
    .replace(/\{\{ requiredApi \}\}/g, requiredApi)
    .replace(/\{\{ hostApi \}\}/g, scaffoldHostApiRange())
    .replace(/\{\{ runtimeVersionRange \}\}/g, runtimeVersionRange)
    .replace(/\{\{ sharedVersionRange \}\}/g, sharedVersionRange)
    .replace(/\{\{ exportsBlock \}\}/g, exportsBlock)
    .replace(/\{\{ serverManifestField \}\}/g, a.server ? `,\n    "server": "./src/server/index.ts"` : "")
    .replace(/\{\{ bridgeManifestField \}\}/g, a.bridge ? `,\n    "bridge": "./src/bridge/index.ts"` : "")
    .replace(/\{\{ configSchemaManifestField \}\}/g, a.configSchema ? `,\n    "configSchema": "./configSchema.json"` : "")
    .replace(/\{\{ claimsBlock \}\}/g, JSON.stringify(claims, null, 6).replace(/\n/g, "\n    "));
  sink.write("package.json", app ? withAppManifest(pkgJson, a, app) : pkgJson);

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
  let clientSource = readTpl("client.tsx.tmpl")
    .replace(/\{\{ displayName \}\}/g, a.displayName)
    .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName)
    .replace(/\{\{ slotSections \}\}/g, slotSections);
  if (app) {
    clientSource = withAppClient(clientSource, a, app);
    sink.write("src/app/app.tsx", fillApp(readTpl("app.tsx.tmpl"), a));
    sink.write("src/app/AppRoute.tsx", renderAppRoute(a, app));
  }
  sink.write("src/client.tsx", clientSource);

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
  validateAppScopeAnswers(a);
  const hasApp = !!a.appScope && a.appScope.scope !== "none";
  if (!Array.isArray(a.slots) || (a.slots.length === 0 && !hasApp)) {
    throw new Error("must claim at least one slot");
  }
  for (const s of a.slots) {
    if (!(s in SLOT_SECTIONS)) {
      throw new Error(`unknown slot id: ${s}`);
    }
  }
}

// ───────── embedded app (change: add-project-scoped-apps) ─────────

function validateAppScopeAnswers(a: NewModeAnswers): void {
  if (!a.appScope) return;
  const violations = validateAppScope(a.appScope, a.displayName);
  if (violations.length > 0) throw new Error(`invalid app scope:\n${violations.map((v) => `  - ${v}`).join("\n")}`);
}

function projectTypeViolations(scope: { type: string; markers: string[] }): string[] {
  const out: string[] = [];
  if (typeof scope.type !== "string" || !PROJECT_NAME_RE.test(scope.type)) {
    out.push(`type "${String(scope.type)}" must match ${PROJECT_NAME_RE.source}`);
  }
  if (!Array.isArray(scope.markers) || scope.markers.length < 1 || scope.markers.length > MAX_MARKERS_PER_TYPE) {
    out.push(`markers must hold 1 to ${MAX_MARKERS_PER_TYPE} patterns`);
    return out;
  }
  for (const m of scope.markers) {
    const v = markerPatternError(m);
    if (v !== null) out.push(`marker "${String(m)}" ${v}`);
  }
  return out;
}

function projectSpecificViolations(scope: { projectId: string; folderPath?: string }): string[] {
  const out: string[] = [];
  if (typeof scope.projectId !== "string" || !PROJECT_NAME_RE.test(scope.projectId)) {
    out.push(`project id "${String(scope.projectId)}" must match ${PROJECT_NAME_RE.source}`);
  }
  if (scope.folderPath !== undefined && scope.folderPath !== "" && !path.isAbsolute(scope.folderPath)) {
    out.push(`folder path "${scope.folderPath}" must be absolute`);
  }
  return out;
}

/** Every violation of the app-scope answers, using the rules the manifest validator and the identity file apply. */
export function validateAppScope(scope: AppScopeAnswers, displayName = ""): string[] {
  if (scope.scope === "none") return [];
  const out: string[] = [];
  if (/[<>{}"'`\\$*]/.test(displayName)) {
    out.push(`display name "${displayName}" must not contain any of < > { } " ' \` \\ $ * when an app is generated`);
  }
  if (scope.scope === "project-type") out.push(...projectTypeViolations(scope));
  else if (scope.scope === "project-specific") out.push(...projectSpecificViolations(scope));
  return out;
}

type ActiveAppScope = Exclude<AppScopeAnswers, { scope: "none" }>;

const APP_DEPS: Record<string, string> = {
  "@blackbelt-technology/pi-dashboard-app-kit": "^0.x",
  wouter: "^3.9.0",
};

/** Add the app claims, deps and (project-type) `projectTypes` to the rendered package.json. */
function withAppManifest(pkgJson: string, a: NewModeAnswers, app: ActiveAppScope): string {
  const pkg = JSON.parse(pkgJson) as Record<string, unknown> & {
    dependencies: Record<string, string>;
    "pi-dashboard-plugin": { claims: Array<Record<string, unknown>>; projectTypes?: unknown };
  };
  Object.assign(pkg.dependencies, APP_DEPS);
  const manifest = pkg["pi-dashboard-plugin"];
  const pascal = pascalCase(a.id);
  if (app.scope === "global") {
    manifest.claims.push({
      slot: "shell-overlay-route",
      component: `${pascal}AppRoute`,
      path: `/${a.id}/*?`,
      depth: 1,
      presentation: "content",
    });
  } else {
    manifest.claims.push({
      slot: "shell-overlay-route",
      component: `${pascal}AppRoute`,
      path: `/folder/:encodedCwd/${a.id}/*?`,
      depth: 2,
      parentPath: "/folder/:encodedCwd",
      presentation: "content",
    });
    manifest.claims.push({
      slot: "sidebar-folder-section",
      component: `${pascal}FolderEntry`,
      predicate: `is${pascal}Folder`,
    });
    if (app.scope === "project-type") manifest.projectTypes = [{ type: app.type, markers: app.markers }];
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** Splice the app's lazy route (and folder entry) into the client entry. */
function withAppClient(client: string, a: NewModeAnswers, app: ActiveAppScope): string {
  const pascal = pascalCase(a.id);
  const folderScoped = app.scope !== "global";
  const runtimeImports = [
    ...(app.scope === "project-type" ? ["folderHasProjectType"] : app.scope === "project-specific" ? ["folderHasProjectId"] : []),
    ...(folderScoped ? ["useEmbeddedAppShell"] : []),
  ];
  const imports = [
    ...(runtimeImports.length ? [`import { ${runtimeImports.join(", ")} } from "@blackbelt-technology/dashboard-plugin-runtime";`] : []),
    `import { lazy } from "react";`,
    ...(folderScoped ? [`import { useLocation } from "wouter";`] : []),
  ].join("\n");
  const anchor = `import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props";`;
  if (!client.includes(anchor)) throw new Error("client.tsx.tmpl lost its SlotProps import anchor");
  const withImports = client.replace(anchor, `${anchor}\n${imports}`);

  let folderEntry = "";
  if (folderScoped) {
    const isType = app.scope === "project-type";
    folderEntry = readTpl("app-folder-entry.tsx.tmpl")
      .replace(/\{\{ predicateDoc \}\}/g, isType ? `resolves to type \`${app.type}\`` : `declare project id \`${(app as { projectId: string }).projectId}\``)
      .replace(
        /\{\{ predicateFactory \}\}/g,
        isType ? `folderHasProjectType("${app.type}")` : `folderHasProjectId("${(app as { projectId: string }).projectId}")`,
      )
      .replace(/\{\{ Pascal \}\}/g, pascal)
      .replace(/\{\{ id \}\}/g, a.id)
      .replace(/\{\{ displayName \}\}/g, a.displayName);
  }
  const section = readTpl("app-client-section.tsx.tmpl")
    .replace(/\{\{ Pascal \}\}/g, pascal)
    .replace(/\{\{ folderEntry \}\}/g, folderEntry);
  return `${withImports.replace(/\n+$/, "\n")}${section}`.replace(/\n+$/, "\n");
}

function fillApp(tpl: string, a: NewModeAnswers): string {
  return tpl.replace(/\{\{ id \}\}/g, a.id).replace(/\{\{ displayName \}\}/g, a.displayName);
}

/** The lazy route module; scoped apps pass `projectScope` and never a `standaloneUrl`. */
function renderAppRoute(a: NewModeAnswers, app: ActiveAppScope): string {
  let routePath: string;
  let scopeNote: string;
  let routeBody: string;
  if (app.scope === "global") {
    routePath = `\`/${a.id}/*?\``;
    scopeNote = "Global app: no folder, no project scope.";
    routeBody = `  void params;\n  return <EmbeddedApp app={app} basePath="/${a.id}" onBack={onBack} />;`;
  } else {
    const scope = app.scope === "project-type" ? `{ type: "${app.type}" }` : `{ id: "${(app as { projectId: string }).projectId}" }`;
    routePath = `\`/folder/:encodedCwd/${a.id}/*?\``;
    scopeNote = "Project-scoped: not mounted on a folder that does not match `projectScope`; scoped apps have no standalone host.";
    routeBody = [
      `  const encodedCwd = params.encodedCwd ?? "";`,
      `  return (`,
      `    <EmbeddedApp`,
      `      app={app}`,
      `      basePath={\`/folder/\${encodedCwd}/${a.id}\`}`,
      `      folderParam={encodedCwd}`,
      `      projectScope={${scope}}`,
      `      onBack={onBack}`,
      `    />`,
      `  );`,
    ].join("\n");
  }
  return fillApp(readTpl("app-route.tsx.tmpl"), a)
    .replace(/\{\{ routePath \}\}/g, routePath)
    .replace(/\{\{ scopeNote \}\}/g, scopeNote)
    .replace(/\{\{ routeBody \}\}/g, routeBody);
}

// ───────── augment mode ─────────

function renderAugment(a: AugmentModeAnswers, sink: WriteSink): void {
  const requiredApi = a.requiredApi ?? "^0.x";
  const runtimeVersionRange = a.runtimeVersionRange ?? "^0.x";
  const sharedVersionRange = a.sharedVersionRange ?? "^0.x";

  // Read the existing package.json from disk.
  const pkgPath = path.join(a.outDir, "package.json");
  if (!fs.existsSync(pkgPath)) throw new Error(`augment: no package.json at ${a.outDir} — not a pi extension`);
  const existing = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  if (!declaresPiCodingAgent(existing)) {
    throw new Error("augment: package.json declares no `pi-coding-agent` dependency or peerDependency — not a pi extension; nothing was written");
  }

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
    hostApi: scaffoldHostApiRange(),
    client: "./src/dashboard/client.tsx",
    // Runtime-delivered (an augmented project lives outside the monorepo): the prebuilt bundle in its own dir.
    clientBundle: `./${CLIENT_BUNDLE_DIR}/index.js`,
  };
  if (a.styles) manifest.clientStyles = `./${CLIENT_BUNDLE_DIR}/client.css`;
  if (a.addServer) manifest.server = "./src/dashboard/server.ts";
  manifest.claims = claims;
  existing["pi-dashboard-plugin"] = manifest;
  // Keep the author's keywords; add ours once.
  const keywords = Array.isArray(existing.keywords) ? (existing.keywords as unknown[]) : [];
  if (!keywords.includes(PLUGIN_KEYWORD)) existing.keywords = [...keywords, PLUGIN_KEYWORD];

  addDashboardBuild(existing, deps, a.styles === true);

  sink.write("package.json", JSON.stringify(existing, null, 2) + "\n");
  sink.write(
    "vite.dashboard.config.ts",
    readTpl("vite.dashboard.config.ts.tmpl").replace(/\{\{ stylesLine \}\}/g, a.styles ? "" : "\n  styles: false,"),
  );

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

/** Wire `npm run build:dashboard` (SDK preset), its devDependencies and the published file list into `pkg`. */
function addDashboardBuild(pkg: Record<string, unknown>, deps: Record<string, string>, styles: boolean): void {
  pkg.scripts = {
    ...((pkg.scripts as Record<string, string> | undefined) ?? {}),
    "build:dashboard": "vite build --config vite.dashboard.config.ts --configLoader runner",
  };
  const devDeps = { ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}) };
  for (const [name, range] of Object.entries({ ...BUILD_DEV_DEPS, ...(styles ? STYLES_DEV_DEPS : {}) })) {
    if (!(name in devDeps) && !(name in deps)) devDeps[name] = range;
  }
  pkg.devDependencies = Object.fromEntries(Object.entries(devDeps).sort(([x], [y]) => x.localeCompare(y)));
  // A published package must carry the built bundle and the entries; only touch an explicit allow-list.
  if (Array.isArray(pkg.files)) {
    const files = pkg.files as string[];
    for (const f of [`${CLIENT_BUNDLE_DIR}/`, "src/dashboard/"]) if (!files.includes(f)) files.push(f);
  }
}

function declaresPiCodingAgent(pkg: Record<string, unknown>): boolean {
  return ["dependencies", "peerDependencies"].some((field) => {
    const group = pkg[field];
    return typeof group === "object" && group !== null && Object.keys(group).some((n) => PI_CODING_AGENT_RE.test(n));
  });
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
