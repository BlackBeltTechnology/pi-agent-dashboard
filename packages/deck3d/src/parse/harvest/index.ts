/**
 * Mermaid harvest — parse-time only, headless chromium (design D2).
 *
 * Launches Playwright chromium, injects the bundled harness page, and converts
 * a mermaid source block into the Deck IR `Diagram`. Never runs at view time.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Diagram, DiagramEdge, DiagramMessage, EdgeKind, FlowchartDir, NodeShape } from "../../ir/types.js";
import { getHarnessBundle, PACKAGE_ROOT, renderHarnessHtml } from "./bundle.js";
import type { RawHarvest } from "./harness.js";

export const DEFAULT_HARVEST_TIMEOUT_MS = 60_000;

/** Raised for every harvest failure; the message is the one-line CLI reason. */
export class HarvestError extends Error {
  constructor(
    message: string,
    readonly slideId?: string,
  ) {
    super(message);
    this.name = "HarvestError";
  }
}

export interface HarvestOptions {
  timeoutMs?: number;
  /** Test hook: make the harness page never resolve. */
  stall?: boolean;
}

export interface HarvestOutcome {
  diagram: Diagram;
  warnings: string[];
}

function envTimeout(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function installHint(err: unknown): HarvestError {
  const message = err instanceof Error ? err.message : String(err);
  return new HarvestError(
    `chromium not available for mermaid harvest — install with: npx playwright install chromium (${message.split("\n")[0]})`,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function fontBase64(): string {
  return readFileSync(join(PACKAGE_ROOT, "assets", "Poppins-Bold.ttf")).toString("base64");
}

/** Convert the raw harness payload to the IR `Diagram`, assigning stable ids. */
export function toDiagram(raw: RawHarvest, slideId: string): HarvestOutcome {
  if (raw.kind === "none") {
    if (raw.unsupported) {
      return { diagram: { kind: "none" }, warnings: [`warn unsupported diagram ${raw.unsupported} slide ${slideId}`] };
    }
    return { diagram: { kind: "none" }, warnings: [] };
  }

  if (raw.kind === "sequence") {
    const messages: DiagramMessage[] = (raw.messages ?? []).map((m, i) => ({
      id: `m${i}`,
      from: m.from,
      to: m.to,
      text: m.text,
      kind: m.kind,
    }));
    return {
      diagram: { kind: "sequence", actors: raw.actors ?? [], messages },
      warnings: [],
    };
  }

  const nodes = (raw.nodes ?? []).map((n) => ({
    id: n.id,
    label: n.label,
    shape: n.shape as NodeShape,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    ...(n.group ? { group: n.group } : {}),
  }));
  const seen: Record<string, number> = {};
  const edges: DiagramEdge[] = (raw.edges ?? []).map((e) => {
    const key = `${e.from}->${e.to}`;
    const k = (seen[key] = (seen[key] ?? -1) + 1);
    return {
      id: `${key}#${k}`,
      from: e.from,
      to: e.to,
      kind: e.kind as EdgeKind,
      ...(e.label ? { label: e.label } : {}),
      path: e.path,
    };
  });
  return {
    diagram: {
      kind: "flowchart",
      dir: (raw.dir as FlowchartDir) ?? "TB",
      nodes,
      edges,
      groups: raw.groups ?? [],
    },
    warnings: [],
  };
}

/**
 * Harvest one mermaid block. `slideId` names the slide in error/warning lines
 * and seeds the mermaid render id (so layout ids are stable per slide).
 */
export async function harvestDiagram(source: string, slideId: string, opts: HarvestOptions = {}): Promise<HarvestOutcome> {
  const timeoutMs = opts.timeoutMs ?? envTimeout("DECK3D_HARVEST_TIMEOUT_MS", DEFAULT_HARVEST_TIMEOUT_MS);
  const stall = opts.stall ?? process.env.DECK3D_HARVEST_STALL === "1";
  const bundle = await getHarnessBundle();
  const html = renderHarnessHtml(bundle, fontBase64(), stall);

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ channel: "chromium" });
  } catch (err) {
    throw installHint(err);
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const pending = page.evaluate(
      ({ src, id }) => window.__deck3dHarvest(src, id),
      { src: source, id: `mm-${slideId}` },
    );
    // Prevent an unhandled rejection if the timeout wins the race.
    pending.catch(() => {});
    let raw: RawHarvest;
    try {
      raw = await withTimeout(
        pending as Promise<RawHarvest>,
        timeoutMs,
        () => new HarvestError(`slide "${slideId}": mermaid harvest timeout after ${timeoutMs} ms`, slideId),
      );
    } catch (err) {
      throw err instanceof HarvestError ? err : new HarvestError(`slide "${slideId}": mermaid harvest failed — ${(err as Error).message}`, slideId);
    }
    return toDiagram(raw, slideId);
  } finally {
    await browser.close();
  }
}
