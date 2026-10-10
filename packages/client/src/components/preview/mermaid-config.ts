// React-free mermaid.initialize() config shared by MermaidBlock and the
// real-parse repair test. See change: add-mermaid-auto-repair (design D6).

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** mermaid.initialize() options for the resolved light/dark theme. */
export function mermaidConfig(resolved: string) {
  return {
    startOnLoad: false,
    theme: resolved === "dark" ? ("dark" as const) : ("default" as const),
    suppressErrorRendering: true,
    fontFamily: FONT_FAMILY,
    fontSize: 16,
    themeVariables: { fontFamily: FONT_FAMILY, fontSize: "16px" },
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: {
      useMaxWidth: true,
      actorFontFamily: FONT_FAMILY,
      messageFontFamily: FONT_FAMILY,
      noteFontFamily: FONT_FAMILY,
    },
    gantt: { useMaxWidth: true },
  };
}
