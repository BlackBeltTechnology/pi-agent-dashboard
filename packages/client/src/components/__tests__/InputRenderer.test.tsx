import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { InputRenderer } from "../interactive-renderers/InputRenderer.js";
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
  method: "input",
  params: { title: "Enter your name" },
};

describe("InputRenderer", () => {
  describe("pending state", () => {
    it("renders title and input field", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Enter your name")).toBeTruthy();
      expect(screen.getByRole("textbox")).toBeTruthy();
    });

    it("renders Submit and Cancel buttons", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Submit")).toBeTruthy();
      expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("Submit button is not disabled when input is empty", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      const submitBtn = screen.getByText("Submit");
      expect(submitBtn.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("empty submission", () => {
    it("plain Enter inserts a newline and does NOT submit", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

      expect(onRespond).not.toHaveBeenCalled();
    });

    it("submits empty string via button click", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText("Submit"));

      expect(onRespond).toHaveBeenCalledWith({ value: "", images: undefined });
    });
  });

  describe("non-empty submission", () => {
    it("submits entered text via Cmd/Ctrl+Enter", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Alice" } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });

      expect(onRespond).toHaveBeenCalledWith({ value: "Alice", images: undefined });
    });

    it("submits entered text via button click", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bob" } });
      fireEvent.click(screen.getByText("Submit"));

      expect(onRespond).toHaveBeenCalledWith({ value: "Bob", images: undefined });
    });
  });

  describe("cancel", () => {
    it("calls onCancel when clicking Cancel", () => {
      const onCancel = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={vi.fn()}
          onCancel={onCancel}
        />,
      );

      fireEvent.click(screen.getByText("Cancel"));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("resolved state", () => {
    it("keeps the question as title and shows the value in a read-only field", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="resolved"
          result={{ value: "Alice" }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Enter your name")).toBeTruthy();
      expect(screen.getByText("Alice")).toBeTruthy();
    });

    it("renders (left blank) for an empty submitted value", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="resolved"
          result={{ value: "" }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("(left blank)")).toBeTruthy();
    });

    it("shows a +N image pill when the answer carried images", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="resolved"
          result={{ value: "see attached", images: [
            { type: "image", data: "AAA", mimeType: "image/png" },
            { type: "image", data: "BBB", mimeType: "image/jpeg" },
          ] }}
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText(/\+2 images/)).toBeTruthy();
    });
  });

  describe("image paste", () => {
    it("submit includes pasted images", () => {
      const onRespond = vi.fn();
      render(
        <InputRenderer
          {...baseProps}
          status="pending"
          onRespond={onRespond}
          onCancel={vi.fn()}
        />,
      );

      const file = new File(["x"], "shot.png", { type: "image/png" });
      fireEvent.paste(screen.getByRole("textbox"), {
        clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
      });
      // FileReader is async; the assertion below only checks the no-image
      // path stays correct synchronously. Coverage of the rest lives elsewhere:
      // the async paste path (image -> base64 pending images) and submit
      // payload are exercised client-side by useImagePaste +
      // chat-input-images-integration; ask-user-tool tests only assert UI
      // surfacing with ctx.ui.inputWithImages mocked (no real bridge
      // persistence); ask-user-attachments covers persistAttachment dedup/
      // caps/cleanup. The full bridge wiring that persists, emits
      // asset_register, and returns {path,mimeType,bytes} into the
      // ask-user-tool flow is not asserted by any test.
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
      fireEvent.click(screen.getByText("Submit"));
      expect(onRespond).toHaveBeenCalled();
      const arg = onRespond.mock.calls[0][0];
      expect(arg.value).toBe("hi");
    });
  });

  describe("cancelled state", () => {
    it("displays Cancelled label", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="cancelled"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Cancelled")).toBeTruthy();
    });
  });

  describe("dismissed state", () => {
    it("displays Answered in terminal label", () => {
      render(
        <InputRenderer
          {...baseProps}
          status="dismissed"
          onRespond={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(screen.getByText("Answered in terminal")).toBeTruthy();
    });
  });
});

describe("InputRenderer — resolved shows message body (change: fix-ask-user-card-duplication)", () => {
  const MSG = "Your full legal name.";
  it("renders params.message in the resolved state", () => {
    render(
      <ThemeProvider>
        <InputRenderer
        requestId="r" method="input"
        params={{ title: "Enter your name", message: MSG }}
        status="resolved" result={{ value: "Ada" }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.getByText(MSG)).toBeTruthy();
  });
  it("renders no message body when params.message is absent", () => {
    render(
      <ThemeProvider>
        <InputRenderer
        requestId="r" method="input"
        params={{ title: "Enter your name" }}
        status="resolved" result={{ value: "Ada" }}
        onRespond={vi.fn()} onCancel={vi.fn()}
      />
      </ThemeProvider>,
    );
    expect(screen.queryByText(MSG)).toBeNull();
  });
});
