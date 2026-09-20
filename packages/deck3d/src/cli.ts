/**
 * deck3d CLI entry — `parse | validate | render | build | check | snapshot`,
 * plus the `fx` and `props` sub-trees.
 *
 * Exit codes: 0 success, 1 failure (with a one-line reason on stderr), 2 usage.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DeckIR, Palette } from "./ir/types.js";
import { formatIssue, validate } from "./ir/validate.js";
import { type DeriveOptions, parseDeck } from "./parse/derive.js";
import { pkgRoot } from "./util/paths.js";

export const VERSION = "0.1.0";

/** Named palettes accepted by `--palette`; mirrors the schema enum. */
const PALETTE_IDS: Palette[] = ["blackbelt", "zenit", "dapp", "midnight", "ember", "arctic", "forest", "mono", "neon", "custom"];

export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export const defaultIO: CliIO = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

export const HELP = `deck3d — deterministic markdown → self-contained 3D presentation

Usage: deck3d <command> [options]

Commands:
  parse <deck.md> [-o deck.json] [--fresh]   Markdown (+ mermaid) → Deck IR
  validate <deck.json>                       Schema + derived-edit checks
  render <deck.json> -o deck.html            Deck IR → self-contained HTML
  build <deck.md> -o deck.html               parse → render (writes .json beside it)
  serve <deck.md> [--port n] [--check]       Watch + rebuild + live reload; panel saves overrides to disk
  check <deck.html> [--style]                Measure fit/legibility in headless chromium
  snapshot <deck.html> [--slide n] [-o png]  Screenshot a slide to PNG
  fx <list|preview>                          Inspect the effects corpus
  props <search|fetch|generate>              Illustrate slides with glTF models
  overrides apply <deck.json> <file>         Merge an overrides-grammar file into the deck

fx options:
  fx list [--kind k] [--tag t] [--topic p]   List effects (optionally filtered)
  fx preview <id> [--palette p] [-o out.png] Render one effect to a PNG (accepts local:<name>)
  fx scaffold <name> [--kind k] [--for id]   Write fx/<name>.js + card, print the override entry
  fx hash <name>                             Print the sha256 of fx/<name>.js
  fx promote <name> --source u --licence l   Move a local effect into the corpus
props options:
  props search <kw> [--role ambient]             Candidates (ambient = low-tri + entry template)
  props generate --from-image <img> --name <n>   Geometry-only GLB via Hunyuan3D-2
  props generate --prompt <text> --name <n>      Text → image → GLB (DECK3D_T2I_URL)

Options:
  -h, --help                                 Show this help
  -v, --version                              Print the version
`;

interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Record<string, string>;
}

/** Flags that consume the next argument as their value. */
const VALUE_FLAGS = new Set([
  "-o",
  "--out",
  "--viewport",
  "--slide",
  "--kind",
  "--tag",
  "--topic",
  "--palette",
  "--from-image",
  "--prompt",
  "--name",
  "--role",
  "--for",
  "--source",
  "--licence",
  "--port",
]);

