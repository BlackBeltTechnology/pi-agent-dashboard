/**
 * Per-claim error boundary.
 * Wraps each slot contribution individually so one failing plugin
 * does not suppress sibling contributions in the same slot.
 */
import React, { Component, type ReactNode } from "react";

interface Props {
  pluginId: string;
  slotId: string;
  children: ReactNode;
  /** Rendered instead of `null` when the claim throws (default `null`: every other slot stays silent).
   *  See change: fix-ui-status-indicators (design D3). */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class SlotErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(
      `[slot-error-boundary] Plugin "${this.props.pluginId}" slot "${this.props.slotId}" threw:`,
      error,
    );
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
