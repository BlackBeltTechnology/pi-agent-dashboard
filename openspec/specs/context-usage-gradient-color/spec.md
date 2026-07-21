# context-usage-gradient-color Specification

## Purpose

Map a context-usage percentage to a single CSS color that shifts continuously from green through yellow to red, so the usage indicator conveys severity by hue. Inputs outside 0–100 are clamped before mapping.

## Requirements

### Requirement: Clamp input percent to 0–100

The system SHALL clamp the input percent to the inclusive range 0–100 before computing any color, so out-of-range inputs reuse the endpoint colors.

#### Scenario: Percent below 0 clamps to the 0% color

- WHEN `contextGradientColor` receives a negative percent
- THEN the color equals the 0% color `hsl(142, 71%, 45%)`

#### Scenario: Percent above 100 clamps to the 100% color

- WHEN `contextGradientColor` receives a percent greater than 100
- THEN the color equals the 100% color `hsl(0, 84%, 60%)`

### Requirement: Interpolate hue, saturation, and lightness across green → yellow → red

The system SHALL interpolate HSL components linearly in two halves — green→yellow for 0–50% and yellow→red for 50–100% — producing green at 0%, yellow at the 50% midpoint, and red at 100%.

#### Scenario: 0% yields green

- WHEN the clamped percent is 0
- THEN the color is `hsl(142, 71%, 45%)`

#### Scenario: 50% yields yellow

- WHEN the clamped percent is 50
- THEN the color is `hsl(48, 96%, 53%)`

#### Scenario: 100% yields red

- WHEN the clamped percent is 100
- THEN the color is `hsl(0, 84%, 60%)`

#### Scenario: Lower half interpolates green toward yellow

- WHEN the clamped percent is between 0 and 50
- THEN hue interpolates linearly from 142 toward 48
- AND saturation interpolates linearly from 71 toward 96
- AND lightness interpolates linearly from 45 toward 53

#### Scenario: Upper half interpolates yellow toward red

- WHEN the clamped percent is between 50 and 100
- THEN hue interpolates linearly from 48 toward 0
- AND saturation interpolates linearly from 96 toward 84
- AND lightness interpolates linearly from 53 toward 60

### Requirement: Return a rounded HSL color string

The system SHALL return a CSS `hsl()` string whose hue, saturation, and lightness components are each rounded to the nearest integer.

#### Scenario: Components are rounded integers

- WHEN a percent produces fractional HSL components
- THEN the returned string has the form `hsl(H, S%, L%)`
- AND H, S, and L are each rounded to the nearest integer
