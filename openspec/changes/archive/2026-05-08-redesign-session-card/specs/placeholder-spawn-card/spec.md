## ADDED Requirements

### Requirement: Placeholder card visual style
The placeholder skeleton card SHALL match the redesigned SessionCard visual style: `rounded-xl`, same padding (`px-4 py-3` on mobile, `px-3 py-2.5` on desktop), border matching `border-[var(--border-subtle)]`, and the same `bg-[var(--bg-tertiary)]`. The pulse animation SHALL continue to indicate loading.

#### Scenario: Placeholder matches card style on mobile
- **WHEN** a placeholder card renders on viewport < 768px
- **THEN** it SHALL have the same border-radius, padding, and background as the redesigned mobile SessionCard

#### Scenario: Placeholder matches card style on desktop
- **WHEN** a placeholder card renders on viewport >= 768px
- **THEN** it SHALL have the same border-radius, padding, and background as the redesigned desktop SessionCard
