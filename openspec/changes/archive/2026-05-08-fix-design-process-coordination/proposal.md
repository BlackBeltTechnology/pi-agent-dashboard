## Why

Дизайн-процесс (sandbox → скриншоты → дизайнер → ревью → правки) страдает от трёх системных проблем: (1) противоречивые инструкции между скиллами приводят к тому что агент использует локальный agent-browser вместо sandbox — скриншоты показывают старый код, (2) `capture-screenshots.sh` не пересобирает Docker-образ — молчаливая ложь на скриншотах, (3) юзер полностью пассивен до финального approval — не может вмешаться в промежуточные раунды, процесс идёт вслепую.

## What Changes

- **Сlayer 1 — Чиним хрупкое**: устраняем противоречие между `openspec-apply-change/SKILL.md` и `sandbox-designer/SKILL.md` (оба должны использовать Docker sandbox для AFTER-скриншотов). Добавляем `--build` в `capture-screenshots.sh`.
- **Сlayer 2 — Intercom-координация**: перестраиваем дизайн-процесс как последовательность turn'ов с явными остановками (агент завершает turn, ждёт intercom от сабагента или юзера). Добавляем чекпоинт-файл для восстановления состояния между turn'ами.
- **Сlayer 3 — Инструкции для всех участников**: каждый скилл получает явные правила: когда слать intercom, когда использовать `contact_supervisor`, формат сообщений, когда спрашивать юзера. Промпты сабагентам включают runId и координационные инструкции.
- **Сlayer 4 — Юзер в петле**: юзер получает промежуточные скриншоты и вопросы через intercom, может давать фидбек на каждом раунде, а не только в конце.

## Capabilities

### New Capabilities

- `design-process-coordination`: Turn-based design process state machine. Чекпоинт-файл с фазой и контекстом. Переходы между turn'ами через intercom-триггеры. User-in-the-loop на каждом раунде ревью.
- `sandbox-designer-intercom`: Sandbox-designer сабагент использует `contact_supervisor` для прогресса и решений. `progress_update` после каждого ревью, `need_decision` когда не уверен. Формат сообщений с runId и структурированным списком находок.
- `apply-change-design-loop`: Apply-change скилл реструктурирован как стейт-машина. Явные точки остановки: после запуска дизайнера, после получения ревью, после каждого раунда правок. Инструкции когда спрашивать юзера через intercom.

### Modified Capabilities

- `design-sandbox-docker`: Добавить `--build` в `capture-screenshots.sh`, чтобы образ пересобирался при каждом запуске. Задокументировать поведение.
- `design-sandbox-propose-integration`: Согласовать инструкции по захвату AFTER-скриншотов — всегда через Docker sandbox, никогда через локальный agent-browser. Убрать противоречие между скиллами.

## Impact

- **Skills**: `openspec-apply-change/SKILL.md`, `sandbox-designer/SKILL.md` — значительные правки (реструктуризация + новые секции про intercom)
- **Sandbox**: `sandbox/scripts/capture-screenshots.sh` — добавить `--build`
- **Новый файл**: `~/.pi/dashboard/design-review-state.json` — чекпоинт-файл для стейт-машины
- **Subagent prompts**: все `task` строки при вызове sandbox-designer должны включать координационные инструкции (runId, `contact_supervisor`, формат сообщений)
