import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ConfirmRenderer } from "../interactive-renderers/ConfirmRenderer.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const baseProps = {
  requestId: "req-1",
  method: "confirm",
  params: { title: "Initialize git?" },
};

describe("ConfirmRenderer", () => {
  describe("pending state", () => {
    it("renders Yes and No labels (not Allow/Deny)", () => {
      render(<ConfirmRenderer {...baseProps} status="pending" onRespond={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Yes")).toBeTruthy();
      expect(screen.getByText("No")).toBeTruthy();
      expect(screen.queryByText("Allow")).toBeNull();
      expect(screen.queryByText("Deny")).toBeNull();
    });

    it("Yes responds confirmed=true, No responds confirmed=false", () => {
      const onRespond = vi.fn();
      render(<ConfirmRenderer {...baseProps} status="pending" onRespond={onRespond} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText("Yes"));
      expect(onRespond).toHaveBeenCalledWith({ confirmed: true });
      fireEvent.click(screen.getByText("No"));
      expect(onRespond).toHaveBeenCalledWith({ confirmed: false });
    });
  });

  describe("resolved state", () => {
    it("renders BOTH Yes and No with the chosen one highlighted", () => {
      render(
        <ConfirmRenderer
          {...baseProps}
          status="resolved"
          result={{ confirmed: true }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      // Both options present in the resolved card.
      expect(screen.getByText("Yes")).toBeTruthy();
      expect(screen.getByText("No")).toBeTruthy();
      // Question kept as title.
      expect(screen.getByText("Initialize git?")).toBeTruthy();
    });

    it("renders both options when denied", () => {
      render(
        <ConfirmRenderer
          {...baseProps}
          status="resolved"
          result={{ confirmed: false }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("Yes")).toBeTruthy();
      expect(screen.getByText("No")).toBeTruthy();
    });
  });

  describe("cancelled state", () => {
    it("displays Cancelled label", () => {
      render(<ConfirmRenderer {...baseProps} status="cancelled" onRespond={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Cancelled")).toBeTruthy();
    });
  });

  describe("dismissed state", () => {
    it("displays Answered in terminal label", () => {
      render(<ConfirmRenderer {...baseProps} status="dismissed" onRespond={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Answered in terminal")).toBeTruthy();
    });
  });
});

describe("ConfirmRenderer — resolved shows message body (change: fix-ask-user-card-duplication)", () => {
  const MSG = "Please review carefully.";
  it("renders params.message in the resolved state", () => {
    render(
      <ThemeProvider>
        <ConfirmRenderer
        requestId="r" method="confirm"
        params={{ title: "Initialize git?", message: MSG }}
        status="resolved" result={{ confirmed: true }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.getByText(MSG)).toBeTruthy();
  });
  it("renders no message body when params.message is absent", () => {
    render(
      <ThemeProvider>
        <ConfirmRenderer
        requestId="r" method="confirm"
        params={{ title: "Initialize git?" }}
        status="resolved" result={{ confirmed: true }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.queryByText(MSG)).toBeNull();
  });
});
