## 1. SessionCard — единый рендер-путь

- [x] 1.1 Удалить `if (isMobile)` ветвление в SessionCard.tsx, оставить единый JSX
- [x] 1.2 Добавить `hidden md:flex` / `md:hidden` responsive-классы для десктоп-only и мобильных элементов
- [x] 1.3 Реализовать раскладку согласно mockup: 5 строк (desktop), 4 строки (mobile)
- [x] 1.4 Action-кнопки (pencil, eye, close) показывать только на hover десктопа (`opacity-0 group-hover:opacity-100`)
- [x] 1.5 Удалить `useMobile()` из SessionCard

## 2. SessionCard — удаление элементов

- [x] 2.1 Удалить TokenStats из карточки
- [x] 2.2 Удалить FlowActivityBadge (Flow badge) из карточки
- [x] 2.3 Удалить SessionFlowActions (Flow launcher) из карточки
- [x] 2.4 Удалить SessionOpenSpecActions из карточки
- [x] 2.5 Удалить SessionCardBadgeSlot и SessionCardActionBarSlot (plugin slots)
- [x] 2.6 Удалить ProcessList из карточки
- [x] 2.7 Удалить InlineRenameInput из карточки (двойной клик по имени)

## 3. Meta-чипсы

- [x] 3.1 Создать чипсы для git branch, worktree, attached proposal (`rounded-full`, иконка + текст)
- [x] 3.2 Рендерить чипсы в одной строке (flex-wrap) — строка 5 десктоп, строки 3-4 мобилка
- [x] 3.3 Git чип должен включать PR number когда есть (`feature/x · #42`)
- [x] 3.4 Cost ($) скрывать когда 0 или null

## 4. FolderActionBar — редизайн

- [x] 4.1 Удалить отдельные кнопки Terminals, Editor, Zed, Pi Resources
- [x] 4.2 Создать Tools dropdown с `<details>/<summary>` на десктопе
- [x] 4.3 Tools dropdown содержит: Terminals(N), Editor (с зелёной точкой статуса), native editors, Pi Resources
- [x] 4.4 На мобилке: только +Session и +Worktree (без dropdown)
- [x] 4.5 +Session и +Worktree на мобилке сделать `flex-1` (растянуты на всю ширину)

## 5. Drag-to-reorder — удаление

- [x] 5.1 Удалить SortableSessionCard обёртку из SessionList
- [x] 5.2 Удалить DndContext, SortableContext из SessionList (если не используется для SortablePinnedGroup)
- [x] 5.3 Проверить использование @dnd-kit в проекте; если только drag сессий — удалить зависимость. Результат: @dnd-kit нужен для SortablePinnedGroup, оставлен. Удалён только SortableSessionCard.tsx.

## 6. README button — удаление

- [x] 6.1 Удалить кнопку README из заголовка папки в SessionList
- [x] 6.2 Удалить пропсы `onViewReadme`, `readmeDirs` из SessionList и всех потребителей

## 7. PlaceholderSessionCard — редизайн

- [x] 7.1 Обновить PlaceholderSessionCard: `rounded-xl`, padding как у новой карточки, `bg-[var(--bg-tertiary)]`, `border-[var(--border-subtle)]`
- [x] 7.2 На десктопе: скелетон в 3 строки (имя, модель, активность+контекст+cost)
- [x] 7.3 На мобилке: скелетон в 2 строки (имя, модель)

## 8. Тесты

- [x] 8.1 Обновить SessionCard.test.tsx: убрать тесты удалённых элементов, добавить тесты чипсов и responsive-классов
- [x] 8.2 Обновить/добавить тесты для FolderActionBar
- [x] 8.3 Обновить PlaceholderSessionCard.test.tsx
- [x] 8.4 Убедиться что `npm test` проходит

## 9. Финальная сборка

- [x] 9.1 `npm run build` — собрать клиент
- [x] 9.2 `curl -X POST http://localhost:8000/api/restart` — перезапустить сервер
- [x] 9.3 Проверить десктоп и мобильный вид в браузере
