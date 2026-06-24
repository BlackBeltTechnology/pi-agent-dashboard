/**
 * IntentRenderer — the shell-side component that walks an IntentNode tree,
 * resolves each `primitive` name to a registered React `ComponentType` via
 * `useUiPrimitive`, and recursively renders.
 *
 * Plugins describe what to render as JSON intent trees (no React code on
 * the server). Each connected client runs IntentRenderer against incoming
 * intents and renders identically — multi-client coherence falls out of
 * the architecture because the wire format is data-only.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import React, { isValidElement } from "react";
import type {
  IntentNode,
  ActionDescriptor,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/intent-types.js";
import { useUiPrimitiveOrNull } from "./ui-primitive-context.js";

/**
 * Type guard: is the given value an IntentNode? Used to recursively render
 * IntentNodes that appear as prop values inside other IntentNodes.
 */
export function isIntentNode(v: unknown): v is IntentNode {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as IntentNode).primitive === "string"
  );
}

/** Callback shape used by IntentRenderer to dispatch actions to the server. */
export type IntentActionSender = (action: string, payload: unknown) => void;

export interface IntentRendererProps {
  /** The intent tree to render. */
  intent: IntentNode;
  /** The pluginId that emitted this intent (used for action routing). */
  pluginId: string;
  /** Sends a plugin_action message back to the server. */
  send: IntentActionSender;
}

/**
 * Walk the intent's `props`, replacing any nested IntentNode values with
 * `<IntentRenderer>` JSX elements. Arrays of IntentNodes are mapped to
 * arrays of JSX elements (each with its own key from `intent.key` or array
 * index).
 *
 * Non-intent values pass through unchanged.
 */
function resolveProps(
  props: Record<string, unknown> | undefined,
  pluginId: string,
  send: IntentActionSender,
): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (isIntentNode(v)) {
      // Recurse: child IntentNode becomes a React element.
      out[k] = (
        <IntentRenderer
          key={v.key}
          intent={v}
          pluginId={pluginId}
          send={send}
        />
      );
    } else if (Array.isArray(v)) {
      // Array of mixed values: render IntentNodes, pass others through.
      out[k] = v.map((item, i) =>
        isIntentNode(item) ? (
          <IntentRenderer
            key={item.key ?? i}
            intent={item}
            pluginId={pluginId}
            send={send}
          />
        ) : item,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Convert intent.actions descriptors into React-style handlers. Each
 * descriptor becomes a function that calls `send(action, payload)`.
 *
 * Returns a Record keyed by the action name (`onClick`, `onSubmit`, etc.).
 */
function wireActions(
  actions: Record<string, ActionDescriptor> | undefined,
  send: IntentActionSender,
): Record<string, () => void> {
  if (!actions) return {};
  const out: Record<string, () => void> = {};
  for (const [eventName, descriptor] of Object.entries(actions)) {
    out[eventName] = () => send(descriptor.action, descriptor.payload);
  }
  return out;
}

/** Fallback rendered when a primitive name is not registered. */
export function UnknownPrimitive({
  name,
  pluginId,
}: {
  name: string;
  pluginId: string;
}): React.ReactElement {
  return (
    <span
      style={{
        display: "inline-block",
        border: "1px dashed rgb(239, 68, 68)",
        color: "rgb(239, 68, 68)",
        padding: "2px 6px",
        fontSize: "11px",
        fontFamily: "monospace",
        borderRadius: 4,
      }}
      title={`Plugin "${pluginId}" emitted an intent referencing the unknown primitive "${name}". The dashboard's main.tsx may be missing a registerUiPrimitive call for this key.`}
      data-intent-unknown-primitive={name}
    >
      Unknown primitive: {name}
    </span>
  );
}

/**
 * Render an IntentNode by resolving its primitive name and recursively
 * rendering children.
 *
 * Unknown primitive → renders `<UnknownPrimitive>` placeholder; siblings
 * render normally.
 *
 * Per-claim error isolation: callers SHOULD wrap IntentRenderer in
 * `SlotErrorBoundary` so a single-plugin throw doesn't crash the slot.
 */
export function IntentRenderer({
  intent,
  pluginId,
  send,
}: IntentRendererProps): React.ReactElement {
  const Component = useUiPrimitiveOrNull(intent.primitive as never);
  if (Component === null || Component === undefined) {
    return <UnknownPrimitive name={intent.primitive} pluginId={pluginId} />;
  }

  const resolvedProps = resolveProps(intent.props, pluginId, send);
  const wiredHandlers = wireActions(intent.actions, send);

  // wiredHandlers may overlap with resolvedProps if the plugin emits both
  // an action descriptor for "onClick" AND a prop named "onClick"; handlers
  // take precedence (they're the canonical wire format).
  const allProps = { ...resolvedProps, ...wiredHandlers };

  // useUiPrimitive returns the registered impl which we type as
  // unknown-shape ComponentType. Cast through unknown to bypass the strict
  // typing per-primitive — actual prop validation is the primitive's job.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const C = Component as React.ComponentType<any>;
  // Note: isValidElement isn't currently called but kept imported for
  // possible future use (e.g. detecting already-resolved React elements in
  // props during diff/HMR).
  void isValidElement;
  return <C {...allProps} key={intent.key} />;
}
