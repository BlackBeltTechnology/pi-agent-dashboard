/**
 * Per-slot React stubs. The renderer concatenates the entries the user picked
 * into client.tsx.tmpl's `{{ slotSections }}` placeholder.
 *
 * Each stub is annotated with the prop contract from
 * @blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.
 */

interface SlotSectionContext {
  /** kebab-case plugin id (for log lines, data-testid prefixes). */
  id: string;
  /** PascalCase config type name (e.g. "AcmeConfig"). */
  configTypeName: string;
}

type SectionRenderer = (ctx: SlotSectionContext) => string;

/**
 * Map of slot id → component-name + section template.
 *
 * The component name is what the manifest's claim points at via `component`.
 * Multiple stubs may share a component name when a single React component
 * naturally serves multiple claims (we keep them distinct for clarity).
 */
export const SLOT_SECTIONS: Record<string, { componentName: string; render: SectionRenderer }> = {
  "sidebar-folder-section": {
    componentName: "FolderSection",
    render: () => `
/**
 * sidebar-folder-section: a collapsible block above the session list per
 * workspace folder. Rendered once per folder.
 */
export function FolderSection(props: SlotProps<"sidebar-folder-section">) {
  // props.folderPath: string
  // props.pluginContext: PluginContext
  return (
    <div data-testid="folder-section">
      {/* TODO: replace with your folder-scoped UI */}
      <div style={{ fontSize: "11px", color: "#999", padding: "4px 8px" }}>
        FolderSection — {props.folderPath}
      </div>
    </div>
  );
}
`,
  },
  "session-card-badge": {
    componentName: "SessionBadge",
    render: () => `
/**
 * session-card-badge: a compact info chip in the session card header.
 * Rendered once per session that matches the predicate (or always, if no predicate).
 */
export function SessionBadge(props: SlotProps<"session-card-badge">) {
  // props.session: DashboardSession
  // props.pluginContext: PluginContext
  return (
    <span data-testid="session-badge" style={{ fontSize: "10px", padding: "2px 6px", background: "#333", borderRadius: "10px" }}>
      {/* TODO: render your at-a-glance status */}
      badge
    </span>
  );
}
`,
  },
  "session-card-action-bar": {
    componentName: "SessionActionBar",
    render: () => `
/**
 * session-card-action-bar: action buttons in the session card footer.
 * Rendered once per session.
 */
export function SessionActionBar(props: SlotProps<"session-card-action-bar">) {
  // props.session: DashboardSession
  // props.pluginContext: PluginContext
  return (
    <button data-testid="session-action-button" style={{ fontSize: "11px", padding: "2px 8px" }}>
      {/* TODO: per-session action */}
      Action
    </button>
  );
}
`,
  },
  "content-view": {
    componentName: "ContentView",
    render: () => `
/**
 * content-view: full-screen content area replacing the chat view.
 * Pair with a "command-route" claim to navigate via slash command.
 * Mutually-exclusive: only one content-view is active per session.
 */
export function ContentView(props: SlotProps<"content-view">) {
  // props.session: DashboardSession
  // props.routeParams: Record<string, string>
  // props.pluginContext: PluginContext
  return (
    <div data-testid="content-view" style={{ padding: "16px" }}>
      {/* TODO: render your full-screen content */}
      <h2>ContentView</h2>
      <pre>{JSON.stringify(props.routeParams ?? {}, null, 2)}</pre>
    </div>
  );
}
`,
  },
  "content-header-sticky": {
    componentName: "ContentHeader",
    render: () => `
/**
 * content-header-sticky: sticky element above the content view.
 * Renders for every session that has the matching content-view active.
 */
export function ContentHeader(props: SlotProps<"content-header-sticky">) {
  // props.session: DashboardSession
  // props.pluginContext: PluginContext
  return (
    <div data-testid="content-header" style={{ padding: "8px", borderBottom: "1px solid #333" }}>
      {/* TODO: breadcrumb / header */}
      Header
    </div>
  );
}
`,
  },
  "content-inline-footer": {
    componentName: "ContentInlineFooter",
    render: () => `
/**
 * content-inline-footer: inline element below the content view, above the chat input.
 * Renders for every session.
 */
export function ContentInlineFooter(props: SlotProps<"content-inline-footer">) {
  // props.session: DashboardSession
  // props.pluginContext: PluginContext
  return (
    <div data-testid="content-inline-footer" style={{ padding: "4px 8px", fontSize: "11px", color: "#999" }}>
      {/* TODO: status summary */}
      Footer
    </div>
  );
}
`,
  },
  "anchored-popover": {
    componentName: "AnchoredPopover",
    render: () => `
/**
 * anchored-popover: popover anchored to a triggering UI element.
 * One-shot: opens on trigger, dismisses on close. Manifest claim names the trigger id.
 */
export function AnchoredPopover(props: SlotProps<"anchored-popover">) {
  // props.session: DashboardSession
  // props.anchor: { x: number; y: number; width: number; height: number }
  // props.onClose: () => void
  // props.pluginContext: PluginContext
  return (
    <div data-testid="anchored-popover" style={{ padding: "8px", background: "#222", border: "1px solid #444" }}>
      {/* TODO: popover content */}
      <button onClick={props.onClose} style={{ float: "right" }}>×</button>
      Popover
    </div>
  );
}
`,
  },
  "command-route": {
    // command-route reuses the content-view component name; see manifest claim.
    componentName: "ContentView",
    render: () => `
/**
 * command-route: this claim itself is just a route pin pointing at the
 * ContentView component above. No additional component is exported.
 *
 * In package.json#pi-dashboard-plugin.claims, the matching entry looks like:
 *   { "slot": "command-route", "command": "/your-command", "component": "ContentView" }
 */
`,
  },
  "settings-section": {
    componentName: "Settings",
    render: (ctx) => `
/**
 * settings-section: a section in the dashboard's Settings page.
 * Use usePluginConfig<T>() to read; usePluginSend() with type "plugin_config_write" to write.
 */
export function Settings(_props: SlotProps<"settings-section">) {
  const config = usePluginConfig<${ctx.configTypeName}>();
  const send = usePluginSend();
  // TODO: render your settings form
  void useSessionState; void useAllSessions; // available if you need them
  return (
    <div data-testid="${ctx.id}-settings" style={{ padding: "8px" }}>
      <pre style={{ fontSize: "11px" }}>{JSON.stringify(config, null, 2)}</pre>
      <button
        onClick={() =>
          send({ type: "plugin_config_write" as never, id: "${ctx.id}", config: { /* partial */ } })
        }
      >
        Save
      </button>
    </div>
  );
}
`,
  },
  "tool-renderer": {
    componentName: "ToolRenderer",
    render: () => `
/**
 * tool-renderer: a custom React component rendering tool_call events with a
 * specific toolName. Manifest claim names the toolName.
 */
export function ToolRenderer(props: SlotProps<"tool-renderer">) {
  // props.toolName: string
  // props.toolInput: Record<string, unknown>
  // props.sessionId: string
  // props.pluginContext: PluginContext
  return (
    <div data-testid="tool-renderer" style={{ padding: "8px", border: "1px solid #4a9", borderRadius: "4px" }}>
      <span style={{ color: "#4a9" }}>✓ {props.toolName}</span>
      {Object.keys(props.toolInput).length > 0 && (
        <pre style={{ margin: "4px 0 0 0", color: "#aaa", fontSize: "11px" }}>
          {JSON.stringify(props.toolInput, null, 2)}
        </pre>
      )}
    </div>
  );
}
`,
  },
};

/** Stable order in which sections appear in the rendered client.tsx. */
export const SLOT_RENDER_ORDER: ReadonlyArray<string> = [
  "sidebar-folder-section",
  "session-card-badge",
  "session-card-action-bar",
  "content-view",
  "content-header-sticky",
  "content-inline-footer",
  "anchored-popover",
  "command-route",
  "settings-section",
  "tool-renderer",
];
