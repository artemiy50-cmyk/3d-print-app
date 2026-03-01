# Store Landing — Фаза 2: Модель и правила

Подробный план действий по внедрению модели данных в Firebase Realtime Database, индекса `storesBySubdomain` и правил безопасности.

---

## 1. Цели фазы

1. Реализовать резолв поддомена: `ivan-shop.my-3d-print.ru` → определение владельца магазина через Firebase.
2. Ввести структуру данных для магазина и его продуктов.
3. Настроить правила безопасности Realtime Database.
4. Обновить `store.js` — загрузка настроек магазина и проверка «магазин найден / не найден».

**Не входит в Фазу 2:** раздел «Мой магазин» в Manager (Фаза 3), каталог и корзина в Store (Фаза 4).

---

## 1.1. Файлы Фазы 2

| Файл | Назначение |
|------|------------|
| `database.rules.json` | Правила Realtime Database (версионируются в Git) |
| `firebase.json` | Конфиг Firebase CLI для деплоя правил |
| `scripts/seed-store-phase2.html` | Скрипт тестовых данных |

---

## 2. Модель данных Firebase

### 2.1 Индекс поддоменов: `storesBySubdomain`

**Путь:** `storesBySubdomain/{subdomain}`  
**Назначение:** быстрый поиск владельца магазина по поддомену без перебора всех пользователей.

```
storesBySubdomain/
  ivan-shop:       { ownerUid: "abc123..." }
  test-store:      { ownerUid: "def456..." }
```

- **Ключ** — поддомен (lowercase, без спецсимволов).
- **Значение** — объект с полем `ownerUid` (UID пользователя в Firebase Auth).

### 2.2 Настройки магазина: `users/{uid}/store`

**Путь:** `users/{uid}/store`  
**Назначение:** публичные настройки магазина (название, описание, контакты и т.п.).

```
users/{uid}/store:
  subdomain:       "ivan-shop"           // зарезервированный поддомен
  title:           "Магазин Ивана"       // заголовок
  description:     "3D-печать на заказ"  // краткое описание
  contactEmail:    ""                    // опционально
  contactTelegram: ""                    // опционально
  enabled:         true                  // магазин включён/выключен
  createdAt:       "2026-02-26T..."      // ISO-строка
  updatedAt:       "2026-02-26T..."
```

В Фазе 2 достаточно полей `subdomain`, `title`, `description`, `enabled`. Остальное — в Фазе 3.

### 2.3 Продукты магазина: `users/{uid}/storeProducts`

**Путь:** `users/{uid}/storeProducts`  
**Назначение:** список продуктов, видимых в публичном каталоге. В Фазе 2 — только структура; наполнение — в Фазе 3–4.

```
users/{uid}/storeProducts/
  0: { productId: 12345, price: 500, ... }   // ссылка на products[id] + доп. поля
  1: { productId: 67890, price: 1200, ... }
```

**Связь с `data/products`:**  
- `productId` — ID изделия из `users/{uid}/data/products`.  
- В каталоге Store показываем данные из `products` (name, imageUrl, weight и т.д.) плюс цену из `storeProducts`.  
- В Фазе 2 запись в `storeProducts` не добавляем — это задел для Фазы 3.

**Пример записи для проверки (Фаза 2):**

```
users/{uid}/storeProducts/
  0: {
    productId: 12345,      // ID из data/products
    price: 500,            // цена за 1 шт. (₽)
    inCatalog: true        // показывать в каталоге
  }
```

> В Фазе 2 скрипт добавит одну такую запись (с валидным `productId` или заглушкой). Store проверит, что чтение `storeProducts` работает. Полноценный рендер каталога — в Фазе 4.

---

## 3. Правила безопасности Realtime Database

**Используется вариант B:** правила хранятся в репозитории (`database.rules.json`), деплой через `firebase deploy --only database`. См. файлы в разделе 1.1.

### 3.1 Изменения в правилах

**Требования:**

| Путь | Кто читает | Кто пишет |
|------|------------|-----------|
| `storesBySubdomain` | все (в т.ч. анонимы) | только авторизованные |
| `users/{uid}/store` | все (в т.ч. анонимы) | только `auth.uid === uid` |
| `users/{uid}/storeProducts` | все (в т.ч. анонимы) | только `auth.uid === uid` |
| `users/{uid}/data` | только владелец | только владелец |
| `users/{uid}/subscription`, `settings`, `stats` | только владелец | только владелец |

**Полные правила:** см. файл `database.rules.json` в проекте. При деплое они **полностью заменяют** текущие правила в Firebase — если у вас есть кастомные правила, объедините их с `database.rules.json` перед первым деплоем.

### 3.2 Проверка при записи в `storesBySubdomain`

При привязке поддомена (Фаза 3) — в коде: проверка занятости поддомена и запрещённых имён.

---

## 4. Изменения в коде

### 4.1 store.js

**4.1.1 Инициализация Firebase**

- Убедиться, что Firebase App и Realtime Database инициализируются (скрипты уже подключены в `store.html`).
- Вызвать `firebase.initializeApp(firebaseConfig)` и `firebase.database()` при загрузке.

**4.1.2 Резолв поддомена**

1. Получить поддомен: `getSubdomain()` (уже есть).
2. Запросить `storesBySubdomain/{subdomain}`.
3. Если данных нет или `ownerUid` отсутствует → `showState('notFound', { reason: 'Магазин не зарегистрирован' })`.
4. Если `ownerUid` есть → запросить `users/{ownerUid}/store`.
5. Если `store` пустой или `enabled === false` → `showState('notFound', ...)`.
6. Если магазин найден и включён → вызвать `updateHeader(store.title, store.description)` и `showState('catalog')`.

**4.1.3 Обработка ошибок**

