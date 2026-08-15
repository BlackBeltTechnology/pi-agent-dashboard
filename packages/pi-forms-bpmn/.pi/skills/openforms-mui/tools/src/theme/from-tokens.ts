/**
 * Bridge a `ui-contract.tokens.json` (DTCG design-token) file to a MUI theme.
 *
 * MUI's control plane is the theme object, not utility classes (design D9).
 * Tokens map into `createTheme()` here once; widgets then read colour, spacing
 * and typography from the theme and carry no literal values, which keeps the
 * token-lint gate (task 5.3) satisfiable and lets a form inherit any project's
 * design system unchanged.
 */
import { createTheme, type Theme, type ThemeOptions } from "@mui/material/styles";

/** A DTCG token node: `{ "$value": ... , "$type"?: ... }` or a nested group. */
export interface DtcgNode {
  $value?: unknown;
  $type?: string;
  [key: string]: unknown;
}

export interface UiContractTokens {
  [group: string]: DtcgNode | UiContractTokens | undefined;
}

function tokenValue(root: UiContractTokens | undefined, path: string[]): string | number | undefined {
  let node: unknown = root;
  for (const seg of path) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  if (node && typeof node === "object" && "$value" in (node as object)) {
    const v = (node as DtcgNode).$value;
    return typeof v === "string" || typeof v === "number" ? v : undefined;
  }
  return typeof node === "string" || typeof node === "number" ? node : undefined;
}

/** The documented default theme used when no token file is present (task 5.2). */
export function defaultTheme(): Theme {
  return createTheme({
    palette: {
      mode: "light",
      primary: { main: "#1565c0" },
      secondary: { main: "#6a1b9a" },
      error: { main: "#c62828" },
      warning: { main: "#ed6c02" },
      success: { main: "#2e7d32" },
      background: { default: "#ffffff", paper: "#ffffff" },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    spacing: 8,
  });
}

/**
 * Build a MUI theme from a DTCG token object. Missing tokens fall back to the
 * default theme's values, so a partial token file still yields a complete theme.
 */
export function themeFromTokens(tokens: UiContractTokens | null | undefined): Theme {
  if (!tokens) return defaultTheme();
  const base = defaultTheme();

  const pick = (path: string[], fallback: string | number): string | number =>
    tokenValue(tokens, path) ?? fallback;

  const options: ThemeOptions = {
    palette: {
      mode: (tokenValue(tokens, ["color", "mode"]) as "light" | "dark") ?? "light",
      primary: { main: String(pick(["color", "primary"], base.palette.primary.main)) },
      secondary: { main: String(pick(["color", "secondary"], base.palette.secondary.main)) },
      error: { main: String(pick(["color", "error"], base.palette.error.main)) },
      warning: { main: String(pick(["color", "warning"], base.palette.warning.main)) },
      success: { main: String(pick(["color", "success"], base.palette.success.main)) },
      background: {
        default: String(pick(["color", "background", "default"], base.palette.background.default)),
        paper: String(pick(["color", "background", "paper"], base.palette.background.paper)),
      },
      ...(tokenValue(tokens, ["color", "text", "primary"])
        ? { text: { primary: String(tokenValue(tokens, ["color", "text", "primary"])) } }
        : {}),
    },
    shape: {
      borderRadius: Number(pick(["radius", "base"], base.shape.borderRadius)),
    },
    typography: {
      fontFamily: String(pick(["font", "family", "base"], base.typography.fontFamily ?? "Roboto")),
    },
    spacing: Number(pick(["spacing", "unit"], 8)),
  };

  return createTheme(options);
}

/** Convenience: parse a raw JSON string token file into a theme. */
export function themeFromTokensJson(json: string): Theme {
  try {
    return themeFromTokens(JSON.parse(json) as UiContractTokens);
  } catch {
    return defaultTheme();
  }
}
