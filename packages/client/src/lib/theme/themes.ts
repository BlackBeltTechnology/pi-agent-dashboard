/**
 * Named color themes, each with dark and light CSS variable maps.
 */

import { t } from "../i18n/i18n.js";

export interface ThemeDefinition {
  id: string;
  name: string;
  dark: Record<string, string>;
  light: Record<string, string>;
  syntaxDark: string;
  syntaxLight: string;
}

/** All CSS custom property keys the themes must define. */
export const CSS_VAR_KEYS = [
  "--bg-primary",
  "--bg-secondary",
  "--bg-tertiary",
  "--bg-surface",
  "--bg-hover",
  "--bg-selected",
  "--bg-code",
  "--bg-overlay",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
  "--text-muted",
  "--text-faint",
  "--border-primary",
  "--border-secondary",
  "--border-subtle",
  "--accent-blue",
  "--accent-green",
  "--accent-yellow",
  "--accent-red",
  "--accent-purple",
  "--accent-orange",
  "--accent-purple-text",
  "--accent-blue-text",
  "--accent-green-text",
  "--accent-orange-text",
  "--accent-red-text",
  "--accent-yellow-text",
  "--link",
  "--link-hover",
  "--shadow-card",
  "--status-needs-you",
  "--status-working",
  "--status-idle",
  "--status-error",
  "--status-notice",
  "--table-stripe",
] as const;

/**
 * Semantic session-status tokens. Identical for every theme: each derives from
 * that theme's own accent tokens so status color stays consistent cross-theme
 * and inherits each theme's contrast tuning. Applied as inline `var(...)`
 * indirections by `applyThemeVars`; resolves against the theme's accent vars.
 */
const statusVars: Record<string, string> = {
  "--status-needs-you": "var(--accent-purple)",
  "--status-working": "var(--accent-yellow)",
  "--status-idle": "var(--accent-green)",
  "--status-error": "var(--accent-red)",
  // Non-error info: model returned only reasoning, no answer.
  // See change: fix-gemini-subagent-silent-tool-schema-failure.
  "--status-notice": "var(--accent-blue)",
};

// ── Body-text contrast floor ──
//
// `--text-secondary` and `--text-tertiary` carry 10–11 px body text, so both
// must reach WCAG AA 4.5:1 against BOTH `--bg-tertiary` (cards, inputs) and
// `--bg-surface` (badges, buttons). 16 of 18 palettes failed on tertiary
// (worst 2.48:1 on card, 1.67:1 on surface); the published upstream values were
// remediated by adjusting lightness only, preserving hue and saturation, so each
// theme keeps its identity. In catppuccinLight, rosePineLight, solarizedDark and
// solarizedLight `--text-secondary` was itself sub-AA, so it was lifted in the
// same pass — raising tertiary alone would have made the token meant to recede
// the most legible text on the card. Pinned by
// `src/lib/__tests__/theme-body-text-contrast.test.ts`.
// See change: stop-discarding-known-session-state.

// ── Accent role split: fill vs text ──
//
// `--accent-<hue>` is the FILL role (dots, borders, icon glyphs, tinted
// backgrounds). It carries NO contrast guarantee: check each non-text use
// against its own backdrop (Base light green is 1.73:1 on `--bg-surface`).
// `--accent-<hue>-text` is the TEXT role: the same
// hue and saturation, lightness-shifted until it reaches WCAG AA 4.5:1 on
// `--bg-surface`, `--bg-tertiary`, `--bg-primary` and the card fill. A source
// accent that already passes all four is copied unchanged. Values are pasted
// from the committed derivation script (design D1), never hand-tuned, and are
// re-measured by `src/lib/__tests__/theme-body-text-contrast.test.ts`. New
// coloured text MUST use `-text`; `scripts/theme-token-guard.mjs` (arm
// `accentText`) ratchets fill-accent text paints.
// See change: remediate-accent-text-contrast.

