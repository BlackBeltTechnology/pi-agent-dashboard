import type { CSSProperties } from "react";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ghcolors } from "react-syntax-highlighter/dist/esm/styles/prism";
import { nightOwl } from "react-syntax-highlighter/dist/esm/styles/prism";
import { solarizedDarkAtom } from "react-syntax-highlighter/dist/esm/styles/prism";
import { solarizedlight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { gruvboxDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { gruvboxLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { getTheme } from "./themes.js";

type SyntaxStyle = { [key: string]: CSSProperties };

const syntaxStyles: Record<string, SyntaxStyle> = {
  oneDark: oneDark as SyntaxStyle,
  oneLight: oneLight as SyntaxStyle,
  dracula: dracula as SyntaxStyle,
  nord: nord as SyntaxStyle,
  ghcolors: ghcolors as SyntaxStyle,
  nightOwl: nightOwl as SyntaxStyle,
  solarizedDarkAtom: solarizedDarkAtom as SyntaxStyle,
  solarizedlight: solarizedlight as SyntaxStyle,
  gruvboxDark: gruvboxDark as SyntaxStyle,
  gruvboxLight: gruvboxLight as SyntaxStyle,
};

/**
 * Returns a clone of a prism style with `background` / `backgroundColor`
 * removed from every selector whose key contains `.token`. Wrapper selectors
 * (`pre[class*="language-"]`, `code[class*="language-"]`) are left intact so
 * the panel background remains overridable to `var(--bg-code)`.
 *
 * See change: strip-token-backgrounds-in-code-blocks.
 */
export function stripTokenBackgrounds(style: SyntaxStyle): SyntaxStyle {
  const out: SyntaxStyle = {};
  for (const [selector, props] of Object.entries(style)) {
    if (selector.includes(".token")) {
      const cloned = { ...(props as Record<string, unknown>) };
      delete cloned.background;
      delete cloned.backgroundColor;
      out[selector] = cloned as CSSProperties;
    } else {
      out[selector] = props;
    }
  }
  return out;
}

export function getSyntaxTheme(resolved: "light" | "dark", themeName: string = "base"): SyntaxStyle {
  const theme = getTheme(themeName);
  if (theme) {
    const styleName = resolved === "light" ? theme.syntaxLight : theme.syntaxDark;
    const style = syntaxStyles[styleName];
    if (style) return stripTokenBackgrounds(style);
  }
  // Fallback
  return stripTokenBackgrounds(resolved === "light" ? (oneLight as SyntaxStyle) : (oneDark as SyntaxStyle));
}
