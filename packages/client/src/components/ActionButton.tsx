import React from "react";
import { useAsyncAction, type UseAsyncActionOptions } from "../hooks/useAsyncAction.js";

export interface ActionButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** The async action to run on click. */
  action: () => Promise<unknown>;
  /** Options forwarded to useAsyncAction (toast sink, confirm mode, etc.). */
  options?: UseAsyncActionOptions<unknown>;
  /** Label swapped in while the action is pending. */
  pendingLabel?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Thin convenience wrapper over {@link useAsyncAction}.bind: spinner/label-swap
 * + disable baked in for the common "button fires one action" case.
 */
export function ActionButton({
  action,
  options,
  pendingLabel,
  children,
  disabled,
  type = "button",
  ...rest
}: ActionButtonProps) {
  const { pending, bind } = useAsyncAction(action, options);
  return (
    <button
      {...rest}
      type={type}
      onClick={bind.onClick}
      disabled={disabled || bind.disabled}
    >
      {pending && pendingLabel != null ? pendingLabel : children}
    </button>
  );
}