- Ошибки сети / Firebase логировать в консоль.
- При ошибке показывать состояние «Магазин не найден» или «Ошибка загрузки» с понятным текстом.

**4.1.4 Хранение загруженных данных**

- Сохранить в переменные: `storeOwnerUid`, `storeConfig` — для последующего использования в Фазе 4 (загрузка каталога).

### 4.2 store.html

- Без изменений в Фазе 2 (Firebase уже подключён).

### 4.3 Тестовые данные

Создаются скриптом `scripts/seed-store-phase2.html` (см. раздел 7).

---

## 5. Критерии приёмки Фазы 2

- [ ] По адресу `store.html?store=ivan-shop` (или `ivan-shop.my-3d-print.ru` после DNS) отображается заголовок и описание из `users/{uid}/store`.
- [ ] При несуществующем поддомене показывается «Магазин не найден».
- [ ] Правила Realtime Database разрешают анонимное чтение `storesBySubdomain` и `users/{uid}/store`, `users/{uid}/storeProducts`.
- [ ] Запись в эти ветки возможна только авторизованным владельцам.

---

## 6. Скрипт тестовых данных

Файл: `scripts/seed-store-phase2.html` — страница в браузере, добавляет тестовый магазин `ivan-shop` и пример записи в `storeProducts`. Использует Firebase Web SDK; требуется авторизация в Manager на том же домене.

---

## 7. Действия с вашей стороны (подробно)

Порядок выполнения — строго по шагам. Без шагов 1–3 код store.js не сможет загрузить магазин.

---

### ШАГ 1. Узнать свой UID

**Момент:** перед всеми остальными действиями.

**Что сделать:**
1. Откройте Manager: `index.html` или `app.my-3d-print.ru`
2. Войдите в аккаунт
3. Откройте браузерную консоль (F12 → Console)
4. Введите: `firebase.auth().currentUser.uid`
5. Скопируйте выданную строку (например, `aB3xY9kL2...`) — это ваш `uid`

Сохраните `uid` — он понадобится в шаге 3 и при запуске скрипта.

---

### ШАГ 2. Развернуть правила через Firebase CLI

**Момент:** после шага 1, до запуска скрипта и проверки Store.

> **Важно:** при деплое правила из `database.rules.json` **полностью заменяют** текущие правила в Firebase. Если у вас есть кастомные правила, скопируйте их из [Firebase Console](https://console.firebase.google.com) → Realtime Database → Rules и объедините с `database.rules.json` перед деплоем.

**2.1. Установить Firebase CLI (если ещё не установлен)**

```powershell
npm install -g firebase-tools
```

Или через Chocolatey: `choco install firebase-cli`.

**2.2. Войти в Firebase**

```powershell
firebase login
```

Откроется браузер для авторизации.

**2.3. Привязать проект**

В папке проекта `3d-print-app`:

```powershell
firebase use d-print-app-3655b
```

(или ваш project ID — см. `script.js`, `firebaseConfig.projectId`).

**2.4. Развернуть правила**

```powershell
firebase deploy --only database
```

Ожидаемый вывод: `✔  Deploy complete!`

**Проверка:** [Firebase Console](https://console.firebase.google.com) → Realtime Database → Rules. Должны появиться `storesBySubdomain`, `users/$uid/store`, `users/$uid/storeProducts`.

---

### ШАГ 3. Запустить скрипт тестовых данных

**Момент:** после шага 2, когда правила опубликованы.

**Что сделать:**
1. Запустите локальный сервер (если ещё не запущен):
   ```
   python -m http.server 3000
   ```
2. Откройте Manager и **войдите** в аккаунт: `http://localhost:3000/index.html`
3. В той же вкладке или в новой откройте:
   ```
   http://localhost:3000/scripts/seed-store-phase2.html
   ```
4. Проверьте, что на странице отображается ваш UID и кнопка активна
5. Нажмите **«Создать тестовые данные»**
6. Дождитесь сообщения «Готово»

**Результат:** в базе появятся:
- `storesBySubdomain/ivan-shop` → `{ ownerUid: "ваш_uid" }`
- `users/ваш_uid/store` → настройки тестового магазина
- `users/ваш_uid/storeProducts/0` → пример записи (productId: 0, price: 500, inCatalog: true)

**Проверка:** Firebase Console → Realtime Database → Data. Убедитесь, что эти пути заполнены.

---

### ШАГ 4. Проверить Store локально

**Момент:** после того, как я обновлю `store.js` (или вы примените изменения).

**Что сделать:**
1. Запустите локальный сервер (Python):
   ```
   python -m http.server 3000
   ```
2. Откройте в браузере:
   ```
   http://localhost:3000/store.html?store=ivan-shop
   ```
3. Ожидается:
   - Заголовок: «Тестовый магазин» (или как задано в скрипте)
   - Описание: «Проверка Фазы 2»
   - Нет сообщения «Магазин не найден»
4. Проверьте несуществующий магазин:
   ```
   http://localhost:3000/store.html?store=non-existent-shop
   ```
   Должно показаться «Магазин не найден».

---

### Краткая последовательность

```
ШАГ 1 (Вы)   → Узнать uid (для справки и отладки)
ШАГ 2 (Вы)   → firebase login → firebase use <project> → firebase deploy --only database
ШАГ 3 (Вы)   → Войти в Manager → открыть scripts/seed-store-phase2.html → нажать «Создать тестовые данные»
         (Я)   → Обновить store.js
ШАГ 4 (Вы)   → Открыть store.html?store=ivan-shop и проверить отображение
```

> ШАГ 1 можно выполнить в любой момент. ШАГ 2 и 3 — до проверки Store. Обновление store.js (моя часть) может идти параллельно с вашими шагами 2–3. После любых изменений в `database.rules.json` — повторять `firebase deploy --only database`.