// ── Base (matches current CSS :root / [data-theme="light"]) ──

const baseDark: Record<string, string> = {
  "--bg-primary": "#0a0a0a",
  "--bg-secondary": "#141414",
  "--bg-tertiary": "#1e1e1e",
  "--bg-surface": "#2a2a2a",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#1e1e1e",
  "--bg-code": "#1a1a1a",
  "--bg-overlay": "rgba(0, 0, 0, 0.6)",
  "--text-primary": "#e5e5e5",
  "--text-secondary": "#b0b0b0",
  "--text-tertiary": "#919191",
  "--text-muted": "#585858",
  "--text-faint": "#3a3a3a",
  "--border-primary": "#252525",
  "--border-secondary": "#333333",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#3b82f6",
  "--accent-green": "#22c55e",
  "--accent-yellow": "#eab308",
  "--accent-red": "#ef4444",
  "--accent-purple": "#a855f7",
  "--accent-orange": "#f97316",
  "--accent-purple-text": "#b56ff8",
  "--accent-blue-text": "#508ff7",
  "--accent-green-text": "#22c55e",
  "--accent-orange-text": "#f97316",
  "--accent-red-text": "#f26262",
  "--accent-yellow-text": "#eab308",
  "--link": "#60a5fa",
  "--link-hover": "#93bbfd",
  "--shadow-card": "rgba(0, 0, 0, 0.4)",
};

