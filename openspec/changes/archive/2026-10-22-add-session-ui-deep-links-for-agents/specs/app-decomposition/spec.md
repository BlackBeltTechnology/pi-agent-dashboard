## MODIFIED Requirements

### Requirement: Layout component extraction
App.tsx SHALL delegate desktop and mobile layout rendering to `DesktopLayout` and `MobileLayout` components respectively. In embed mode (url-routing "Embed mode layout") the desktop layout SHALL omit the sidebar and the mobile layout's list panel SHALL show the embed home message instead of the session list.

#### Scenario: Desktop layout renders sidebar and detail
- **WHEN** viewport is desktop and embed mode is off
- **THEN** DesktopLayout renders ResizableSidebar with SessionList alongside the content area

#### Scenario: Mobile layout renders MobileShell
- **WHEN** viewport is mobile
- **THEN** MobileLayout renders MobileShell with list panel and detail panel with correct depth and back navigation

#### Scenario: Desktop layout in embed mode
- **WHEN** viewport is desktop and embed mode is on
- **THEN** DesktopLayout renders the content area without ResizableSidebar, SessionList, the hamburger or the mobile overlay

#### Scenario: Mobile layout in embed mode
- **WHEN** viewport is mobile and embed mode is on
- **THEN** MobileLayout renders MobileShell with its depth and back navigation, and its list panel shows the embed home message instead of SessionList
