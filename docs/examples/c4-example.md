# C4 Diagram Example (Mermaid)

This file demonstrates embedding **C4 model** diagrams inside Markdown using
fenced ` ```mermaid ` blocks. It renders natively on GitHub, GitLab, VS Code
(Mermaid preview), Obsidian, and most Mermaid-aware viewers — no extra toolchain.

> Mermaid's C4 support is **experimental**: auto-layout is weak, so you sometimes
> nudge it with `UpdateLayoutConfig` / `UpdateElementStyle`.

---

## 1. System Context — `C4Context`

The widest view: who uses the dashboard and what it talks to.

```mermaid
C4Context
    title System Context — Pi Dashboard

    Person(operator, "Operator", "Monitors & controls pi agent sessions remotely")

    System(dashboard, "Pi Dashboard", "Aggregates session events, serves web UI, relays commands")

    System_Ext(pi, "pi Sessions", "CLI agent runs with bridge extension loaded")
    System_Ext(browser, "Web Browser", "Renders React dashboard UI")

    Rel(operator, browser, "Views sessions, sends prompts")
    Rel(browser, dashboard, "HTTP + WebSocket", "REST / WS")
    Rel(pi, dashboard, "Forwards events", "WebSocket")
    Rel(dashboard, pi, "Relays prompts / aborts", "WebSocket")

    UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

---

## 2. Container — `C4Container`

Zoom in: the deployable/runnable pieces inside the dashboard boundary.

```mermaid
C4Container
    title Container Diagram — Pi Dashboard

    Person(operator, "Operator", "Uses the web UI")

    System_Boundary(dash, "Pi Dashboard") {
        Container(client, "Web Client", "React + Tailwind + Vite", "Responsive monitoring UI")
        Container(server, "Dashboard Server", "Node.js + Fastify", "Event aggregation, JSON persistence, dual WS servers")
        ContainerDb(store, "Session Store", "In-memory + JSON files", "Holds session state & event history")
    }

    System_Ext(bridge, "Bridge Extension", "Runs inside each pi session, emits events")

    Rel(operator, client, "Interacts with", "HTTPS")
    Rel(client, server, "API calls + live events", "REST / WebSocket")
    Rel(server, store, "Reads / writes", "")
    Rel(bridge, server, "Streams events", "WebSocket")
    Rel(server, bridge, "Sends commands", "WebSocket")

    UpdateRelStyle(bridge, server, $offsetY="-30")
```

---

## 3. Component — `C4Component`

Zoom further into a single container (the server).

```mermaid
C4Component
    title Component Diagram — Dashboard Server

    Container_Boundary(server, "Dashboard Server") {
        Component(wsBridge, "Bridge WS Server", "ws", "Accepts pi bridge connections")
        Component(wsClient, "Client WS Server", "ws", "Pushes live updates to browsers")
        Component(rest, "REST API", "Fastify routes", "Health, sessions, restart, prompts")
        Component(registry, "Session Registry", "TS module", "Tracks connected sessions & state")
        Component(persist, "Persistence", "JSON files", "Durable session snapshots")
    }

    Rel(wsBridge, registry, "Updates session state")
    Rel(rest, registry, "Queries sessions")
    Rel(registry, wsClient, "Broadcasts deltas")
    Rel(registry, persist, "Snapshots")

    UpdateLayoutConfig($c4ShapeInRow="3")
```

---

## How to view it rendered

- **GitHub / GitLab** — push the file; the blocks render inline automatically.
- **VS Code** — install "Markdown Preview Mermaid Support", then open Preview (`Cmd+Shift+V`).
- **CLI → PNG/SVG** — `npx @mermaid-js/mermaid-cli -i docs/examples/c4-example.md -o c4.png`.