const baseLight: Record<string, string> = {
  "--bg-primary": "#ffffff",
  "--bg-secondary": "#fafafa",
  "--bg-tertiary": "#f0f0f0",
  "--bg-surface": "#e0e0e0",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#e8e8e8",
  "--bg-code": "#f5f5f5",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#1a1a1a",
  "--text-secondary": "#444444",
  "--text-tertiary": "#636363",
  "--text-muted": "#aaaaaa",
  "--text-faint": "#d0d0d0",
  "--border-primary": "#e0e0e0",
  "--border-secondary": "#cccccc",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#3b82f6",
  "--accent-green": "#22c55e",
  "--accent-yellow": "#eab308",
  "--accent-red": "#ef4444",
  "--accent-purple": "#a855f7",
  "--accent-orange": "#f97316",
  "--accent-purple-text": "#8919f4",
  "--accent-blue-text": "#0a5ade",
  "--accent-green-text": "#147237",
  "--accent-orange-text": "#a64704",
  "--accent-red-text": "#c61111",
  "--accent-yellow-text": "#7c5f04",
  "--link": "#2563eb",
  "--link-hover": "#1d4ed8",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Dracula ──

const draculaDark: Record<string, string> = {
  "--bg-primary": "#282a36",
  "--bg-secondary": "#21222c",
  "--bg-tertiary": "#343746",
  "--bg-surface": "#44475a",
  "--bg-hover": "rgba(255, 255, 255, 0.08)",
  "--bg-selected": "#44475a",
  "--bg-code": "#1e1f29",
  "--bg-overlay": "rgba(0, 0, 0, 0.6)",
  "--text-primary": "#f8f8f2",
  "--text-secondary": "#ccc9e7",
  "--text-tertiary": "#aeb6d0",
  "--text-muted": "#4d5681",
  "--text-faint": "#383a4e",
  "--border-primary": "#343746",
  "--border-secondary": "#44475a",
  "--border-subtle": "rgba(255, 255, 255, 0.08)",
  "--accent-blue": "#8be9fd",
  "--accent-green": "#50fa7b",
  "--accent-yellow": "#f1fa8c",
  "--accent-red": "#ff5555",
  "--accent-purple": "#bd93f9",
  "--accent-orange": "#ffb86c",
  "--accent-purple-text": "#caa8fa",
  "--accent-blue-text": "#8be9fd",
  "--accent-green-text": "#50fa7b",
  "--accent-orange-text": "#ffb86c",
  "--accent-red-text": "#ff9b9b",
  "--accent-yellow-text": "#f1fa8c",
  "--link": "#8be9fd",
  "--link-hover": "#b4f0fd",
  "--shadow-card": "rgba(0, 0, 0, 0.5)",
};

const draculaLight: Record<string, string> = {
  "--bg-primary": "#f8f8f2",
  "--bg-secondary": "#f0f0e8",
  "--bg-tertiary": "#e8e8e0",
  "--bg-surface": "#d8d8d0",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#e0e0d8",
  "--bg-code": "#ededea",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#282a36",
  "--text-secondary": "#44475a",
  "--text-tertiary": "#4e5c87",
  "--text-muted": "#9ea4c0",
  "--text-faint": "#d0d0d0",
  "--border-primary": "#d8d8d0",
  "--border-secondary": "#c8c8c0",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#0d7fa5",
  "--accent-green": "#1b9e3e",
  "--accent-yellow": "#b8960a",
  "--accent-red": "#d63333",
  "--accent-purple": "#7c5cbf",
  "--accent-orange": "#d68e2e",
  "--accent-purple-text": "#6c48b7",
  "--accent-blue-text": "#0a6684",
  "--accent-green-text": "#136d2b",
  "--accent-orange-text": "#815519",
  "--accent-red-text": "#b52424",
  "--accent-yellow-text": "#715c06",
  "--link": "#0d7fa5",
  "--link-hover": "#095c78",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Nord ──

const nordDark: Record<string, string> = {
  "--bg-primary": "#2e3440",
  "--bg-secondary": "#292e39",
  "--bg-tertiary": "#3b4252",
  "--bg-surface": "#434c5e",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#3b4252",
  "--bg-code": "#272c36",
  "--bg-overlay": "rgba(0, 0, 0, 0.5)",
  "--text-primary": "#eceff4",
  "--text-secondary": "#d8dee9",
  "--text-tertiary": "#b7bcc6",
  "--text-muted": "#5b6375",
  "--text-faint": "#434c5e",
  "--border-primary": "#3b4252",
  "--border-secondary": "#434c5e",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#88c0d0",
  "--accent-green": "#a3be8c",
  "--accent-yellow": "#ebcb8b",
  "--accent-red": "#bf616a",
  "--accent-purple": "#b48ead",
  "--accent-orange": "#d08770",
  "--accent-purple-text": "#cdb4c8",
  "--accent-blue-text": "#8fc4d3",
  "--accent-green-text": "#abc496",
  "--accent-orange-text": "#e0b1a2",
  "--accent-red-text": "#dfb0b4",
  "--accent-yellow-text": "#ebcb8b",
  "--link": "#88c0d0",
  "--link-hover": "#a3d5e0",
  "--shadow-card": "rgba(0, 0, 0, 0.4)",
};

const nordLight: Record<string, string> = {
  "--bg-primary": "#eceff4",
  "--bg-secondary": "#e5e9f0",
  "--bg-tertiary": "#d8dee9",
  "--bg-surface": "#c8ced9",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#d8dee9",
  "--bg-code": "#e8ecf2",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#2e3440",
  "--text-secondary": "#3b4252",
  "--text-tertiary": "#4f5869",
  "--text-muted": "#9da5b4",
  "--text-faint": "#c8ced9",
  "--border-primary": "#d8dee9",
  "--border-secondary": "#c8ced9",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#5e81ac",
  "--accent-green": "#689d6a",
  "--accent-yellow": "#c08b30",
  "--accent-red": "#bf616a",
  "--accent-purple": "#8c6daa",
  "--accent-orange": "#c0704a",
  "--accent-purple-text": "#684c83",
  "--accent-blue-text": "#3f597a",
  "--accent-green-text": "#3e5f3f",
  "--accent-orange-text": "#82492d",
  "--accent-red-text": "#923b43",
  "--accent-yellow-text": "#71521c",
  "--link": "#5e81ac",
  "--link-hover": "#4a6a91",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── GitHub ──

const githubDark: Record<string, string> = {
  "--bg-primary": "#0d1117",
  "--bg-secondary": "#161b22",
  "--bg-tertiary": "#21262d",
  "--bg-surface": "#30363d",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#21262d",
  "--bg-code": "#161b22",
  "--bg-overlay": "rgba(0, 0, 0, 0.5)",
  "--text-primary": "#e6edf3",
  "--text-secondary": "#c9d1d9",
  "--text-tertiary": "#969ea7",
  "--text-muted": "#6e7681",
  "--text-faint": "#3d444d",
  "--border-primary": "#21262d",
  "--border-secondary": "#30363d",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#58a6ff",
  "--accent-green": "#3fb950",
  "--accent-yellow": "#d29922",
  "--accent-red": "#f85149",
  "--accent-purple": "#bc8cff",
  "--accent-orange": "#db6d28",
  "--accent-purple-text": "#bc8cff",
  "--accent-blue-text": "#58a6ff",
  "--accent-green-text": "#3fb950",
  "--accent-orange-text": "#e1874e",
  "--accent-red-text": "#f9756f",
  "--accent-yellow-text": "#d29922",
  "--link": "#58a6ff",
  "--link-hover": "#79bbff",
  "--shadow-card": "rgba(0, 0, 0, 0.4)",
};

const githubLight: Record<string, string> = {
  "--bg-primary": "#ffffff",
  "--bg-secondary": "#f6f8fa",
  "--bg-tertiary": "#ebedf0",
  "--bg-surface": "#d0d7de",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#e8ebee",
  "--bg-code": "#f6f8fa",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#1f2328",
  "--text-secondary": "#424a53",
  "--text-tertiary": "#575e66",
  "--text-muted": "#a1a9b1",
  "--text-faint": "#d0d7de",
  "--border-primary": "#d0d7de",
  "--border-secondary": "#c4c9cf",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#0969da",
  "--accent-green": "#1a7f37",
  "--accent-yellow": "#9a6700",
  "--accent-red": "#cf222e",
  "--accent-purple": "#8250df",
  "--accent-orange": "#bc4c00",
  "--accent-purple-text": "#6e35da",
  "--accent-blue-text": "#085abb",
  "--accent-green-text": "#166b2e",
  "--accent-orange-text": "#9f4000",
  "--accent-red-text": "#b61e28",
  "--accent-yellow-text": "#7f5500",
  "--link": "#0969da",
  "--link-hover": "#0550ae",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Catppuccin (Mocha dark / Latte light) ──

const catppuccinDark: Record<string, string> = {
  "--bg-primary": "#1e1e2e",
  "--bg-secondary": "#181825",
  "--bg-tertiary": "#313244",
  "--bg-surface": "#45475a",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#313244",
  "--bg-code": "#1a1a2a",
  "--bg-overlay": "rgba(0, 0, 0, 0.5)",
  "--text-primary": "#cdd6f4",
  "--text-secondary": "#bac2de",
  "--text-tertiary": "#b3b6c4",
  "--text-muted": "#585b70",
  "--text-faint": "#45475a",
  "--border-primary": "#313244",
  "--border-secondary": "#45475a",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#89b4fa",
  "--accent-green": "#a6e3a1",
  "--accent-yellow": "#f9e2af",
  "--accent-red": "#f38ba8",
  "--accent-purple": "#cba6f7",
  "--accent-orange": "#fab387",
  "--accent-purple-text": "#cca8f7",
  "--accent-blue-text": "#90b8fa",
  "--accent-green-text": "#a6e3a1",
  "--accent-orange-text": "#fab387",
  "--accent-red-text": "#f59db6",
  "--accent-yellow-text": "#f9e2af",
  "--link": "#89b4fa",
  "--link-hover": "#a8c8fc",
  "--shadow-card": "rgba(0, 0, 0, 0.4)",
};

const catppuccinLight: Record<string, string> = {
  "--bg-primary": "#eff1f5",
  "--bg-secondary": "#e6e9ef",
  "--bg-tertiary": "#ccd0da",
  "--bg-surface": "#bcc0cc",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#ccd0da",
  "--bg-code": "#e8eaf0",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#4c4f69",
  "--text-secondary": "#414354",
  "--text-tertiary": "#4b4d5b",
  "--text-muted": "#acb0be",
  "--text-faint": "#ccd0da",
  "--border-primary": "#ccd0da",
  "--border-secondary": "#bcc0cc",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#1e66f5",
  "--accent-green": "#40a02b",
  "--accent-yellow": "#df8e1d",
  "--accent-red": "#d20f39",
  "--accent-purple": "#8839ef",
  "--accent-orange": "#fe640b",
  "--accent-purple-text": "#6411d1",
  "--accent-blue-text": "#0844bb",
  "--accent-green-text": "#245a18",
  "--accent-orange-text": "#893301",
  "--accent-red-text": "#9f0b2b",
  "--accent-yellow-text": "#6e460e",
  "--link": "#1e66f5",
  "--link-hover": "#1550c0",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Tokyo Night (Night dark / Day light) ──

const tokyoNightDark: Record<string, string> = {
  "--bg-primary": "#1a1b26",
  "--bg-secondary": "#16161e",
  "--bg-tertiary": "#24283b",
  "--bg-surface": "#2f344a",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#24283b",
  "--bg-code": "#16161e",
  "--bg-overlay": "rgba(0, 0, 0, 0.6)",
  "--text-primary": "#c0caf5",
  "--text-secondary": "#a9b1d6",
  "--text-tertiary": "#999cb2",
  "--text-muted": "#565a73",
  "--text-faint": "#3b3f54",
  "--border-primary": "#24283b",
  "--border-secondary": "#2f344a",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#7aa2f7",
  "--accent-green": "#9ece6a",
  "--accent-yellow": "#e0af68",
  "--accent-red": "#f7768e",
  "--accent-purple": "#bb9af7",
  "--accent-orange": "#ff9e64",
  "--accent-purple-text": "#bb9af7",
  "--accent-blue-text": "#7aa2f7",
  "--accent-green-text": "#9ece6a",
  "--accent-orange-text": "#ff9e64",
  "--accent-red-text": "#f7768e",
  "--accent-yellow-text": "#e0af68",
  "--link": "#7aa2f7",
  "--link-hover": "#a4bfff",
  "--shadow-card": "rgba(0, 0, 0, 0.5)",
};

const tokyoNightLight: Record<string, string> = {
  "--bg-primary": "#e1e2e7",
  "--bg-secondary": "#d5d6db",
  "--bg-tertiary": "#c4c8da",
  "--bg-surface": "#b6bac4",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#c4c8da",
  "--bg-code": "#d5d6db",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#3760bf",
  "--text-secondary": "#343b59",
  "--text-tertiary": "#3c4877",
  "--text-muted": "#8990b3",
  "--text-faint": "#b6bac4",
  "--border-primary": "#c4c8da",
  "--border-secondary": "#b6bac4",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#2e7de9",
  "--accent-green": "#587539",
  "--accent-yellow": "#8c6c3e",
  "--accent-red": "#f52a65",
  "--accent-purple": "#9854f1",
  "--accent-orange": "#b15c00",
  "--accent-purple-text": "#5f10c6",
  "--accent-blue-text": "#104895",
  "--accent-green-text": "#3c5027",
  "--accent-orange-text": "#743c00",
  "--accent-red-text": "#970731",
  "--accent-yellow-text": "#5c4729",
  "--link": "#2e7de9",
  "--link-hover": "#1d5dc7",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Rose Pine (Main dark / Dawn light) ──

const rosePineDark: Record<string, string> = {
  "--bg-primary": "#191724",
  "--bg-secondary": "#1f1d2e",
  "--bg-tertiary": "#26233a",
  "--bg-surface": "#393552",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#26233a",
  "--bg-code": "#1f1d2e",
  "--bg-overlay": "rgba(0, 0, 0, 0.6)",
  "--text-primary": "#e0def4",
  "--text-secondary": "#cdcbe0",
  "--text-tertiary": "#a29fb8",
  "--text-muted": "#6e6a86",
  "--text-faint": "#403d52",
  "--border-primary": "#26233a",
  "--border-secondary": "#393552",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#9ccfd8",
  "--accent-green": "#5dc2a3",
  "--accent-yellow": "#f6c177",
  "--accent-red": "#eb6f92",
  "--accent-purple": "#c4a7e7",
  "--accent-orange": "#ebbcba",
  "--accent-purple-text": "#c4a7e7",
  "--accent-blue-text": "#9ccfd8",
  "--accent-green-text": "#5dc2a3",
  "--accent-orange-text": "#ebbcba",
  "--accent-red-text": "#ed7f9e",
  "--accent-yellow-text": "#f6c177",
  "--link": "#9ccfd8",
  "--link-hover": "#bce0e6",
  "--shadow-card": "rgba(0, 0, 0, 0.5)",
};

const rosePineLight: Record<string, string> = {
  "--bg-primary": "#faf4ed",
  "--bg-secondary": "#fffaf3",
  "--bg-tertiary": "#f2e9e1",
  "--bg-surface": "#dfdad9",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#f2e9e1",
  "--bg-code": "#fffaf3",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#575279",
  "--text-secondary": "#57546b",
  "--text-tertiary": "#625d70",
  "--text-muted": "#b5afba",
  "--text-faint": "#dfdad9",
  "--border-primary": "#f2e9e1",
  "--border-secondary": "#dfdad9",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#286983",
  "--accent-green": "#3a7a68",
  "--accent-yellow": "#ea9d34",
  "--accent-red": "#b4637a",
  "--accent-purple": "#907aa9",
  "--accent-orange": "#d7827e",
  "--accent-purple-text": "#6d5786",
  "--accent-blue-text": "#276780",
  "--accent-green-text": "#326a5a",
  "--accent-orange-text": "#a93a35",
  "--accent-red-text": "#95485e",
  "--accent-yellow-text": "#89550e",
  "--link": "#286983",
  "--link-hover": "#1d4f64",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Solarized (Dark / Light, Ethan Schoonover) ──
//
// ACCEPTED IDENTITY LOSS (user decision 2026-09-14/15). Solarized's `--bg-surface`
// (#586e75 / #93a1a1) sits inside its own text ramp, so the 4.5:1 floor on that
// surface drives `--text-tertiary` to near-white (#e9eced dark, 9.15:1 on card)
// and `--text-secondary` with it. The alternative — moving `--bg-surface` — was
// rejected; the remaining Solarized tokens are unchanged.

const solarizedDark: Record<string, string> = {
  "--bg-primary": "#002b36",
  "--bg-secondary": "#073642",
  "--bg-tertiary": "#0a4351",
  "--bg-surface": "#586e75",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#073642",
  "--bg-code": "#073642",
  "--bg-overlay": "rgba(0, 0, 0, 0.5)",
  "--text-primary": "#fdf6e3",
  "--text-secondary": "#eef1f1",
  "--text-tertiary": "#e9eced",
  "--text-muted": "#657b83",
  "--text-faint": "#586e75",
  "--border-primary": "#073642",
  "--border-secondary": "#586e75",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#268bd2",
  "--accent-green": "#859900",
  "--accent-yellow": "#b58900",
  "--accent-red": "#dc322f",
  "--accent-purple": "#6c71c4",
  "--accent-orange": "#cb4b16",
  "--accent-purple-text": "#e9eaf6",
  "--accent-blue-text": "#deeef9",
  "--accent-green-text": "#d9fa00",
  "--accent-orange-text": "#fce8df",
  "--accent-red-text": "#fbe7e6",
  "--accent-yellow-text": "#ffeaa7",
  "--link": "#268bd2",
  "--link-hover": "#52a8e0",
  "--shadow-card": "rgba(0, 0, 0, 0.4)",
};

const solarizedLight: Record<string, string> = {
  "--bg-primary": "#fdf6e3",
  "--bg-secondary": "#eee8d5",
  "--bg-tertiary": "#e4ddc3",
  "--bg-surface": "#93a1a1",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#eee8d5",
  "--bg-code": "#eee8d5",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#002b36",
  "--text-secondary": "#242d30",
  "--text-tertiary": "#2d373b",
  "--text-muted": "#839496",
  "--text-faint": "#93a1a1",
  "--border-primary": "#e4ddc3",
  "--border-secondary": "#93a1a1",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#268bd2",
  "--accent-green": "#859900",
  "--accent-yellow": "#b58900",
  "--accent-red": "#dc322f",
  "--accent-purple": "#6c71c4",
  "--accent-orange": "#cb4b16",
  "--accent-purple-text": "#2c2f6d",
  "--accent-blue-text": "#103956",
  "--accent-green-text": "#323a00",
  "--accent-orange-text": "#60230a",
  "--accent-red-text": "#6a1312",
  "--accent-yellow-text": "#453400",
  "--link": "#268bd2",
  "--link-hover": "#1e6fa8",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Gruvbox (medium dark / medium light) ──

const gruvboxDark: Record<string, string> = {
  "--bg-primary": "#282828",
  "--bg-secondary": "#1d2021",
  "--bg-tertiary": "#3c3836",
  "--bg-surface": "#504945",
  "--bg-hover": "rgba(255, 255, 255, 0.06)",
  "--bg-selected": "#3c3836",
  "--bg-code": "#1d2021",
  "--bg-overlay": "rgba(0, 0, 0, 0.5)",
  "--text-primary": "#ebdbb2",
  "--text-secondary": "#d5c4a1",
  "--text-tertiary": "#c2b8a9",
  "--text-muted": "#7c6f64",
  "--text-faint": "#504945",
  "--border-primary": "#3c3836",
  "--border-secondary": "#504945",
  "--border-subtle": "rgba(255, 255, 255, 0.06)",
  "--accent-blue": "#83a598",
  "--accent-green": "#b8bb26",
  "--accent-yellow": "#fabd2f",
  "--accent-red": "#fb4934",
  "--accent-purple": "#d3869b",
  "--accent-orange": "#fe8019",
  "--accent-purple-text": "#e1abba",
  "--accent-blue-text": "#a6bfb5",
  "--accent-green-text": "#bec127",
  "--accent-orange-text": "#fea55d",
  "--accent-red-text": "#fda196",
  "--accent-yellow-text": "#fabd2f",
  "--link": "#83a598",
  "--link-hover": "#a8c0b6",
  "--shadow-card": "rgba(0, 0, 0, 0.5)",
};

const gruvboxLight: Record<string, string> = {
  "--bg-primary": "#fbf1c7",
  "--bg-secondary": "#f2e5bc",
  "--bg-tertiary": "#ebdbb2",
  "--bg-surface": "#d5c4a1",
  "--bg-hover": "rgba(0, 0, 0, 0.04)",
  "--bg-selected": "#ebdbb2",
  "--bg-code": "#f2e5bc",
  "--bg-overlay": "rgba(0, 0, 0, 0.3)",
  "--text-primary": "#3c3836",
  "--text-secondary": "#504945",
  "--text-tertiary": "#5a5149",
  "--text-muted": "#a89984",
  "--text-faint": "#d5c4a1",
  "--border-primary": "#ebdbb2",
  "--border-secondary": "#d5c4a1",
  "--border-subtle": "rgba(0, 0, 0, 0.06)",
  "--accent-blue": "#458588",
  "--accent-green": "#79740e",
  "--accent-yellow": "#b57614",
  "--accent-red": "#9d0006",
  "--accent-purple": "#b16286",
  "--accent-orange": "#af3a03",
  "--accent-purple-text": "#7d3e5b",
  "--accent-blue-text": "#2e595b",
  "--accent-green-text": "#57540a",
  "--accent-orange-text": "#943103",
  "--accent-red-text": "#9d0006",
  "--accent-yellow-text": "#724a0d",
  "--link": "#076678",
  "--link-hover": "#054b56",
  "--shadow-card": "rgba(0, 0, 0, 0.08)",
};

// ── Registry ──

// Zebra-stripe overlay for markdown tables. Translucent (not an opaque token
// reuse) so it reads correctly regardless of the container background the table
// sits on (chat bubble, editor pane, KB). See change: markdown-table-styling.
const darkTableVars: Record<string, string> = { "--table-stripe": "rgba(255, 255, 255, 0.045)" };
const lightTableVars: Record<string, string> = { "--table-stripe": "rgba(0, 0, 0, 0.035)" };

/** Merge the shared status + table tokens into a theme's dark variable map. */
const withStatus = (vars: Record<string, string>): Record<string, string> => ({
  ...vars,
  ...statusVars,
  ...darkTableVars,
});

/** Merge the shared status + table tokens into a theme's light variable map. */
const withStatusLight = (vars: Record<string, string>): Record<string, string> => ({
  ...vars,
  ...statusVars,
  ...lightTableVars,
});

export const THEMES: ThemeDefinition[] = [
  { id: "base", name: t("themes.base", undefined, "Base"), dark: withStatus(baseDark), light: withStatusLight(baseLight), syntaxDark: "oneDark", syntaxLight: "oneLight" },
  { id: "dracula", name: t("themes.dracula", undefined, "Dracula"), dark: withStatus(draculaDark), light: withStatusLight(draculaLight), syntaxDark: "dracula", syntaxLight: "oneLight" },
  { id: "nord", name: t("themes.nord", undefined, "Nord"), dark: withStatus(nordDark), light: withStatusLight(nordLight), syntaxDark: "nord", syntaxLight: "oneLight" },
  { id: "github", name: t("themes.github", undefined, "GitHub"), dark: withStatus(githubDark), light: withStatusLight(githubLight), syntaxDark: "ghcolors", syntaxLight: "ghcolors" },
  { id: "catppuccin", name: t("themes.catppuccin", undefined, "Catppuccin"), dark: withStatus(catppuccinDark), light: withStatusLight(catppuccinLight), syntaxDark: "oneDark", syntaxLight: "oneLight" },
  { id: "tokyo-night", name: t("themes.tokyoNight", undefined, "Tokyo Night"), dark: withStatus(tokyoNightDark), light: withStatusLight(tokyoNightLight), syntaxDark: "nightOwl", syntaxLight: "oneLight" },
  { id: "rose-pine", name: t("themes.rosePine", undefined, "Rosé Pine"), dark: withStatus(rosePineDark), light: withStatusLight(rosePineLight), syntaxDark: "oneDark", syntaxLight: "oneLight" },
  { id: "solarized", name: t("themes.solarized", undefined, "Solarized"), dark: withStatus(solarizedDark), light: withStatusLight(solarizedLight), syntaxDark: "solarizedDarkAtom", syntaxLight: "solarizedlight" },
  { id: "gruvbox", name: t("themes.gruvbox", undefined, "Gruvbox"), dark: withStatus(gruvboxDark), light: withStatusLight(gruvboxLight), syntaxDark: "gruvboxDark", syntaxLight: "gruvboxLight" },
];

export function getTheme(id: string): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}
