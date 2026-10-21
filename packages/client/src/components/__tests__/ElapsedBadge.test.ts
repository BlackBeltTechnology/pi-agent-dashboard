import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElapsedBadge, formatElapsed } from "../session/ElapsedBadge.js";

describe("formatElapsed", () => {
  it("shows <1s for sub-second durations", () => {
    expect(formatElapsed(0)).toBe("<1s");
    expect(formatElapsed(500)).toBe("<1s");
    expect(formatElapsed(999)).toBe("<1s");
  });

  it("shows seconds for < 60s", () => {
    expect(formatElapsed(1000)).toBe("1s");
    expect(formatElapsed(3500)).toBe("3s");
    expect(formatElapsed(59999)).toBe("59s");
  });

  it("shows minutes and seconds for >= 60s", () => {
    expect(formatElapsed(60000)).toBe("1m");
    expect(formatElapsed(90000)).toBe("1m 30s");
    expect(formatElapsed(125000)).toBe("2m 5s");
  });

  it("shows hours and minutes for >= 60m", () => {
    expect(formatElapsed(3600000)).toBe("1h");
    expect(formatElapsed(5400000)).toBe("1h 30m");
  });
});

describe("ElapsedBadge (ui:elapsed-badge, test-plan #E31)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ticks a live counter from startedAt", () => {
    const { container } = render(createElement(ElapsedBadge, { startedAt: Date.now() }));
    expect(container.textContent).toBe("<1s…");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toBe("1s…");
  });

  it("shows a static duration that wins over startedAt", () => {
    const { container } = render(createElement(ElapsedBadge, { startedAt: Date.now(), duration: 65000 }));
    expect(container.textContent).toBe("1m 5s");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.textContent).toBe("1m 5s");
  });
});
