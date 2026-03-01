# Store Landing — Фаза 1: Инфраструктура

Инструкция по настройке wildcard DNS, хостинга и базового Store SPA.  
План: `store_landing_feature_bf77f04f.plan.md`

---

## Созданные файлы

| Файл | Назначение |
|------|------------|
| `store.html` | Entry point Store SPA (публичный магазин) |
| `store.js` | Резолв поддомена, подготовка к Firebase (Фаза 2) |
| `middleware.js` | Vercel Edge Middleware — роутинг по host |
| `vercel.json` | Дополнительные rewrites для app.my-3d-print.ru |
| `style.css` | Добавлены стили `.store-*` |

---

## Шаг 1. Проверка локально

Проверка нужна, чтобы убедиться: Store-страница открывается и определяет «поддомен» (код магазина).

**Почему эмуляция?** В продакшене магазин будет по адресу `test-shop.my-3d-print.ru`. На локальном ПК таких поддоменов нет, поэтому мы передаём код магазина через `?store=test-shop` в адресной строке.

**Важно:** Серверы `serve` и `http-server` делают редирект 301 с `store.html` на `/store`, при этом теряется параметр `?store=`. Используйте **Python-сервер** — он не редиректит.

### Пошагово

1. **Запуск локального сервера (Python)**
   - Откройте терминал (PowerShell или cmd) в папке проекта `3d-print-app`.
   - Выполните:
     ```powershell
     python -m http.server 3000
     ```
   - Должно появиться: `Serving HTTP on :: port 3000`.
   - Если Python не найден, установите с [python.org](https://python.org) или используйте `py -m http.server 3000`.

2. **Эмуляция поддомена**
   - **Вариант А (проще):** откройте в браузере:
     ```
     http://localhost:3000/open-store-test.html
     ```
     Страница сама перенаправит на тест магазина «test-shop».
   - **Вариант Б (вручную):** вставьте целиком:
     ```
     http://localhost:3000/store.html?store=test-shop
     ```
   - Важно: не нажимайте на `store.html` в списке файлов — там нет параметра `?store=`.

3. **Ожидаемый результат**
   - В адресной строке: `http://localhost:3000/store.html?store=test-shop`
   - Заголовок: «Магазин: test-shop».
   - Текст: «Поддомен: test-shop. Резолв через storesBySubdomain — в Фазе 2».

### Отладка (если видите «Магазин не найден»)

1. Откройте консоль браузера: **F12** → вкладка **Console**.
2. Найдите строку `[Store] Debug:` — там будут данные: `href`, `pathname`, `search`, `subdomain`.
3. Сделайте скриншот консоли или скопируйте вывод и покажите при обращении за помощью.
4. Убедитесь, что используете **Python-сервер**, а не `serve` или `http-server` — они делают редирект и теряют параметр.

---

## Шаг 2. Подключение к Vercel

1. Зарегистрируйтесь на [vercel.com](https://vercel.com) (есть бесплатный тариф).
2. Свяжите репозиторий:
   - **Add New Project** → Import Git Repository → выберите репозиторий.
3. Настройки проекта:
   - **Framework Preset:** Other
   - **Root Directory:** `3d-print-app` (если репо содержит вложенную папку) или `.`
   - **Build Command:** оставить пустым (статический сайт)
   - **Output Directory:** `.`
4. Deploy.

---

## Шаг 3. Добавление кастомных доменов

1. В Vercel: **Settings** → **Domains** → **Add**.
2. Добавьте домены:
   - `app.my-3d-print.ru` — Manager
   - `*.my-3d-print.ru` — wildcard для Store (множество поддоменов)
3. Vercel покажет инструкции по DNS.

---

## Шаг 4. Настройка DNS (reg.ru или другой регистратор)

### Вариант A: NS-серверы Vercel

1. В панели reg.ru: **Управление доменом** → **Смена DNS-серверов**.
2. Укажите NS Vercel:
   - `ns1.vercel-dns.com`
   - `ns2.vercel-dns.com`
3. Сохраните. DNS обновится в течение 24–48 часов.
4. Vercel сам настроит записи для apex, www и wildcard.

### Вариант B: CNAME без смены NS

1. В reg.ru: **Управление доменом** → **DNS-серверы и управление зоной**.
2. Добавьте CNAME:
   - **Имя:** `*` (или `*.my-3d-print.ru` — зависит от интерфейса)
   - **Значение:** `cname.vercel-dns.com`
3. Для Manager добавьте CNAME:
   - **Имя:** `app`
   - **Значение:** `cname.vercel-dns.com`
4. Сохраните.

> Если reg.ru не поддерживает wildcard CNAME, используйте Вариант A (NS на Vercel).

---

## Шаг 5. Поведение по домену

| URL | Отдаётся | Приложение |
|-----|----------|------------|
| `app.my-3d-print.ru/` | `index.html` | Manager |
| `test-shop.my-3d-print.ru/` | `store.html` | Store (subdomain: test-shop) |
| `test.my-3d-print.ru/` | `store.html` | Store (subdomain: test) |
| `store.html?store=ivan` | `store.html` | Store (dev-режим) |

---

## Резерв: path-based (без wildcard)

Если wildcard DNS недоступен, можно использовать path-based:

- Manager: `app.my-3d-print.ru/`
- Store: `app.my-3d-print.ru/shop.html?store=test-shop`

`store.js` уже поддерживает `?store=subdomain` для локальной отладки.

---

## Дальнейшие фазы

- **Фаза 2:** модель данных в Realtime Database, `storesBySubdomain`, правила безопасности.
- **Фаза 3:** раздел «Мой магазин» в Manager.
- **Фаза 4:** каталог, корзина, оформление заказа в Store.
- **Фаза 5:** уведомления (Telegram), личный кабинет покупателя.
