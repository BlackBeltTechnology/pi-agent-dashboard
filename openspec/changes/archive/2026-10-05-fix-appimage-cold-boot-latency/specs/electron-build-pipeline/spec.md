## ADDED Requirements

### Requirement: AppImage boots within budget on the glibc-floor image

CI SHALL verify that the x64 AppImage, run extracted on the documented glibc floor image (Ubuntu 22.04), reaches a healthy `/api/health` within a documented time budget (90 s unless a measured floor is documented in the workflow comment). On success and on failure, the step SHALL print a per-phase boot timing table (on success before the step exits) measured by the step's own health-poll loop as the elapsed time at which each marker first appears in the Electron process log or the de-noised server log (the logs carry no per-line timestamps): Electron process start, server spawn header (including the selected TypeScript loader), first and last plugin-loader line, server listening, and first healthy response.

#### Scenario: Healthy boot within budget

- **WHEN** the CI Electron build runs the Ubuntu 22.04 AppImage smoke step
- **THEN** `/api/health` SHALL respond healthy within the documented budget
- **AND** the step log SHALL contain the per-phase boot timing table naming the loader that booted

#### Scenario: Slow boot is attributable

- **WHEN** the AppImage does not reach `/api/health` within the budget
- **THEN** the step SHALL fail
- **AND** its log SHALL contain the timing rows reached so far and the de-noised server log
