/**
 * ProviderHealthPill unit tests — the register matrix re-authored here after
 * the LlmProviderCard suites were deleted with the card (change:
 * redesign-providers-settings-page). Cached-health registers render through
 * derivePillView; the live-result precedence (a Test response outranking the
 * cached health) is asserted on the same derivation the connected row and the
 * Add-dialog pane both feed.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderHealth } from "../../../lib/api/providers-api.js";
import { derivePillView, ProviderHealthPill } from "../ProviderHealthPill.js";

afterEach(cleanup);

/** Render the pill through the cached-health derivation, as both surfaces do. */
function renderPillFromHealth(health?: ProviderHealth) {
  render(<ProviderHealthPill view={derivePillView({ health })} />);
  return {
    pill: screen.getByTestId("health-pill"),
    errorLine: () => screen.queryByTestId("provider-error-line"),
  };
}

describe("ProviderHealthPill register matrix (moved from LlmProviderCard.health)", () => {
  it("connected register: green pill with model count, no error line", () => {
    const { pill, errorLine } = renderPillFromHealth({ ok: true, status: 200, modelCount: 142, testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/142 models/);
    expect(errorLine()).toBeNull();
  });

  it("connected register with zero models: 'Connected' without a count", () => {
    const { pill } = renderPillFromHealth({ ok: true, modelCount: 0, testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/Connected/);
    expect(pill.textContent).not.toMatch(/models/);
  });

  it("error register: yellow pill with the HTTP status code + verbatim error line", () => {
    const { pill, errorLine } = renderPillFromHealth({ ok: false, status: 401, error: "invalid x-api-key", testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("error");
    expect(pill.textContent).toMatch(/401/);
    expect(errorLine()!.textContent).toBe("invalid x-api-key");
  });

  it("unreachable register: red pill + verbatim error line when there is no status", () => {
    const { pill, errorLine } = renderPillFromHealth({ ok: false, error: "getaddrinfo ENOTFOUND api.example.com", testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("unreachable");
    expect(pill.textContent).toMatch(/Unreachable/i);
    expect(errorLine()!.textContent).toBe("getaddrinfo ENOTFOUND api.example.com");
  });

  it("not-tested register: neutral pill, no error line, when no cached health", () => {
    const { pill, errorLine } = renderPillFromHealth(undefined);
    expect(pill.getAttribute("data-state")).toBe("not-tested");
    expect(errorLine()).toBeNull();
  });

  it("the verbatim error line preserves the FULL multi-line error string", () => {
    render(<ProviderHealthPill view={{ kind: "error", status: 500, error: "line one\nline two" }} />);
    expect(screen.getByTestId("provider-error-line").textContent).toBe("line one\nline two");
  });
});

describe("derivePillView precedence (the derivation the row and pane feed)", () => {
  it("a failed live Test result outranks cached-ok health", () => {
    expect(derivePillView({
      health: { ok: true, status: 200, modelCount: 5, testedAt: 1 },
      live: { ok: false, status: 403, error: "forbidden now" },
    })).toEqual({ kind: "error", status: 403, error: "forbidden now" });
  });

  it("an ok live Test result outranks cached-failure health", () => {
    expect(derivePillView({
      health: { ok: false, status: 401, error: "stale", testedAt: 1 },
      live: { ok: true, modelCount: 7 },
    })).toEqual({ kind: "ok", modelCount: 7 });
  });

  it("the testing register outranks everything while the probe is in flight", () => {
    expect(derivePillView({ testing: true, live: { ok: true, modelCount: 1 } })).toEqual({ kind: "testing" });
  });
});
