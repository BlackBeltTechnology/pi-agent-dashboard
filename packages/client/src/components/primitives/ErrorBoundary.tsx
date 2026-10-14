import React, { Component, type ReactNode } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * When this value changes while the boundary shows its fallback, the error
   * state is cleared so the children are retried (e.g. the next streamed
   * markdown token). Omit for the previous sticky behavior.
   */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Generic error boundary that catches render errors and displays
 * a fallback instead of crashing the entire app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-2 text-xs text-red-400 bg-red-500/10 rounded border border-red-500/20">
          {i18nT("status.renderError", undefined, "Render error:")} {this.state.error?.message ?? "Unknown error"}
        </div>
      );
    }
    return this.props.children;
  }
}
