import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ArchitectInputPrompt } from "../client/FlowArchitect.js";

afterEach(cleanup);

const basePrompt = {
  id: "prompt-1",
  type: "input" as const,
  question: "What should be changed?",
};

describe("ArchitectInputPrompt", () => {
  it("renders question and input field", () => {
    render(
      <ArchitectInputPrompt prompt={basePrompt} onRespond={vi.fn()} />,
    );

    expect(screen.getByText("What should be changed?")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("submits empty string via Enter key", () => {
    const onRespond = vi.fn();
    render(
      <ArchitectInputPrompt prompt={basePrompt} onRespond={onRespond} />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onRespond).toHaveBeenCalledWith("");
  });

  it("submits empty string via button click", () => {
    const onRespond = vi.fn();
    render(
      <ArchitectInputPrompt prompt={basePrompt} onRespond={onRespond} />,
    );

    fireEvent.click(screen.getByText("Submit"));

    expect(onRespond).toHaveBeenCalledWith("");
  });

  it("submits entered text via Enter key", () => {
    const onRespond = vi.fn();
    render(
      <ArchitectInputPrompt prompt={basePrompt} onRespond={onRespond} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Fix the bug" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onRespond).toHaveBeenCalledWith("Fix the bug");
  });

  it("trims whitespace from submitted text", () => {
    const onRespond = vi.fn();
    render(
      <ArchitectInputPrompt prompt={basePrompt} onRespond={onRespond} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  hello  " } });
    fireEvent.click(screen.getByText("Submit"));

    expect(onRespond).toHaveBeenCalledWith("hello");
  });

  it("uses defaultValue from prompt", () => {
    const onRespond = vi.fn();
    render(
      <ArchitectInputPrompt
        prompt={{ ...basePrompt, defaultValue: "prefilled" }}
        onRespond={onRespond}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveProperty("value", "prefilled");
  });
});
