import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAsyncAction } from "../../hooks/useAsyncAction.js";
import { Toast, type ToastVariant, useToast } from "../primitives/Toast.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, rel), "utf8");

const TOAST = src("../primitives/Toast.tsx");
const TOAST_SLOT = src("../extension-ui/ToastSlot.tsx");
const SPAWN_HOST = src("../session/SpawnErrorToastHost.tsx");
const SPAWN_BANNER = src("../session/SpawnErrorBanner.tsx");
const INDEX_CSS = src("../../index.css");
const USE_ASYNC = src("../../hooks/useAsyncAction.ts");
const SESSION_LIST = src("../session/SessionList.tsx");
const APP = src("../../App.tsx");

// Compile-time guard (E3): the union has EXACTLY these 5 members. A missing or
// extra member fails `tsc --noEmit`.
const ALL_VARIANTS: Record<ToastVariant, true> = {
  error: true,
  warning: true,
  success: true,
  info: true,
  neutral: true,
};

describe("Toast variants (E1, E2)", () => {
  it("default (no variant) is neutral, references --severity-neutral-*, not red-900", () => {
    const { container } = render(
      <Toast messages={[{ id: 2, text: "Oops" }]} onDismiss={() => {}} />,
    );
    expect(container.innerHTML).toContain("--severity-neutral-bg");
    expect(container.innerHTML).not.toMatch(/red-900/);
    expect(container.innerHTML).not.toMatch(/bg-red|bg-green/);
  });

  it("renders every variant from its own --severity-<v>-* triple (E2)", () => {
    for (const v of Object.keys(ALL_VARIANTS) as ToastVariant[]) {
      const { container } = render(
        <Toast messages={[{ id: 1, text: v, variant: v }]} onDismiss={() => {}} />,
      );
      expect(container.innerHTML).toContain(`--severity-${v}-bg`);
      expect(container.innerHTML).toContain(`--severity-${v}-fg`);
      expect(container.innerHTML).toContain(`--severity-${v}-border`);
    }
  });

  it("VARIANT_CLASSES uses no raw Tailwind color literals (E2)", () => {
    // Isolate the VARIANT_CLASSES block and assert it is token-only.
    const block = TOAST.slice(
      TOAST.indexOf("VARIANT_CLASSES"),
      TOAST.indexOf("/** Simple auto-dismiss"),
    );
    expect(block).not.toMatch(/\b(bg|text|border)-(red|green|amber|emerald|blue|orange)-\d/);
    // 5 tiers x {box, close}, each color via var(--severity-…).
    expect(block.match(/--severity-/g)?.length ?? 0).toBeGreaterThanOrEqual(5 * 4);
  });
});

describe("useToast.showToast default (E1)", () => {
  it("defaults to neutral when called without a variant", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("boom");
    });
    expect(result.current.messages[0].variant).toBe("neutral");
  });

  it("accepts an explicit variant", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("yay", "success");
    });
    expect(result.current.messages[0].variant).toBe("success");
  });
});

describe("single canonical ToastVariant (E3)", () => {
  it("Toast.tsx declares the 5-member union", () => {
    const union = TOAST.slice(
      TOAST.indexOf("export type ToastVariant"),
      TOAST.indexOf("export type ToastVariant") + 160,
    );
    for (const m of ["error", "warning", "success", "info", "neutral"]) {
      expect(union).toContain(`"${m}"`);
    }
  });

  it("useAsyncAction re-exports it (no 2nd declaration)", () => {
    expect(USE_ASYNC).toMatch(/import type \{ ToastVariant \} from "\.\.\/components\/primitives\/Toast\.js"/);
    expect(USE_ASYNC).toMatch(/export type \{ ToastVariant \}/);
    // The stale local `export type ToastVariant = "error" | ...` is gone.
    expect(USE_ASYNC).not.toMatch(/export type ToastVariant =/);
  });
});

describe("ToastSlot.levelClass protocol bridge (E4)", () => {
  const block = TOAST_SLOT.slice(
    TOAST_SLOT.indexOf("function levelClass"),
    TOAST_SLOT.indexOf("function levelClass") + 700,
  );
  it("warn maps to --severity-warning-* (name bridge)", () => {
    expect(block).toMatch(/case "warn":\s*return[^;]*--severity-warning-bg/);
  });
  it("success/error/info map to matching --severity tokens", () => {
    expect(block).toMatch(/case "success":\s*return[^;]*--severity-success-bg/);
    expect(block).toMatch(/case "error":\s*return[^;]*--severity-error-bg/);
    expect(block).toMatch(/default:\s*return[^;]*--severity-info-bg/);
  });
  it("never emits the non-existent --severity-warn- token", () => {
    expect(TOAST_SLOT).not.toContain("--severity-warn-");
  });
});

