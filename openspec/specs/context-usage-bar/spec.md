## Purpose

Defines the context usage bar displayed on session cards showing how full the LLM context window is.
## Requirements
### Requirement: Context usage gradient bar on session cards
The ContextUsageBar SHALL render in the session card only on desktop viewports (>= 768px). On mobile viewports, it SHALL be hidden via responsive CSS. The bar continues to be accessible in SessionSidebar on all viewports.

#### Scenario: Context bar hidden on mobile session card
- **WHEN** viewport < 768px and contextUsage data is available
- **THEN** ContextUsageBar SHALL NOT render in the SessionCard

#### Scenario: Context bar shown on desktop session card
- **WHEN** viewport >= 768px and contextUsage data is available
- **THEN** ContextUsageBar SHALL render in the SessionCard