function parseArgs(args: string[]): Flags {
  const flags: Flags = { positional: [], bool: new Set(), value: {} };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.has(arg)) {
      const key = arg === "-o" ? "out" : arg.replace(/^--?/, "");
      flags.value[key] = args[++i] ?? "";
    } else if (arg.startsWith("-")) {
      flags.bool.add(arg.replace(/^--?/, ""));
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultJsonPath(mdPath: string): string {
  return `${mdPath.replace(/\.md$/i, "")}.json`;
}

/** Shared parse: markdown (+ mermaid harvest when present) → IR on disk. */
async function parseToFile(mdPath: string, outPath: string, flags: Flags, io: CliIO): Promise<number> {
  const source = readFileSync(mdPath, "utf8");
  const opts: DeriveOptions = { source: mdPath };
  if (flags.bool.has("fresh")) opts.fresh = true;
  else if (existsSync(outPath)) {
    try {
      opts.previous = JSON.parse(readFileSync(outPath, "utf8"));
    } catch {
      // A corrupt prior file is not fatal for parse — start fresh.
    }
  }
  if (source.includes("```mermaid")) {
    const { harvestDiagram } = await import("./parse/harvest/index.js");
    opts.harvest = (mermaidSource, slideId) => harvestDiagram(mermaidSource, slideId);
  }
  const { defaultEffectsFor, defaultSceneFor } = await import("./fx/defaults.js");
  opts.effectsForSlide = (slide, autoStyle) => defaultEffectsFor(slide, autoStyle);
  opts.sceneForSlide = (slide, autoStyle) => defaultSceneFor(slide, autoStyle);
  const { ir, warnings } = await parseDeck(source, opts);
  for (const warning of warnings) io.stderr(warning);
  writeJson(outPath, ir);
  return 0;
}

async function cmdParse(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const mdPath = flags.positional[0];
  if (!mdPath) {
    io.stderr("deck3d parse: missing <deck.md>");
    return 2;
  }
  const outPath = flags.value.out ?? defaultJsonPath(mdPath);
  try {
    const code = await parseToFile(mdPath, outPath, flags, io);
    io.stdout(`wrote ${outPath}`);
    return code;
  } catch (err) {
    io.stderr(`deck3d parse: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdValidate(args: string[], io: CliIO): Promise<number> {
  const file = parseArgs(args).positional[0];
  if (!file) {
    io.stderr("deck3d validate: missing <deck.json>");
    return 2;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    io.stderr(`deck3d validate: invalid JSON in ${file}: ${(err as Error).message}`);
    return 1;
  }
  const result = validate(parsed, { propBytes: cachedPropBytes(file), deckDir: dirname(file) });
  for (const issue of result.errors) io.stderr(formatIssue("error", issue));
  for (const warning of result.warnings) io.stderr(formatIssue("warn", warning));
  if (result.ok) {
    const { validateEffectParams } = await import("./fx/compose.js");
    const violations = validateEffectParams(parsed as Parameters<typeof validateEffectParams>[0]);
    for (const v of violations) io.stderr(`error ${v.path}: ${v.message}`);
    if (violations.length) return 1;
  }
  if (result.errors.length === 0) io.stdout(`${file}: valid`);
  return result.ok ? 0 : 1;
}

/** Load + validate a deck.json; returns undefined on failure (already reported). */
function loadValidated(file: string, io: CliIO): DeckIR | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    io.stderr(`deck3d: invalid JSON in ${file}: ${(err as Error).message}`);
    return undefined;
  }
  // `render` re-checks the local referents it is about to embed.
  const result = validate(parsed, { deckDir: dirname(file) });
  if (!result.ok) {
    for (const issue of result.errors) io.stderr(formatIssue("error", issue));
    return undefined;
  }
  return parsed as DeckIR;
}

async function renderFile(jsonPath: string, outPath: string, io: CliIO): Promise<number> {
  const ir = loadValidated(jsonPath, io);
  if (!ir) return 1;
  const { composeEffects, validateEffectParams } = await import("./fx/compose.js");
  const { ensureRuntime, renderDeck, fontBase64, loadLocalEffects } = await import("./render/index.js");
  // Resolve the local effects first: their cards take part in param bounds,
  // conflict, mode and budget gating exactly like corpus cards.
  const localFx = loadLocalEffects(ir, jsonPath);
  const localCards = Object.fromEntries(
    Object.entries(localFx).map(([name, m]) => [name, m.card as import("./fx/types.js").FxCard]),
  );
  const violations = validateEffectParams(ir, localCards);
  if (violations.length) {
    for (const v of violations) io.stderr(`error ${v.path}: ${v.message}`);
    return 1;
  }
  // Compose the MERGED view: `overrides.effects` + `overrides.slides[id].effects`
  // are already folded into each slide's effective list by `applyOverrides`.
  const { applyOverrides } = await import("./ir/merge.js");
  const merged = applyOverrides(ir);
  for (const slide of merged.slides) {
    const ov = ir.overrides.slides?.[slide.id];
    const mode = ov?.mode ?? ir.overrides.deck?.mode ?? ir.defaults.mode ?? "dark";
    const quality = ov?.quality ?? ir.overrides.deck?.quality ?? ir.defaults.quality ?? "high";
    const comp = composeEffects(slide.effects, mode, quality, slide.id, localCards);
    for (const warning of comp.warnings) io.stderr(warning);
    if (comp.conflicts.length) {
      for (const c of comp.conflicts) io.stderr(`error conflict ${c}`);
      return 1;
    }
  }
  const { loadProps } = await import("./props/embed.js");
  const runtime = await ensureRuntime();
  const props = loadProps(ir, jsonPath);
  const html = renderDeck(ir, { runtime, font: fontBase64(), title: basename(jsonPath, ".json"), props, localFx });
  writeFileSync(outPath, html);
  return 0;
}

async function cmdRender(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const jsonPath = flags.positional[0];
  if (!jsonPath) {
    io.stderr("deck3d render: missing <deck.json>");
    return 2;
  }
  const outPath = flags.value.out ?? jsonPath.replace(/\.json$/i, ".html");
  try {
    const code = await renderFile(jsonPath, outPath, io);
    if (code === 0) io.stdout(`wrote ${outPath}`);
    return code;
  } catch (err) {
    io.stderr(`deck3d render: ${(err as Error).message}`);
    return 1;
  }
}

async function loadReport(htmlPath: string, flags: Flags, io: CliIO, strict: boolean, failOnFinding: boolean): Promise<{ code: number; report?: import("./check/index.js").CheckReport }> {
  const { parseViewports, runCheck, CheckUnavailableError } = await import("./check/index.js");
  try {
    const report = await runCheck(htmlPath, {
      viewports: parseViewports(flags.value.viewport),
      ...(flags.value.slide ? { slides: [Number.parseInt(flags.value.slide, 10)] } : {}),
      ...(flags.bool.has("style") ? { style: true } : {}),
    });
    return { code: 0, report };
  } catch (err) {
    if (err instanceof CheckUnavailableError) {
      io.stderr("check skipped: chromium missing (npx playwright install chromium)");
      // `--strict` makes an unrunnable check a failure even for `build`
      // (which otherwise ignores findings). See spec deck3d-render: Build runs check.
      return { code: strict ? 1 : 0 };
    }
    io.stderr(`check failed: ${(err as Error).message}`);
    return { code: failOnFinding ? 1 : 0 };
  }
}

function reportFindings(
  report: import("./check/index.js").CheckReport,
  io: CliIO,
  strict: boolean,
  formatFinding: (f: import("./check/index.js").Finding) => string,
  reportOut?: string,
  failOnFinding = true,
): number {
  if (reportOut) writeFileSync(reportOut, `${JSON.stringify(report, null, 2)}\n`);
  const findings = report.viewports.flatMap((v) => v.findings);
  for (const f of findings) io.stderr(formatFinding(f));
  const errors = findings.filter((f) => f.severity === "error").length;
  if (failOnFinding && errors > 0) return 1;
  if (strict && findings.length) return 1;
  io.stdout(findings.length ? `check: ${errors} error(s), ${findings.length - errors} warning(s)` : "check: clean");
  return 0;
}

async function runCheckAndReport(htmlPath: string, flags: Flags, io: CliIO, failOnFinding: boolean, reportOut?: string): Promise<number> {
  const { formatFinding } = await import("./check/index.js");
  const strict = flags.bool.has("strict");
  const { code, report } = await loadReport(htmlPath, flags, io, strict, failOnFinding);
  if (!report) return code;
  return reportFindings(report, io, strict, formatFinding, reportOut, failOnFinding);
}

async function cmdFx(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const sub = flags.positional[0];
  if (sub === "preview") return fxPreview(flags, io);
  if (sub === "scaffold") return fxScaffold(flags, io);
  if (sub === "hash") return fxHash(flags, io);
  if (sub === "promote") return fxPromote(flags, io);
  if (sub !== "list") {
    io.stderr(`deck3d fx: unknown subcommand '${sub ?? ""}' (try list|preview|scaffold|hash|promote)`);
    return 2;
  }
  const { catalogue } = await import("./fx/catalogue.js");
  const { FX_TOPICS } = await import("./fx/types.js");
  let rows = catalogue();
  if (flags.value.kind) rows = rows.filter((r) => r.kind === flags.value.kind);
  if (flags.value.tag) rows = rows.filter((r) => r.content.includes(flags.value.tag) || r.mood.includes(flags.value.tag));
  if (flags.value.topic) {
    const topic = flags.value.topic;
    // A typo must fail loudly: an unknown topic silently matching nothing looks
    // like "the corpus has no effect for this", which is a different problem.
    if (!(FX_TOPICS as readonly string[]).includes(topic)) {
      io.stderr(`deck3d fx list: unknown topic '${topic}' (one of ${FX_TOPICS.join(", ")})`);
      return 1;
    }
    rows = rows.filter((r) => (r.topic as string[] | undefined)?.includes(topic));
  }
  if (flags.bool.has("json")) {
    io.stdout(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const r of rows) io.stdout(`${r.id}\t${r.kind}\tcost ${r.cost}\t${r.modes}`);
  return 0;
}

/** One-slide deck whose only effect is `id` (design D9 / 7d.3 preview). */
async function previewDeck(id: string, palette?: Palette, sha?: string): Promise<DeckIR> {
  const { resolveDefaults } = await import("./ir/defaults.js");
  const ref = sha ? { id, sha256: sha } : { id };
  return {
    meta: { engine: VERSION, mermaid: "11.17.2" },
    defaults: resolveDefaults(palette ? { palette } : {}),
    slides: [
      {
        index: 0,
        id: "fx-preview",
        kind: "title",
        title: `fx ${id}`,
        subtitle: "preview",
        bullets: [],
        scene: "tokens",
        diagram: { kind: "none" },
        effects: [ref],
      },
    ],
    // The preview deck is rendered from a temp dir, so the local reference has
    // to live in `overrides` for `loadLocalEffects` to find and embed it.
    overrides: sha ? { slides: { "fx-preview": { effects: [ref] } } } : {},
  };
}

/** `fx scaffold|hash|promote` — authoring a per-deck effect (design D1). */
async function fxScaffold(flags: Flags, io: CliIO): Promise<number> {
  const name = flags.positional[1];
  if (!name) {
    io.stderr("deck3d fx scaffold: missing <name>");
    return 2;
  }
  const { scaffoldLocalEffect } = await import("./fx/scaffold.js");
  const r = scaffoldLocalEffect(process.cwd(), name, flags.value.kind ?? "background", flags.value.for);
  if (!r.ok) {
    io.stderr(`deck3d fx scaffold: ${r.message}`);
    return 1;
  }
  io.stdout(r.message);
  if (r.entry) io.stdout(r.entry);
  return 0;
}

async function fxHash(flags: Flags, io: CliIO): Promise<number> {
  const name = flags.positional[1];
  if (!name) {
    io.stderr("deck3d fx hash: missing <name>");
    return 2;
  }
  const { hashLocalEffect } = await import("./fx/scaffold.js");
  const r = hashLocalEffect(process.cwd(), name);
  if (!r.ok) {
    io.stderr(`deck3d fx hash: ${r.message}`);
    return 1;
  }
  io.stdout(r.message);
  return 0;
}

async function fxPromote(flags: Flags, io: CliIO): Promise<number> {
  const name = flags.positional[1];
  if (!name) {
    io.stderr("deck3d fx promote: missing <name>");
    return 2;
  }
  const { promoteLocalEffect } = await import("./fx/scaffold.js");
  const corpusDir = process.env.DECK3D_CORPUS_DIR ?? join(pkgRoot(), "src", "fx");
  const r = promoteLocalEffect(process.cwd(), name, {
    source: flags.value.source,
    licence: flags.value.licence,
    corpusDir,
    // The corpus gate is the real test suite: a module that will not construct
    // must never land in the shipped corpus.
    verify: () => {
      const run = spawnSync("npx", ["vitest", "run", "src/fx/__tests__/corpus.test.ts"], {
        cwd: pkgRoot(),
        encoding: "utf8",
      });
      return { ok: run.status === 0, detail: `${run.stdout ?? ""}${run.stderr ?? ""}`.slice(-400) };
    },
  });
  if (!r.ok) {
    io.stderr(`deck3d fx promote: ${r.message}`);
    return 1;
  }
  io.stdout(r.message);
  return 0;
}

/** `fx preview <id> [-o png]` — render one effect and screenshot it (7d.7). */
async function fxPreview(flags: Flags, io: CliIO): Promise<number> {
  const id = flags.positional[1];
  if (!id) {
    io.stderr("deck3d fx preview: missing <id>");
    return 2;
  }
  const { isLocalId, localName, sha256 } = await import("./fx/local.js");
  const local = isLocalId(id);
  if (!local) {
    const { REGISTRY } = await import("./fx/index.js");
    if (!REGISTRY[id]) {
      io.stderr(`deck3d fx preview: unknown effect '${id}' (try fx list)`);
      return 1;
    }
  }
  const modulePath = local ? join(process.cwd(), "fx", `${localName(id)}.js`) : "";
  if (local && !existsSync(modulePath)) {
    io.stderr(`deck3d fx preview: missing fx/${localName(id)}.js`);
    return 1;
  }
  const palette = flags.value.palette as Palette | undefined;
  if (palette && !PALETTE_IDS.includes(palette)) {
    io.stderr(`deck3d fx preview: unknown palette '${palette}' (one of ${PALETTE_IDS.join(", ")})`);
    return 1;
  }
  const out = flags.value.out ?? `${id}.png`;
  try {
    const { ensureRuntime, renderDeck, fontBase64, loadLocalEffects } = await import("./render/index.js");
    const deck = await previewDeck(id, palette, local ? sha256(readFileSync(modulePath)) : undefined);
    // Resolve against the deck dir (cwd), then render from a temp dir.
    const localFx = local ? loadLocalEffects(deck, join(process.cwd(), "deck.json")) : {};
    const html = renderDeck(deck, { runtime: await ensureRuntime(), font: fontBase64(), title: `fx ${id}`, localFx });
    const htmlPath = join(mkdtempSync(join(tmpdir(), "deck3d-fx-")), "fx.html");
    writeFileSync(htmlPath, html);
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(htmlPath).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.ready());
      await page.evaluate(() => window.__deck3d?.setTime(0));
      await page.waitForTimeout(200);
      await page.screenshot({ path: out });
    } finally {
      await browser.close();
    }
    io.stdout(`wrote ${out}`);
    return 0;
  } catch (err) {
    io.stderr(`deck3d fx preview: ${(err as Error).message}`);
    return 1;
  }
}

/** Cached `.glb` byte counts beside a deck.json, keyed `<source>-<id>`. */
function cachedPropBytes(jsonFile: string): Record<string, number> {
  const dir = join(dirname(jsonFile), ".deck3d", "props");
  const out: Record<string, number> = {};
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".glb")) out[file.replace(/\.glb$/, "")] = statSync(join(dir, file)).size;
  }
  return out;
}

async function propsFetch(rest: string[], flags: Flags, io: CliIO): Promise<number> {
  const [source, id] = rest;
  if (!source || !id) {
    io.stderr("deck3d props fetch: missing <source> <id>");
    return 2;
  }
  const { searchPolyPizza, vendoredCandidates } = await import("./props/search.js");
  const candidate =
    source === "vendored"
      ? vendoredCandidates(id).find((c) => c.id === id)
      : (await searchPolyPizza(id)).candidates.find((c) => c.id === id);
  if (!candidate) {
    io.stderr(`deck3d props fetch: unknown ${source} prop '${id}'`);
    return 1;
  }
  const { fetchProp } = await import("./props/fetch.js");
  try {
    const result = await fetchProp(candidate, { destDir: join(process.cwd(), ".deck3d", "props") });
    io.stdout(
      JSON.stringify(
        {
          source: candidate.source,
          id: candidate.id,
          licence: candidate.licence,
          author: candidate.author,
          sha256: result.sha256,
          slide: flags.value.slide ?? "",
          role: flags.value.role ?? "illustration",
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (err) {
    io.stderr(`deck3d props fetch: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdProps(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const [sub, ...rest] = flags.positional;
  if (sub === "search") {
    const { searchProps, ambientCandidates, ambientTemplate } = await import("./props/search.js");
    const result = await searchProps(rest.join(" "));
    for (const notice of result.notices) io.stderr(notice);
    const ambient = flags.value.role === "ambient";
    const rows = ambient ? ambientCandidates(result.candidates) : result.candidates;
    for (const c of rows) {
      io.stdout(`${c.source}\t${c.id}\t${c.name}\t${c.licence}\t${c.bytes}b`);
      // Ambient placement needs count/anim/size, which are easy to get wrong;
      // print the entry rather than making the agent recall the shape.
      if (ambient) io.stdout(JSON.stringify(ambientTemplate(c)));
    }
    return 0;
  }
  if (sub === "fetch") return propsFetch(rest, flags, io);
  if (sub === "generate") return propsGenerate(flags, io);
  io.stderr(`deck3d props: unknown subcommand '${sub ?? ""}' (try search|fetch|generate)`);
  return 2;
}

/** `props generate --from-image <img> --name <n>` (7b.7). */
async function propsGenerate(flags: Flags, io: CliIO): Promise<number> {
  const name = flags.value.name;
  const prompt = flags.value.prompt;
  if ((!flags.value["from-image"] && !prompt) || !name) {
    io.stderr("deck3d props generate: missing --from-image <img> | --prompt <text>, and --name <n>");
    return 2;
  }
  const { generateProp, textToImage } = await import("./props/generate.js");
  const destDir = join(process.cwd(), ".deck3d", "props");
  try {
    // `--prompt` is a hop in FRONT of the existing image path: text → PNG → GLB.
    const fromImage = prompt ? await textToImage({ prompt, name, destDir }) : (flags.value["from-image"] as string);
    const result = await generateProp({ fromImage, name, destDir });
    io.stdout(JSON.stringify(result.entry, null, 2));
    return 0;
  } catch (err) {
    io.stderr(`deck3d props generate: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdCheck(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const html = flags.positional[0];
  if (!html) {
    io.stderr("deck3d check: missing <deck.html>");
    return 2;
  }
  return runCheckAndReport(html, flags, io, true, flags.value.out);
}

/** `style: <n>/<N> slides styled` — slides carrying an authored choice (D7). */
async function styleSummary(jsonPath: string): Promise<string> {
  const ir = JSON.parse(readFileSync(jsonPath, "utf8")) as DeckIR;
  const { defaultEffectsFor } = await import("./fx/defaults.js");
  const { builtKindFor } = await import("./parse/derive.js");
  const { applyOverrides } = await import("./ir/merge.js");
  const merged = applyOverrides(ir);
  const autoStyle = ir.overrides.deck?.autoStyle ?? ir.defaults.autoStyle ?? true;
  const propSlides = new Set((ir.overrides.props ?? []).map((p) => p.slide));

  let styled = 0;
  for (const slide of merged.slides) {
    const effects = (slide.effects ?? []).map((e) => e.id);
    const defaults = defaultEffectsFor(
      { id: slide.id, title: slide.title, bullets: slide.bullets, diagram: slide.diagram },
      autoStyle,
    ).map((e) => e.id);
    const derivedKind =
      slide.diagram.kind === "flowchart" || slide.diagram.kind === "sequence"
        ? slide.diagram.kind
        : autoStyle
          ? builtKindFor({ title: slide.title, bullets: slide.bullets })
          : "none";
    const onDefaults = effects.join("\u0000") === defaults.join("\u0000") && slide.diagram.kind === derivedKind;
    if (!onDefaults || propSlides.has(slide.id)) styled++;
  }
  return `style: ${styled}/${merged.slides.length} slides styled`;
}

async function cmdBuild(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const mdPath = flags.positional[0];
  if (!mdPath) {
    io.stderr("deck3d build: missing <deck.md>");
    return 2;
  }
  const outPath = flags.value.out ?? mdPath.replace(/\.md$/i, ".html");
  try {
    await parseToFile(mdPath, defaultJsonPath(mdPath), flags, io);
    const code = await renderFile(defaultJsonPath(mdPath), outPath, io);
    if (code !== 0) return code;
    io.stdout(`wrote ${outPath}`);
    // `build` runs check, but only `--strict` fails on findings.
    const checkCode = await runCheckAndReport(outPath, flags, io, false);
    // A clean check says nothing about whether the deck was ever styled, so the
    // style ratio is printed last, where the agent reads it.
    io.stdout(await styleSummary(defaultJsonPath(mdPath)));
    return checkCode;
  } catch (err) {
    io.stderr(`deck3d build: ${(err as Error).message}`);
    return 1;
  }
}

/**
 * `serve <deck.md>` — authoring loop. Runs until interrupted; loopback only,
 * because the panel can write `overrides.json` / `deck.json` through it.
 */
async function cmdServe(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const mdPath = flags.positional[0];
  if (!mdPath) {
    io.stderr("deck3d serve: missing <deck.md>");
    return 2;
  }
  const { startServe } = await import("./serve/index.js");
  try {
    const handle = await startServe(mdPath, {
      port: flags.value.port ? Number.parseInt(flags.value.port, 10) : 0,
      check: flags.bool.has("check"),
      io,
    });
    io.stdout(`serving ${mdPath} on ${handle.url}`);
    io.stdout("watching deck.md, fx/ and deck.json — edit and the browser reloads");
    await new Promise<void>((resolve) => {
      const stop = (): void => {
        void handle.close().then(resolve);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return 0;
  } catch (err) {
    io.stderr(`deck3d serve: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdSnapshot(args: string[], io: CliIO): Promise<number> {
  const flags = parseArgs(args);
  const html = flags.positional[0];
  if (!html) {
    io.stderr("deck3d snapshot: missing <deck.html>");
    return 2;
  }
  const out = flags.value.out ?? "snapshot.png";
  const slide = flags.value.slide ? Number.parseInt(flags.value.slide, 10) : 1;
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(`${pathToFileURL(html).href}#${slide}`);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.ready());
      await page.waitForTimeout(400);
      await page.screenshot({ path: out });
    } finally {
      await browser.close();
    }
    io.stdout(`wrote ${out}`);
    return 0;
  } catch (err) {
    io.stderr(`deck3d snapshot: ${(err as Error).message}`);
    return 1;
  }
}

/**
 * `overrides apply <deck.json> <file>` — merge a file written in the D1
 * `overrides` grammar into `deck.json`'s `overrides` block (objects deep-merge,
 * arrays and `diagram.data` replace), re-validate, and only then write. A
 * validation failure leaves `deck.json` byte-unchanged.
 */
async function overridesApply(rest: string[], io: CliIO): Promise<number> {
  const [jsonPath, patchPath] = rest;
  if (!jsonPath || !patchPath) {
    io.stderr("deck3d overrides apply: missing <deck.json> <file>");
    return 2;
  }
  let deck: DeckIR;
  let patch: unknown;
  try {
    deck = JSON.parse(readFileSync(jsonPath, "utf8")) as DeckIR;
  } catch (err) {
    io.stderr(`deck3d overrides apply: invalid JSON in ${jsonPath}: ${(err as Error).message}`);
    return 1;
  }
  try {
    patch = JSON.parse(readFileSync(patchPath, "utf8"));
  } catch (err) {
    io.stderr(`deck3d overrides apply: invalid JSON in ${patchPath}: ${(err as Error).message}`);
    return 1;
  }

  const { deepMerge } = await import("./ir/merge.js");
  const merged = { ...deck, overrides: deepMerge(deck.overrides ?? {}, patch) as DeckIR["overrides"] };

  const result = validate(merged, { propBytes: cachedPropBytes(jsonPath) });
  for (const issue of result.errors) io.stderr(formatIssue("error", issue));
  if (!result.ok) return 1;
  for (const warning of result.warnings) io.stderr(formatIssue("warn", warning));

  writeJson(jsonPath, merged);
  io.stdout(JSON.stringify(merged.overrides, null, 2));
  return 0;
}

async function cmdOverrides(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "apply") return overridesApply(rest, io);
  io.stderr(`deck3d overrides: unknown subcommand '${sub ?? ""}' (try apply)`);
  return 2;
}

export async function run(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      io.stdout(HELP);
      return 0;
    case "-v":
    case "--version":
    case "version":
      io.stdout(VERSION);
      return 0;
    case "parse":
      return cmdParse(rest, io);
    case "validate":
      return await cmdValidate(rest, io);
    case "render":
      return cmdRender(rest, io);
    case "build":
      return cmdBuild(rest, io);
    case "serve":
      return cmdServe(rest, io);
    case "check":
      return cmdCheck(rest, io);
    case "fx":
      return cmdFx(rest, io);
    case "props":
      return cmdProps(rest, io);
    case "snapshot":
      return cmdSnapshot(rest, io);
    case "overrides":
      return cmdOverrides(rest, io);
    default:
      io.stderr(`deck3d: unknown command '${command}' (try --help)`);
      return 2;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  // NOT `process.exit(await run(...))`. A top-level await here keeps this
  // module's evaluation pending for the whole command, and `serve/index.ts`
  // imports `run` from this file — so `serve`'s own `await import()` would
  // wait on a module that is waiting on `serve`, and the process would exit 13
  // before ever listening (#S10). Settling the promise in a callback lets
  // evaluation finish immediately, which breaks the cycle.
  void run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`deck3d: ${(err as Error).stack ?? err}`);
      process.exit(1);
    },
  );
}
