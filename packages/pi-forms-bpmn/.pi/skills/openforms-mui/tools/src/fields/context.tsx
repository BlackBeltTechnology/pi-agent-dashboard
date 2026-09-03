import type { JSX } from "react";
import { createContext, useContext } from "react";
import type { Translator } from "../i18n/index.js";
import type { FormLogicState } from "../logic/state.js";

/** A pluggable signature implementation (design D10). */
export interface SignatureComponentProps {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  ariaLabel: string;
  clearLabel: string;
}

export interface OpenFormsContextValue {
  t: Translator;
  readOnly: boolean;
  state: FormLogicState;
  /** Optional replacement for the built-in signature canvas. */
  SignatureComponent?: (props: SignatureComponentProps) => JSX.Element;
  /** Which marker convention is in force for the currently-visible fields. */
  markerMode: "mark-required" | "mark-optional" | "all-required" | "none";
}

const OpenFormsContext = createContext<OpenFormsContextValue | null>(null);

export const OpenFormsProvider = OpenFormsContext.Provider;

export function useOpenForms(): OpenFormsContextValue {
  const ctx = useContext(OpenFormsContext);
  if (!ctx) throw new Error("OpenForms field rendered outside of <OpenFormsMui>.");
  return ctx;
}