describe("call-site tagging (E5, E6)", () => {
  it("spawn-result effect is split into success/error branches, not a trailing tag (E5)", () => {
    // The old single-ternary form must be gone.
    expect(SESSION_LIST).not.toMatch(/showToast\(\s*spawnResult\.success \?/);
    // Explicit success + error branches present.
    expect(SESSION_LIST).toMatch(/if \(spawnResult\.success\)/);
    expect(SESSION_LIST).toMatch(/showToast\(spawnResult\.message, "success"\)/);
    expect(SESSION_LIST).toMatch(/"\+Session failed"\)}: \$\{spawnResult\.message\}`,\s*"error"/s);
  });

  it("notifyError → error, Committed → success (E6)", () => {
    expect(APP).toMatch(/notifyError: \(msg\) => showToast\(msg, "error"\)/);
    expect(APP).toMatch(/showToast\(`Committed \$\{shortHash\}`, "success"\)/);
  });
});

describe("useAsyncAction still-working hint is neutral (E7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ws-timeout hint calls showToast with 'neutral'", () => {
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useAsyncAction(() => new Promise<void>(() => {}), {
        confirm: "ws",
        showToast,
        onMessage: () => () => {},
        confirmEvent: () => false,
        confirmTimeoutMs: 100,
      }),
    );
    act(() => {
      result.current.run();
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(showToast).toHaveBeenCalledWith(expect.any(String), "neutral");
    const variants = showToast.mock.calls.map((c) => c[1]);
    expect(variants).not.toContain("info");
  });
});

describe("no raw severity literals in migrated surfaces (E8)", () => {
  const LITERALS = /bg-red-900|bg-green-900|bg-red-500|bg-amber-500|text-red-300/;
  it("Toast, SpawnErrorToastHost, SpawnErrorBanner, ToastSlot are literal-free", () => {
    expect(TOAST).not.toMatch(LITERALS);
    expect(SPAWN_HOST).not.toMatch(LITERALS);
    expect(SPAWN_BANNER).not.toMatch(LITERALS);
    expect(TOAST_SLOT).not.toMatch(LITERALS);
    // Also assert no residual red/amber/emerald color utilities in these files.
    for (const f of [TOAST, SPAWN_HOST, SPAWN_BANNER, TOAST_SLOT]) {
      expect(f).not.toMatch(/\b(bg|text|border)-(red|amber|emerald|green)-\d/);
    }
  });
});

describe("no bare error-intent showToast (E9)", () => {
  it("known error sites all pass explicit 'error'", () => {
    // notifyError is the app-wide error channel; must not be a bare call.
    expect(APP).not.toMatch(/notifyError: \(msg\) => showToast\(msg\)\s*,/);
    // Spawn failure branch carries "error".
    expect(SESSION_LIST).toMatch(/`,\s*"error",?\s*\);/s);
  });
});

describe("severity token definitions (E10, E11)", () => {
  it("neutral maps to literal base tokens, not a --text-muted mix (E10)", () => {
    expect(INDEX_CSS).toMatch(/--severity-neutral-bg:\s*var\(--bg-tertiary\)/);
    expect(INDEX_CSS).toMatch(/--severity-neutral-fg:\s*var\(--text-secondary\)/);
    expect(INDEX_CSS).toMatch(/--severity-neutral-border:\s*var\(--border-primary\)/);
    // Neutral is NOT derived from --text-muted via color-mix.
    expect(INDEX_CSS).not.toMatch(/--severity-neutral-[a-z]+:\s*color-mix[^;]*--text-muted/);
  });

  it("--severity-info is its own declaration, separate from --status-notice (E11)", () => {
    expect(INDEX_CSS).toMatch(/--severity-info-bg:\s*color-mix\(in srgb, var\(--accent-blue\)/);
    expect(INDEX_CSS).toMatch(/--status-notice:\s*var\(--accent-blue\)/);
    // They are distinct property names (may share the base accent).
    expect(INDEX_CSS).not.toMatch(/--severity-info[a-z-]*:\s*var\(--status-notice\)/);
  });
});
