import { mkdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  buttonsWithoutFocusIndicator,
  contrastFailures,
  measureText,
  setThemeMode,
  sizeFailures,
} from "./computed-contrast.js";
import { resolveEvidencePath } from "./evidence-path.js";

/**
 * Named-UI-state capture for the retro-UX changes (capability `ui-state-capture`).
 *
 * A surface's states come from `page.route` stubs (never server seeding), each
 * state is opened, screenshotted and probed in every theme × width. The probes
 * are the repo's computed-contrast ones; screenshots are opt-in evidence
 * (`RETRO_UX_CAPTURE=1`) written next to the change's other mockups and refused
 * for an archived or missing change (#549: never conjure a change dir).
 *
 * See change: retro-ux-identity-connectivity (design D3).
 */

/** One reachable UI state of a surface. */
export interface UiState {
  id: string;
  label: string;
  /** REST endpoints this state answers via `page.route`; at least one. */
  stubs: string[];
  /** Registers the route stubs. Handlers persist across reloads. */
  install(page: Page): Promise<void>;
  /** Brings the surface into view (settings tab, or a trigger click for a menu). */
  open(page: Page): Promise<void>;
  /** The probe scope: the trigger for a closed selector, the portalled `role="menu"` for an open one. */
  root(page: Page): Locator;
}

export interface ThemeMode {
  theme: string;
  mode: "dark" | "light";
}

/** Palettes sampled by the matrix (ids from `packages/client/src/lib/theme/themes.ts`). */
export const RETRO_UX_THEMES: readonly ThemeMode[] = [
  { theme: "base", mode: "dark" },
  { theme: "base", mode: "light" },
  { theme: "nord", mode: "dark" },
];

export const RETRO_UX_WIDTHS: readonly number[] = [375, 768, 1440];

export interface CaptureOptions {
  /** Active change name; its dir receives `mockups/after/<surface>/`. */
  change: string;
  surface: string;
  states: UiState[];
  /** Restrict to these state ids; an unknown id throws. */
  only?: string[];
  themes?: readonly ThemeMode[];
  widths?: readonly number[];
  /** Repo root override (unit tests only). */
  repoRoot?: string;
}

export interface CaptureResult {
  state: string;
  theme: string;
  mode: "dark" | "light";
  width: number;
  /** Number of measured text nodes — a spec asserts > 0 so an empty `root` cannot pass vacuously. */
  measured: number;
  contrast: string[];
  size: string[];
  focus: string[];
}

/** Directory that receives evidence, or throws; only called when writing is enabled. */
function evidenceDir(change: string, surface: string, repoRoot?: string): string {
  const changeDir = dirname(resolveEvidencePath(change, repoRoot));
  const parts = changeDir.split(sep);
  const archived = parts.some((p, i) => p === "archive" && parts[i - 1] === "changes");
  if (archived) {
    throw new Error(
      `Refusing to write capture evidence for "${change}": it resolves to an archived change (${changeDir}). ` +
        "Evidence belongs to the active change.",
    );
  }
  return join(changeDir, "mockups", "after", surface);
}

/** Validate everything that can fail BEFORE the first navigation; returns the states to run. */
function selectStates(surface: string, all: UiState[], only?: string[]): UiState[] {
  let states = all;
  if (only) {
    const known = new Set(all.map((s) => s.id));
    const unknown = only.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `captureStates(${surface}): unknown state id ${unknown.map((u) => JSON.stringify(u)).join(", ")}; ` +
          `known: ${[...known].join(", ")}`,
      );
    }
    states = all.filter((s) => only.includes(s.id));
  }
  for (const s of states) {
    if (s.stubs.length === 0) throw new Error(`state ${s.id} declares no stubbed endpoint (surface ${surface})`);
  }
  return states;
}

/** One matrix cell: reload in the theme, open the state, optionally screenshot, probe. */
async function captureCell(page: Page, state: UiState, tm: ThemeMode, width: number, outDir: string | null): Promise<CaptureResult> {
  await page.setViewportSize({ width, height: 900 });
  // Reloads the page and re-fires the stubbed requests; also re-closes any menu a resize could strand.
  await setThemeMode(page, tm.mode, tm.theme);
  await state.open(page);
  const root = state.root(page);
  if (outDir) await page.screenshot({ path: join(outDir, `${state.id}--${tm.theme}-${tm.mode}--${width}.png`) });
  const measures = await measureText(root);
  return {
    state: state.id,
    theme: tm.theme,
    mode: tm.mode,
    width,
    measured: measures.length,
    contrast: contrastFailures(measures),
    size: sizeFailures(measures),
    focus: await buttonsWithoutFocusIndicator(page, root),
  };
}

export async function captureStates(page: Page, opts: CaptureOptions): Promise<CaptureResult[]> {
  const { change, surface, repoRoot } = opts;
  const themes = opts.themes ?? RETRO_UX_THEMES;
  const widths = opts.widths ?? RETRO_UX_WIDTHS;
  const states = selectStates(surface, opts.states, opts.only);
  const outDir = process.env.RETRO_UX_CAPTURE === "1" ? evidenceDir(change, surface, repoRoot) : null;
  if (outDir) mkdirSync(outDir, { recursive: true });

  const results: CaptureResult[] = [];
  for (const state of states) {
    for (const tm of themes) {
      // A leftover stub from the previous state must not answer this one.
      await page.unrouteAll?.({ behavior: "ignoreErrors" });
      await state.install(page);
      await page.goto("/");
      for (const width of widths) results.push(await captureCell(page, state, tm, width, outDir));
    }
  }
  return results;
}
