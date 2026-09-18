---
mode: dark
palette: blackbelt
material: glass
quality: high
---

# Az LLM-től az Ágensrajokig

Az autonóm szoftverfejlesztés új korszaka

<!-- deck3d: {"camera":{"distance":12},"check":{"ignore":["contrast"]}} -->

# Mi az LLM?

- Olvasott kolléga
- Nyelvi minták
- Gondolkodik, de nem cselekszik

<!-- deck3d: {"check":{"ignore":["contrast"]}} -->

# Agent Loop

- Plan → Act → Observe
- Önkorrekció
- Ciklikus működés

<!-- deck3d: {"check":{"ignore":["contrast"]}} -->

# Agent Swarm (2025)

- Szakosodott ágensek
- Együttműködés
- 1445% növekedés

<!-- deck3d: {"check":{"ignore":["contrast"]}} -->

# Ágens munkafolyamat

- Mermaid flowchart → 3D
- Layout: mermaid/dagre
- Szemantika: diagram.db

```mermaid
flowchart LR
  U([Fejlesztő]) --> P[Prompt]
  P --> L{{LLM}}
  subgraph AG [Ágensrendszer]
    L --> T[Eszközhívás]
    T -.-> O((Megfigyelés))
    O --> L
  end
  L ==>|kész| K[Kód + PR]
```

<!-- deck3d: {"camera":{"distance":12},"labels":{"size":0.24},"check":{"ignore":["contrast"]}} -->

# Javítási ciklus

- Mermaid sequence → 3D
- Idő = mélység
- Üzenetek sorban világítanak

```mermaid
sequenceDiagram
  participant F as Fejlesztő
  participant A as Ágens
  participant E as Eszközök
  F->>A: Feladat
  A->>E: Tesztek
  E-->>A: 3 hiba
  A->>E: Javítás
  E-->>A: Green
  A-->>F: PR kész
```

<!-- deck3d: {"camera":{"distance":12},"check":{"ignore":["contrast"]}} -->

# Köszönöm a figyelmet!

- AI = operációs rendszer
- Ember + gép együttműködés
- A jövő már itt van

<!-- deck3d: {"camera":{"distance":12},"check":{"ignore":["contrast"]}} -->
