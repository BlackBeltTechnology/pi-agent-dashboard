# Generalized Extension UI System

The **Generalized Extension UI System** (also known as the **Hybrid Schema**) allows any `pi` extension to define and render interactive management menus directly in the Web Dashboard without requiring project-specific patches or new React components in the dashboard codebase.

## Architecture

The system follows a metadata-driven, event-based flow:

1.  **Discovery**: When a session starts, the Dashboard Bridge queries all active extensions for their UI module definitions using the `ui:list-modules` event.
2.  **Schema Registration**: Extensions respond by providing a JSON schema (`ExtensionUiModule`) describing their views (tables, forms), fields, and actions.
3.  **Caching**: The Dashboard Server caches these schemas in the session object, ensuring they are available to any browser that connects or refreshes.
4.  **Interception**: When a user types a command in the dashboard (e.g., `/schedule`), the frontend checks if that command matches a registered UI module.
5.  **Rendering**: If matched, the dashboard opens a `GenericExtensionDialog` which dynamically renders the UI based on the schema.
6.  **Data Flow**: Data for tables is fetched via a unified `ui:get-data` protocol, and actions (like "Add" or "Delete") are forwarded back to the extension via `pi.events`.

---

## Extension Implementation Guide

To add a dashboard UI to your extension, follow these steps:

### 1. Register the UI Module
Listen for the `ui:list-modules` event and push your schema to the `data.modules` array.

```typescript
pi.events.on("ui:list-modules", (data: any) => {
  data.modules.push({
    id: "my-extension",
    title: "My Extension Manager",
    icon: "cogOutline", // MDI icon name (camelCase, e.g. mdiCogOutline -> cogOutline)
    command: "/my-command", // The slash command that triggers this modal
    initialViewId: "list",
    views: [
      {
        id: "list",
        type: "table",
        title: "Items",
        dataEvent: "my-ext:list-items", // Key used for fetching data
        updateEvent: "my-ext:change",   // Key that triggers auto-refresh
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "active", label: "Active", type: "boolean" }
        ],
        itemActions: [
          { label: "Delete", icon: "trashCan", emit: "my-ext:delete-request", primaryParam: "id", variant: "danger", confirm: "Delete?" }
        ],
        actions: [
          { label: "New Item", icon: "plus", emit: "ui:navigate", params: { viewId: "add" }, variant: "primary" }
        ]
      },
      {
        id: "add",
        type: "form",
        title: "Add Item",
        fields: [
          { key: "name", label: "Item Name", type: "text", required: true }
        ],
        actions: [
          { label: "Cancel", emit: "ui:navigate", params: { viewId: "list" } },
          { label: "Save", emit: "my-ext:add-request", variant: "primary" }
        ]
      }
    ]
  });
});
```

### 2. Implement Data Fetching
Listen for the `ui:get-data` event. This event is emitted by the dashboard whenever a view is opened or refreshed.

```typescript
pi.events.on("ui:get-data", (data: any) => {
  if (data.event === "my-ext:list-items") {
    data.items = myStorage.getAll(); // Return an array of objects
  }
});
```

### 3. Handle Actions & Notifications
Implement your logic for add/delete/toggle events. Use `flow:notify` to send feedback back to the dashboard.

```typescript
pi.events.on("my-ext:add-request", (params: any) => {
  try {
    myStorage.add(params); // params contains all form fields
    pi.events.emit("my-ext:change", {}); // Trigger refresh
    pi.events.emit("flow:notify", { message: "Saved!", level: "success" });
  } catch (e) {
    pi.events.emit("flow:notify", { message: e.message, level: "error" });
  }
});
```

---

## UI Schema Reference

### `ExtensionUiModule`
| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier for the module. |
| `title` | `string` | Display name in the modal header. |
| `icon` | `string` | MDI icon name (e.g., `clockOutline`). |
| `command` | `string` | Slash command (including `/`) that triggers the UI. |
| `views` | `UiView[]` | Array of view definitions. |
| `initialViewId` | `string` | The ID of the view to show first. |

### `UiView`
| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier for the view. |
| `type` | `"table" \| "form"` | Layout type. |
| `dataEvent` | `string` | (Table only) The event key used in `ui:get-data`. |
| `updateEvent` | `string` | (Table only) Event name that triggers an automatic data refresh. |
| `fields` | `UiField[]` | Columns for tables or inputs for forms. |
| `actions` | `UiAction[]` | Buttons at the top (tables) or bottom (forms). |
| `itemActions` | `UiAction[]` | (Table only) Action buttons for every row. |

### `UiAction`
| Property | Type | Description |
| :--- | :--- | :--- |
| `label` | `string` | Button text or tooltip. |
| `emit` | `string` | Event name to emit on click. Use `ui:navigate` for internal navigation. |
| `params` | `object` | Static parameters to send with the event. |
| `primaryParam` | `string` | (Table rows only) Key from the row object to include in the payload. |
| `variant` | `string` | `primary`, `secondary`, `danger`, `warning`, `success`. |
| `confirm` | `string` | If set, shows a browser confirmation dialog before emitting. |

### `UiField`
| Property | Type | Description |
| :--- | :--- | :--- |
| `key` | `string` | Property name in the data object. |
| `label` | `string` | Display label. |
| `type` | `string` | `text`, `number`, `boolean`, `select`, `code`, `textarea`. |
| `options` | `object[]` | (Select only) Array of `{ label, value }`. |

---

## Protocol Details (WebSocket)

- **`ui_management`**: Sent by Browser -> Server -> Extension. Used to trigger actions or request data.
- **`ui_data_list`**: Sent by Extension -> Server -> Browser. Contains the items array for a table.
- **`ui_modules_list`**: Sent by Extension -> Server -> Browser. Contains the UI module schemas.
- **`flow:notify`**: Forwarded Event. Triggers a Toast notification in the browser.
