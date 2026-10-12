/**
 * Tests for IntentRenderer.
 *
 * See change: adopt-server-driven-intent-rendering.
 */

import type { IntentNode } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/intent-types.js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
  type UiPrimitiveRegistry,
} from "../index.js";
import { IntentRenderer, isIntentNode } from "../intent-renderer.js";

afterEach(() => cleanup());

// Helper to mount IntentRenderer with a registry containing arbitrary
// primitives for the test.
function renderWithRegistry(
  intent: IntentNode,
  primitives: Record<string, React.ComponentType<any>>,
  send: (action: string, payload: unknown) => void = () => {},
) {
  const reg = createUiPrimitiveRegistry();
  for (const [name, impl] of Object.entries(primitives)) {
    registerUiPrimitive(reg, name as never, impl as never);
  }
  return render(
    <UiPrimitiveProvider value={reg}>
      <IntentRenderer intent={intent} pluginId="test-plugin" send={send} />
    </UiPrimitiveProvider>,
  );
}

describe("isIntentNode", () => {
  it("returns true for objects with a string `primitive` field", () => {
    expect(isIntentNode({ primitive: "x" })).toBe(true);
  });
  it("returns false for plain strings, numbers, arrays, null", () => {
    expect(isIntentNode("x")).toBe(false);
    expect(isIntentNode(42)).toBe(false);
    expect(isIntentNode([])).toBe(false);
    expect(isIntentNode(null)).toBe(false);
    expect(isIntentNode(undefined)).toBe(false);
  });
  it("returns false for objects missing `primitive`", () => {
    expect(isIntentNode({ props: {} })).toBe(false);
  });
});

describe("IntentRenderer", () => {
  it("renders a simple primitive by name", () => {
    const Simple = ({ text }: { text: string }) => <span data-testid="simple">{text}</span>;
    const { getByTestId } = renderWithRegistry(
      { primitive: "test-simple", props: { text: "hello" } },
      { "test-simple": Simple },
    );
    expect(getByTestId("simple").textContent).toBe("hello");
  });

  it("renders nested IntentNode children inside props", () => {
    const Outer = ({ body }: { body: React.ReactNode }) => (
      <div data-testid="outer">{body}</div>
    );
    const Inner = ({ text }: { text: string }) => <span data-testid="inner">{text}</span>;
    const intent: IntentNode = {
      primitive: "test-outer",
      props: {
        body: { primitive: "test-inner", props: { text: "nested" } },
      },
    };
    const { getByTestId } = renderWithRegistry(intent, {
      "test-outer": Outer,
      "test-inner": Inner,
    });
    expect(getByTestId("outer").textContent).toBe("nested");
    expect(getByTestId("inner").textContent).toBe("nested");
  });

  it("renders arrays of IntentNodes inside props", () => {
    const List = ({ children }: { children: React.ReactNode[] }) => (
      <ul data-testid="list">
        {children.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    );
    const Item = ({ label }: { label: string }) => <span>{label}</span>;
    const intent: IntentNode = {
      primitive: "test-list",
      props: {
        children: [
          { primitive: "test-item", props: { label: "A" } },
          { primitive: "test-item", props: { label: "B" } },
        ],
      },
    };
    const { getByTestId } = renderWithRegistry(intent, {
      "test-list": List,
      "test-item": Item,
    });
    expect(getByTestId("list").textContent).toBe("AB");
  });

  it("renders UnknownPrimitive fallback when primitive is not registered", () => {
    const { container } = renderWithRegistry(
      { primitive: "does-not-exist" },
      {},
    );
    const fallback = container.querySelector('[data-intent-unknown-primitive="does-not-exist"]');
    expect(fallback).toBeTruthy();
    expect(fallback!.textContent).toContain("Unknown primitive: does-not-exist");
  });

  it("wires action descriptors to call send(action, payload)", () => {
    const Button = ({ onClick, label }: { onClick: () => void; label: string }) => (
      <button data-testid="btn" onClick={onClick}>{label}</button>
    );
    const send = vi.fn();
    const intent: IntentNode = {
      primitive: "test-button",
      props: { label: "Run" },
      actions: {
        onClick: { pluginId: "test-plugin", action: "do.it", payload: { foo: "bar" } },
      },
    };
    const { getByTestId } = renderWithRegistry(intent, { "test-button": Button }, send);
    fireEvent.click(getByTestId("btn"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("do.it", { foo: "bar" });
  });

  it("primitive-value props pass through unchanged (no IntentNode confusion)", () => {
    const Comp = (props: any) => <div data-testid="comp">{JSON.stringify(props)}</div>;
    const intent: IntentNode = {
      primitive: "test-comp",
      props: { num: 42, str: "x", bool: true, nested: { plain: "object" } },
    };
    const { getByTestId } = renderWithRegistry(intent, { "test-comp": Comp });
    const parsed = JSON.parse(getByTestId("comp").textContent!);
    expect(parsed.num).toBe(42);
    expect(parsed.str).toBe("x");
    expect(parsed.bool).toBe(true);
    expect(parsed.nested.plain).toBe("object");
  });

  it("action descriptor for onClick overrides any prop named onClick", () => {
    // Plugin shouldn't do this in practice, but if it does, the
    // action handler wins (it's the canonical wire format).
    const Button = ({ onClick, label }: { onClick: () => void; label: string }) => (
      <button data-testid="btn" onClick={onClick}>{label}</button>
    );
    const send = vi.fn();
    const intent: IntentNode = {
      primitive: "test-button",
      props: { label: "Run", onClick: "this should be ignored" },
      actions: {
        onClick: { pluginId: "test-plugin", action: "do.it" },
      },
    };
    const { getByTestId } = renderWithRegistry(intent, { "test-button": Button }, send);
    fireEvent.click(getByTestId("btn"));
    expect(send).toHaveBeenCalledWith("do.it", undefined);
  });
});
