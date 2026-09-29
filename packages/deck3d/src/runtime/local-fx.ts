/**
 * Local-effect instantiation (design D1).
 *
 * A module embedded in `window.__DECK_LOCAL_FX` is evaluated with the
 * non-deterministic and I/O globals shadowed to `undefined` and `Math.random`
 * rebound to the deck's seeded generator. This is a DETERMINISM/OFFLINE
 * guardrail, not a security boundary — the author runs their own deck, and
 * `ctx.THREE` loaders still reach the network (which `check` blocks and
 * reports).
 *
 * Every entry point is wrapped: a throw disables that effect for that slide,
 * never the slide.
 */
import type { LocalCards } from "../fx/compose.js";
import type { FxCard, FxContext, FxHandle, FxParams } from "../fx/types.js";

/** Identifiers that resolve to `undefined` inside a local module. */
export const SHADOWED = [
  "window",
  "document",
  "globalThis",
  "self",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Image",
  "Worker",
  "WebAssembly",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "postMessage",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "queueMicrotask",
  "Promise",
  "Date",
  "performance",
  "crypto",
  "eval",
  "Function",
  "importScripts",
] as const;

export interface LocalFxError {
  slide: string;
  effectId: string;
  phase: "create" | "tick" | "dispose";
}

export interface LocalFxModule {
  card: FxCard;
  src: string;
}

export type LocalFxRegistry = Record<string, LocalFxModule>;

export function localFxRegistry(): LocalFxRegistry {
  return ((window as unknown as { __DECK_LOCAL_FX?: LocalFxRegistry }).__DECK_LOCAL_FX ?? {}) as LocalFxRegistry;
}

/** The embedded cards, in the shape `composeEffects` expects. */
export function localCards(): LocalCards {
  return Object.fromEntries(Object.entries(localFxRegistry()).map(([name, m]) => [name, m.card]));
}

/** A frozen `Math` whose `random` is the deck's per-slide seeded stream. */
function seededMath(rng: () => number): Math {
  const clone = Object.create(Math) as Math & { random: () => number };
  clone.random = rng;
  return Object.freeze(clone);
}

/**
 * Build the factory from embedded source. `render` already rewrote the leading
 * `export default function` to `return function`, so the body evaluates to the
 * factory.
 */
function compile(src: string, rng: () => number): (ctx: FxContext, params: FxParams) => FxHandle {
  const names = [...SHADOWED, "Math"];
  // No `"use strict"`: `eval` and `Function` are illegal parameter names in
  // strict mode, and binding them to `undefined` is exactly what makes the
  // spec's shadowing list true. Isolation here is a determinism/offline
  // guardrail, not a security boundary (design D1).
  // biome-ignore lint/security/noGlobalEval: deliberate — the local-effect contract is source embedded at render time, pinned by sha256.
  const make = new Function(...names, src) as (...args: unknown[]) => unknown;
  const factory = make(...SHADOWED.map(() => undefined), seededMath(rng));
  if (typeof factory !== "function") throw new TypeError("local effect did not return a factory function");
  return factory as (ctx: FxContext, params: FxParams) => FxHandle;
}

export interface LocalHandle {
  object?: unknown;
  tick: (t: number) => void;
  dispose: () => void;
}

/**
 * Instantiate `local:<name>` for a slide. Returns `undefined` when the module
 * is unknown or its factory threw; the error is pushed onto `errors`.
 */
export function createLocalEffect(
  effectId: string,
  module: LocalFxModule | undefined,
  ctx: FxContext,
  params: FxParams,
  errors: LocalFxError[],
): LocalHandle | undefined {
  const slide = ctx.slide.id;
  const record = (phase: LocalFxError["phase"], err: unknown): void => {
    errors.push({ slide, effectId, phase });
    console.error(`local effect ${effectId} failed in ${phase} on slide ${slide}:`, err);
  };

  if (!module) return undefined;
  let handle: FxHandle;
  try {
    handle = compile(module.src, ctx.rng)(ctx, params);
  } catch (err) {
    record("create", err);
    return undefined;
  }

  let dead = false;
  return {
    object: handle.object,
    tick: (t: number) => {
      if (dead || !handle.tick) return;
      try {
        handle.tick(t);
      } catch (err) {
        // Once disabled it stays disabled: a throwing tick would otherwise
        // report every frame and drown the report.
        dead = true;
        record("tick", err);
        (handle.object as { parent?: { remove: (o: unknown) => void } } | undefined)?.parent?.remove(handle.object);
      }
    },
    dispose: () => {
      try {
        handle.dispose?.();
      } catch (err) {
        record("dispose", err);
      }
    },
  };
}
