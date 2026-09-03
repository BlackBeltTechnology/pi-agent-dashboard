# PiVersionAdvisory.tsx — index

NEW. Settings→General advisory. Receives `compatibility` via prop (host panel polls once; its internal `usePiCompatibility` call moved up) + optional `onChangeRuntime` rendering the `Change…` affordance (testid `pi-advisory-change`) in both alert states; renders unchanged without it. Hidden when compatibility null or no error/upgradeRecommended. Amber pill below recommended. Red panel + `npm install -g` disclosure below minimum. See change: restore-pi-version-skew-surface, surface-pi-runtime-on-general.
