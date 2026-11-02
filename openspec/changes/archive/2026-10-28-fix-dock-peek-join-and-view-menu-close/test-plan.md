# Test plan: fix-dock-peek-join-and-view-menu-close

Techniques: state transition (collapsed → peek → pinned/closed), equivalence partitioning (Reset / Set-as-global success / failure), error guessing (stacking vs composer, menus).

| # | Scenario | Triple (input · trigger · observable) | Level | Disposition |
|---|---|---|---|---|
| T1 | Peek joins as one surface | collapsed dock with a lane · dwell on bar → peek · root has `rounded-t-none` + `border-t-transparent` and no `z-0`; overlay has `rounded-t-xl`, `z-popover`, upward shadow, no `shadow-lg`; bar button has no `hover:bg-` class | L1 | automated |
| T2 | Not peeking: root unchanged | collapsed dock, no dwell · render · root keeps `z-0` + `rounded-t-xl`; region hidden | L1 | automated |
| T3 | Pin after peek restores the in-flow root | peeked dock · click Pin · root `z-0` + `rounded-t-xl` again; region not `absolute` | L1 | automated |
| T4 | Reset keeps the popover open | session override, popover open · click Reset · `setSessionDisplayPrefs override:null` sent AND `chat-view-popover` still rendered | L1 | automated |
| T5 | Set as global success keeps it open | override, PATCH 200 · click Set as global · override cleared AND popover still rendered, no success text | L1 | automated |
| T6 | Set as global failure keeps it open with error | override, PATCH 500 · click · error shown, popover rendered, no send | L1 | automated |
| T7 | Visual join + stacking in a live chat | real session, collapsed dock, scroll-to-bottom visible · hover bar · seamless join, overlay above scroll button, composer card covers dock foot, lane `⋯` menu above overlay | manual | manual-only |
