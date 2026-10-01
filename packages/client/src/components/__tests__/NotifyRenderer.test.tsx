/**
 * NotifyRenderer re-toned onto the shared InlineMessage primitive.
 *
 * `notifyMinLevel` promotes a notify's `level` from decoration to the input of
 * a visibility filter, so the level must be perceivable without colour: accent
 * bar + icon + level word, sourced from `--severity-*` tokens rather than the
 * old `text-{blue,green,yellow,red}-400` literals.
 *
 * Covers test-plan #F10, #F11, #F12, #F13, #F14, #F17, #F18.
 * See change: gate-notify-rows-by-level.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n/i18n.js";
import { NotifyRenderer } from "../interactive-renderers/NotifyRenderer.js";
import { InlineMessage } from "../primitives/InlineMessage.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, rel), "utf8");
const NOTIFY_SRC = src("../interactive-renderers/NotifyRenderer.tsx");

// ThemeProvider (needed by MarkdownContent) reads prefers-color-scheme.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

/** Render a notify row the way the interactive-renderer registry does. */
function renderNotify(params: Record<string, unknown>) {
  return render(
    <ThemeProvider>
      <NotifyRenderer
        requestId="n1"
        method="notify"
        params={params}
        status="pending"
        onRespond={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
  );
}

const LEVELS = ["info", "success", "warning", "error"] as const;
const LEVEL_TO_TIER: Record<(typeof LEVELS)[number], string> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

describe("NotifyRenderer — severity tokens (test-plan #F11, #F12)", () => {
  // 2.22 / #F11 — the literal scan, matching Toast.test.tsx's technique.
  it("contains no raw severity colour literal", () => {
    expect(NOTIFY_SRC).not.toMatch(/text-blue-400/);
    expect(NOTIFY_SRC).not.toMatch(/text-green-400/);
    expect(NOTIFY_SRC).not.toMatch(/text-yellow-400/);
    expect(NOTIFY_SRC).not.toMatch(/text-red-400/);
    // The old hand-rolled colour map is gone entirely.
    expect(NOTIFY_SRC).not.toMatch(/levelColors/);
  });

  // 2.23 / #F12 — each level resolves its own tier's tokens.
  it.each(LEVELS)("resolves %s from its --severity-* triple", (level) => {
    const { getByTestId } = renderNotify({ message: "hello", level });
    const html = getByTestId("inline-message").outerHTML;
    const tier = LEVEL_TO_TIER[level];
    expect(html).toContain(`--severity-${tier}-bg`);
    expect(html).toContain(`--severity-${tier}-border`);
    expect(html).toContain(`--severity-${tier}-fg`);
  });

  // 2.23 / #F12 — warning is orange-derived, never a yellow literal.
  it("maps warning to the orange-derived warning tier, not yellow", () => {
    const { getByTestId } = renderNotify({ message: "hello", level: "warning" });
    const html = getByTestId("inline-message").outerHTML;
    expect(html).toContain("--severity-warning-fg");
    expect(html).not.toMatch(/yellow-\d{3}/);
  });

  // 2.23 / #F12 — success really gained a union member (no info fallback).
  it("maps success to the success tone, not a fallback to info", () => {
    const { getByTestId } = renderNotify({ message: "hello", level: "success" });
    const html = getByTestId("inline-message").outerHTML;
    expect(html).toContain("--severity-success-bg");
    expect(html).not.toContain("--severity-info-bg");
  });
});

describe("NotifyRenderer — level without colour (test-plan #F10)", () => {
  // 2.21: bar + icon + word, so the filter's input survives colour removal.
  it.each(LEVELS)("renders an icon and the level word for %s", (level) => {
    const { getByTestId, container } = renderNotify({ message: "hello", level });
    // Accent bar (channel 1) and icon (channel 2).
    expect(getByTestId("inline-message-accent")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    // Level word (channel 3) — recoverable as text with colour discarded.
    expect(container.textContent?.toLowerCase()).toContain(level);
  });

  it("gives each level a DISTINCT icon", () => {
    const paths = LEVELS.map((level) => {
      const { container, unmount } = renderNotify({ message: "hello", level });
      const d = container.querySelector("svg path")?.getAttribute("d") ?? "";
      unmount();
      return d;
    });
    expect(new Set(paths).size).toBe(LEVELS.length);
  });

  it("keeps the four levels mutually distinguishable by text alone", () => {
    const words = LEVELS.map((level) => {
      const { container, unmount } = renderNotify({ message: "same body", level });
      const text = container.textContent ?? "";
      unmount();
      return text;
    });
    expect(new Set(words).size).toBe(LEVELS.length);
  });
});

describe("NotifyRenderer — behaviour preserved through the migration", () => {
  // 2.26 / #F17
  it.each([
    [{ message: undefined, title: undefined }],
    [{ message: 42, title: undefined }],
    [{ message: undefined, title: {} }],
    [{}],
  ])("renders nothing for an empty/non-string payload (%p)", (params) => {
    const { container } = renderNotify(params as Record<string, unknown>);
    expect(container.innerHTML).toBe("");
  });

  // 2.26 / #F17 — the legacy pre-split fallback still resolves.
  it("falls back to params.title when message is absent", () => {
    const { container } = renderNotify({ title: "legacy title" });
    expect(container.textContent).toContain("legacy title");
  });

  // 2.27 / #F18
  it("still renders the markdown body", () => {
    const { container } = renderNotify({
      message: "**bold** and `code`",
      level: "info",
    });
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("treats an unrecognized level as info", () => {
    const { getByTestId } = renderNotify({ message: "hello", level: "critical" });
    expect(getByTestId("inline-message").outerHTML).toContain("--severity-info-bg");
  });

  // A bare `in` check matches Object.prototype names, so these destructured a
  // FUNCTION and crashed InlineMessage on `tone.bg`. See CodeRabbit, PR #453.
  it.each([["toString"], ["constructor"], ["valueOf"], ["hasOwnProperty"], ["__proto__"]])(
    "renders an inherited-property level (%p) as info instead of crashing",
    (level) => {
      const { getByTestId, container } = renderNotify({ message: "hello", level });
      expect(getByTestId("inline-message").outerHTML).toContain("--severity-info-bg");
      expect(container.textContent).toContain("hello");
    },
  );
});

describe("InlineMessage success member (test-plan #F13, #F14)", () => {
  // 2.24 / #F13 — widening the union must not disturb the existing three.
  it.each(["error", "warning", "info"] as const)(
    "leaves %s resolving its own tokens after the union widened",
    (severity) => {
      const { getByTestId } = render(
        <InlineMessage severity={severity} icon="M0 0h24v24H0z" title="t" />,
      );
      const html = getByTestId("inline-message").outerHTML;
      expect(html).toContain(`--severity-${severity}-bg`);
      expect(html).toContain(`--severity-${severity}-border`);
      expect(html).toContain(`--severity-${severity}-fg`);
    },
  );

  it("renders success from --severity-success-* with no raw literal", () => {
    const { getByTestId } = render(
      <InlineMessage severity="success" icon="M0 0h24v24H0z" title="done" />,
    );
    const html = getByTestId("inline-message").outerHTML;
    expect(html).toContain("--severity-success-bg");
    expect(html).toContain("--severity-success-border");
    expect(html).toContain("--severity-success-fg");
    expect(html).not.toMatch(/\bgreen-\d{3}\b/);
  });

  // 2.25 / #F14 — the pre-existing consumers of the success triple are
  // untouched. (The change adds a consumer; it is not the first.)
  it("leaves the existing --severity-success-* consumers in place", () => {
    const toast = src("../primitives/Toast.tsx");
    const toastSlot = src("../extension-ui/ToastSlot.tsx");
    expect(toast).toContain("--severity-success-bg");
    expect(toastSlot).toContain("--severity-success-bg");
  });
});

// ── collapse-and-order-notify-rows: repeat badge ────────────────────
// See test-plan #E15, #E16, #E17.

describe("NotifyRenderer — repeat badge (test-plan #E15)", () => {
  // Same local day, 17:27 → 18:57.
  const first = new Date(2026, 8, 23, 17, 27).getTime();
  const last = new Date(2026, 8, 23, 18, 57).getTime();

  it("count > 1 renders ×N, the time range and an accessible label; level icon + word stay", () => {
    const { container, getByTestId } = renderNotify({
      message: "m",
      level: "warning",
      repeat: { count: 10, firstTs: first, lastTs: last },
    });
    expect(getByTestId("notify-repeat-count").textContent).toBe("×10");
    const range = getByTestId("notify-repeat-range").textContent ?? "";
    // Locale-formatted (design D4): en renders 12h, 24h locales HH:MM.
    expect(range).toMatch(/^(17:27|05:27\sPM)–(18:57|06:57\sPM)$/);
    const label = getByTestId("notify-repeat").getAttribute("aria-label") ?? "";
    expect(label).toContain("10");
    expect(label).toContain(range);
    // The level channels are untouched.
    expect(container.textContent).toContain("Warning");
    expect(getByTestId("inline-message").querySelector("svg")).not.toBeNull();
  });

  it("count 1 and no annotation render identically to the baseline", () => {
    const baseline = renderNotify({ message: "m", level: "warning" }).container.innerHTML;
    cleanup();
    const one = renderNotify({
      message: "m",
      level: "warning",
      repeat: { count: 1, firstTs: first, lastTs: first },
    }).container.innerHTML;
    expect(one).toBe(baseline);
    expect(baseline).not.toContain("notify-repeat");
  });
});

describe("NotifyRenderer — out-of-range timestamps (review round 1)", () => {
  // The server accepts any finite ts > 0; 1e300 is outside the Date range and
  // Intl.DateTimeFormat.format would throw a RangeError on it.
  it("renders the count without crashing and omits the unrenderable range", () => {
    const { getByTestId, queryByTestId } = renderNotify({
      message: "m",
      repeat: { count: 4, firstTs: 1e300, lastTs: 1e300 },
    });
    expect(getByTestId("notify-repeat-count").textContent).toBe("×4");
    expect(queryByTestId("notify-repeat-range")).toBeNull();
    expect(getByTestId("notify-repeat").getAttribute("aria-label")).toBe("Repeated 4 times");
  });
});

describe("NotifyRenderer — range across days (test-plan #E16)", () => {
  it("same day → HH:MM–HH:MM; different days → both ends carry a short date", () => {
    const sameDay = renderNotify({
      message: "m",
      repeat: { count: 2, firstTs: new Date(2026, 8, 23, 9, 5).getTime(), lastTs: new Date(2026, 8, 23, 9, 40).getTime() },
    });
    expect(sameDay.getByTestId("notify-repeat-range").textContent).toMatch(/^09:05(\sAM)?–09:40(\sAM)?$/);
    cleanup();

    const crossDay = renderNotify({
      message: "m",
      repeat: { count: 2, firstTs: new Date(2026, 8, 23, 23, 50).getTime(), lastTs: new Date(2026, 8, 24, 0, 10).getTime() },
    });
    const text = crossDay.getByTestId("notify-repeat-range").textContent ?? "";
    const [a, b] = text.split("–");
    expect(a).toMatch(/23/);
    expect(a).toMatch(/Sep/);
    expect(b).toMatch(/24/);
    expect(b).toMatch(/Sep/);
  });
});

describe("NotifyRenderer — localized badge (test-plan #E17)", () => {
  const repeat = { count: 3, firstTs: new Date(2026, 8, 23, 9, 5).getTime(), lastTs: new Date(2026, 8, 23, 9, 40).getTime() };
  const englishLabel = "Repeated 3 times";

  function renderIn(language: string) {
    window.localStorage.setItem("pi-dashboard-language", language);
    try {
      return render(
        <I18nProvider>
          <ThemeProvider>
            <NotifyRenderer requestId="n1" method="notify" params={{ message: "m", repeat }} status="pending" onRespond={() => {}} onCancel={() => {}} />
          </ThemeProvider>
        </I18nProvider>,
      );
    } finally {
      window.localStorage.removeItem("pi-dashboard-language");
    }
  }

  it.each([
    ["hu", "3×", "3 alkalommal ismételve"],
    ["zh-CN", "3 次", "重复 3 次"],
  ])("%s badge and label come from the catalog", (language, badge, labelStart) => {
    const { getByTestId } = renderIn(language);
    expect(getByTestId("notify-repeat-count").textContent).toBe(badge);
    const label = getByTestId("notify-repeat").getAttribute("aria-label") ?? "";
    expect(label.startsWith(labelStart)).toBe(true);
    expect(label).not.toContain(englishLabel);
  });
});
