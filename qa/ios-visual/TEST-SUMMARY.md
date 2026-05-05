# iOS Visual Smoke Test: Focused Chat Input

## Что тестируем

Визуальное состояние поля ввода (textarea) в iOS Safari на iPhone при фокусе. Тест ловит регрессии:
- Пропадающий/невидимый курсор (каретка)
- Отсутствующий focus ring (border-blue-500)
- Сломанная вёрстка вокруг инпута при появлении клавиатуры
- Баги с клавиатурой (не показывается / перекрывает контент)

## Как запустить

```bash
# 1. Поднять fixture dashboard (изолированный сервер с seeded-сессиями)
cd qa/ios-visual
node scripts/fixture-launcher.mjs --serve &

# 2. Прогнать только fixture-dashboard спеки
SIM_UDID=<udid> IOS_DEVICE_NAME="iPhone 16" IOS_PLATFORM_VERSION=26.4 \
  PI_DASHBOARD_BASE_URL=http://127.0.0.1:9800 \
  PI_DASHBOARD_FIXTURE_MODE=1 \
  PI_DASHBOARD_FIXTURE_URL=http://127.0.0.1:9800 \
  npx wdio run ./wdio.conf.ts --spec specs/fixture-dashboard.spec.ts
```

Скриншоты падают в `visual/.tmp/` и `visual/.tmp/actual/`.

## Что делает тест (fixture-dashboard.spec.ts, 3-й it)

```
it("should display the focused chat input state", async () => {
  // 1. Стабилизация страницы (тёмная тема, localStorage, reload)
  await navigateTo(browser, "/session/fixture-session-active");
  await stabilizeForVisual(browser);

  // 2. Клик в textarea — фокус + клавиатура
  const textarea = await browser.$('textarea[placeholder*="Message"]');
  await textarea.click();
  await browser.pause(2000);

  // 3. Native screenshot (NATIVE_APP контекст) — ловит клавиатуру
  await browser.switchContext("NATIVE_APP");
  await browser.saveScreenshot("./visual/.tmp/...-native.png");

  // 4. Visual checkpoint для диффа
  await visualCheck(browser, "fixture-session-detail-input-focused");
});
```

## Два скриншота

| Тип | Размер | Что захватывает |
|-----|--------|-----------------|
| Native (`-native.png`) | 1178×2556 | Весь экран включая iOS-клавиатуру |
| Visual (`actual/...png`) | 1179×2085 | Только webview (без клавиатуры) |

## Текущие проблемы

1. **Клавиатура нестабильно показывается** — зависит от настроек симулятора:
   - `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false`
   - `CaptureKeyboardInput = YES` в `~/Library/Preferences/com.apple.iphonesimulator.plist` для UDID
   - После смены настроек нужен `killall Simulator` + перезапуск

2. **Модель не видит скриншоты** — проверить может только visual-qa агент или человек.

3. **Курсор/каретка** — в webview-скрине каретка не видна (баг). В native-скрине должно быть видно.

## Файлы

```
qa/ios-visual/
├── specs/fixture-dashboard.spec.ts   ← тест (3-й it)
├── specs/helpers/visual-helpers.ts   ← stabilizeForVisual, dismissNativePopups
├── wdio.conf.ts                      ← capabilities, webScreenshotMode: native
├── scripts/fixture-launcher.mjs      ← поднимает fixture
├── scripts/sim-create.sh             ← создаёт симулятор + ConnectHardwareKeyboard=false
├── visual/.tmp/*-native.png          ← native скрины с клавиатурой
└── visual/.tmp/actual/*.png          ← webview скрины для диффа
```
