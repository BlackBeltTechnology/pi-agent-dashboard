/**
 * Derive a Monaco editor theme from the dashboard's active named theme so the
 * read-only editor pane matches the surrounding chrome under every theme
 * (base / dracula / nord / github / catppuccin / tokyo-night / rose-pine /
 * solarized / gruvbox) and light/dark mode.
 *
 * Mirrors the existing precedent where `DiffPanel` / `RichDiff` route the
 * active theme into `@git-diff-view`, and `getSyntaxTheme` resolves a prism
 * palette per theme. Monaco renders to canvas and cannot read CSS variables,
 * so colors must be concrete — we read them from the `THEMES` registry's
 * token map (concrete hex/rgb), not computed styles.
 *
 * Only hex tokens feed Monaco's `colors` map; `rgba(...)` tokens are skipped
 * because Monaco's theme API rejects non-hex color strings.
 *
 * See change: add-internal-monaco-editor-pane (design §7).
 */
import type { editor } from "monaco-editor";
import type { ResolvedTheme } from "../hooks/useTheme.js";
import { getTheme } from "./themes.js";

export interface BuiltMonacoTheme {
  /** Stable, deterministic name for `defineTheme` / `setTheme`. */
  name: string;
  data: editor.IStandaloneThemeData;
}

/** Strip the leading `#` for Monaco token-rule foregrounds (hex sans hash). */
function bare(hex: string): string {
  return hex.startsWith("#") ? hex.slice(1) : hex;
}

/** True for `#rgb` / `#rrggbb` / `#rrggbbaa` — the forms Monaco accepts. */
function isHex(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value);
}

/**
 * Build a Monaco theme for the given dashboard theme + mode.
 *
 * @param themeName  registry id (`base`, `dracula`, …); unknown ids fall back to `base`.
 * @param resolved   `"light"` | `"dark"` — drives the `vs` / `vs-dark` base.
 */
export function buildMonacoTheme(themeName: string, resolved: ResolvedTheme): BuiltMonacoTheme {
  const theme = getTheme(themeName) ?? getTheme("base")!;
  const tokens = resolved === "light" ? theme.light : theme.dark;
  const base: editor.BuiltinTheme = resolved === "dark" ? "vs-dark" : "vs";

  // Read a token, falling back when absent or non-hex (e.g. rgba surfaces).
  const tok = (key: string, fallback: string): string => {
    const v = tokens[key];
    return isHex(v) ? v : fallback;
  };

  const bg = tok("--bg-code", resolved === "dark" ? "#1a1a1a" : "#f5f5f5");
  const fg = tok("--text-primary", resolved === "dark" ? "#e5e5e5" : "#1a1a1a");

  const colors: editor.IStandaloneThemeData["colors"] = {
    "editor.background": bg,
    "editor.foreground": fg,
    "editorLineNumber.foreground": tok("--text-muted", "#585858"),
    "editorLineNumber.activeForeground": tok("--text-secondary", "#b0b0b0"),
    "editor.selectionBackground": tok("--bg-selected", "#264f78"),
    "editor.lineHighlightBackground": tok("--bg-tertiary", bg),
    "editorCursor.foreground": fg,
    "editorIndentGuide.background": tok("--border-primary", "#252525"),
    "editorIndentGuide.activeBackground": tok("--border-secondary", "#333333"),
    "editorGutter.background": bg,
    "editorWidget.background": tok("--bg-secondary", bg),
    "editorWidget.border": tok("--border-primary", "#252525"),
    "editorWhitespace.foreground": tok("--text-faint", "#3a3a3a"),
    "scrollbarSlider.background": tok("--bg-surface", "#2a2a2a"),
  };

  const accent = (key: string, fallback: string) => bare(tok(key, fallback));

  const rules: editor.ITokenThemeRule[] = [
    { token: "comment", foreground: accent("--text-tertiary", "#808080"), fontStyle: "italic" },
    { token: "keyword", foreground: accent("--accent-purple", "#a855f7") },
    { token: "string", foreground: accent("--accent-green", "#22c55e") },
    { token: "number", foreground: accent("--accent-orange", "#f97316") },
    { token: "regexp", foreground: accent("--accent-red", "#ef4444") },
    { token: "type", foreground: accent("--accent-blue", "#3b82f6") },
    { token: "type.identifier", foreground: accent("--accent-blue", "#3b82f6") },
    { token: "function", foreground: accent("--accent-blue", "#3b82f6") },
    { token: "constant", foreground: accent("--accent-orange", "#f97316") },
    { token: "variable", foreground: bare(fg) },
    { token: "identifier", foreground: bare(fg) },
    { token: "delimiter", foreground: accent("--text-secondary", "#b0b0b0") },
    { token: "operator", foreground: accent("--text-secondary", "#b0b0b0") },
    { token: "tag", foreground: accent("--accent-red", "#ef4444") },
    { token: "attribute.name", foreground: accent("--accent-orange", "#f97316") },
    { token: "attribute.value", foreground: accent("--accent-green", "#22c55e") },
  ];

  return {
    name: `pi-monaco-${themeName}-${resolved}`,
    data: { base, inherit: true, rules, colors },
  };
}
