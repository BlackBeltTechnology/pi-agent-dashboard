## Context

SessionCard — центральный элемент боковой панели дашборда. Показывает состояние pi-сессии: статус, модель, активность, контекст, стоимость, git, OpenSpec, flows, дочерние процессы, плагины. Текущая реализация имеет два независимых рендер-пути (JSX `if (isMobile)` vs десктоп), что приводит к дублированию кода и расхождению поведения. Карточка смешивает отображение состояния с интерактивными действиями.

FolderActionBar — панель действий над папкой: создание сессии, терминалы, редактор, Pi Resources. На мобилке 5-7 кнопок нечитаемы.

Стек: React 19 + Tailwind CSS + `@mdi/js` иконки. Темы: тёмная и светлая через CSS-переменные.

## Goals / Non-Goals

**Goals:**
- Единый JSX-рендер SessionCard, адаптирующийся к ширине через Tailwind responsive-классы
- Визуальный стиль: минимализм / Apple-style (blur-фоны, мягкие тени, воздух)
- Карточка показывает только состояние; действия — в SessionHeader/SessionSidebar
- Mobile-first: карточка читаема на 320px, touch-friendly (min 44px tap-цели)
- FolderActionBar: основные экшены на виду, второстепенные — в выпадающем меню (desktop)
- Обе темы (тёмная + светлая) поддерживаются без изменений в теме-системе

**Non-Goals:**
- Изменение поведения SessionSidebar или SessionHeader (только переезд действий в них)
- Изменение темы-системы (`ThemeProvider`, CSS-переменные)
- Изменение протокола WebSocket или REST API
- Swipe-жесты на мобилке

## Decisions

### 1. Единый рендер-путь через Tailwind responsive

**Решение**: Один JSX с классами `hidden md:inline`, `md:hidden`, `md:flex` и т.д.
**Альтернатива**: Два ветвления `if (isMobile)` — отвергнуто из-за дублирования.
**Mobile breakpoint**: `< 768px` (md в Tailwind) — совпадает с существующим `useMobile()`.

### 2. Backdrop-blur для выделенной карточки

**Решение**: Выбранная карточка использует `bg-blue-500/5 backdrop-blur-sm` вместо `bg-blue-500/5 ring-1 ring-blue-500/30`.
**Причина**: Blur создаёт «парящий» эффект, соответствующий Apple-style минимализму.

### 3. Чипсы для meta-информации

**Решение**: Git branch, worktree, attached proposal — inline-чипсы в одной строке:
```
⎇ feature/x   📁 shadow/feat   📎 add-auth
```
Формат чипса: `px-1.5 py-0.5 rounded-full text-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)]`.
**Причина**: Компактно, сканируемо, экономит вертикальное пространство.

### 4. Выпадающее меню «Инструменты»

**Решение**: Terminals, Editor, native editors, Pi Resources — в `<details>/<summary>` или Popover API выпадающем меню за одной кнопкой.
**Альтернатива**: Context menu на правый клик — отвергнуто из-за плохой discoverability и отсутствия на мобилке.

### 5. Удаление @dnd-kit

**Решение**: Проверить использование `@dnd-kit` вне session drag-to-reorder. Если не используется — удалить зависимость.
**Причина**: Drag-to-reorder удалён, незачем тащить зависимость.

### 6. README button — полное удаление

**Решение**: Выпилить кнопку README из `SessionList.tsx` (заголовок папки) и все связанные пропсы (`onViewReadme`, `readmeDirs`).
**Причина**: Пользователь считает ненужным.

## Risks / Trade-offs

- **[Удаление inline rename]**: Пользователи, привыкшие к двойному клику для переименования, потеряют эту возможность → Rename остаётся доступен через SessionSidebar/SessionHeader
- **[Удаление process list из карточки]**: Меньше видимости дочерних процессов → ProcessList доступен в детализации сессии
- **[Удаление drag-to-reorder]**: Сессии больше нельзя переупорядочивать вручную → Порядок определяется сервером (последняя активная сверху)
- **[Меню «Инструменты» вместо отдельных кнопок]**: Дополнительный клик для доступа к терминалу/редактору → Это редко используемые экшены, компромисс оправдан

## Visual Design

Полный визуальный макет доступен в [`mockup.html`](mockup.html). Скриншот: [`screenshots/mockup-final.png`](screenshots/mockup-final.png).

Макет покрывает 16 визуальных состояний:
- **Desktop**: sidebar с карточками, idle, streaming, ended, ask_user, selected, chips (git+worktree+attached), openspec badge, tools dropdown
- **Mobile**: sidebar с карточками, idle, streaming, chips
- **FolderActionBar**: desktop (с Tools dropdown), mobile (только +Session +Worktree)
- **Placeholder**: скелетон в новом стиле

Ключевые визуальные решения:
- Backdrop-blur на selected карточке (`bg-blue-500/5 backdrop-blur-sm border-blue-500/60`)
- Action кнопки (pencil, eye, close) скрыты до hover (`opacity-0 group-hover:opacity-100`)
- Адаптивная вёрстка: `hidden md:flex` / `md:hidden` вместо JS-ветвления
- Чипсы: `rounded-full text-[10px] border border-[var(--border-subtle)]`
- Streaming карточки: `bg-yellow-500/10 border-yellow-500/30 animate-pulse`
- Ask_user карточки: `bg-purple-500/10 border-purple-500/30 animate-pulse`

## Open Questions

- Используется ли `@dnd-kit` где-то кроме drag-to-reorder сессий? Если да — удалять только SortableSessionCard, зависимость оставить.
