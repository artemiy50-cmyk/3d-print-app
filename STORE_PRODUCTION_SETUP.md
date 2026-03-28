# Вывод магазина в прод на поддомене (GitHub Pages + sync)

Пошаговая настройка **одного** магазина на **третьем уровне**: `your-shop.example.com`  
(ниже везде плейсхолдеры — подставьте свой поддомен, домен второго уровня и GitHub-логин.)

**Идея:** код Store в **одном** основном репозитории (`store.html`, `store.js`, `style.css`). Для **каждого** поддомена — **отдельный** небольшой репозиторий под GitHub Pages; workflow **Store Sync** копирует файлы и создаёт `CNAME`.

---

## Что можно держать в публичном репозитории

| Обычно **не** считается секретом | **Нельзя** светить |
|----------------------------------|-------------------|
| URL сайтов, поддомены, имена репозиториев GitHub | Пароли, приватные ключи, **Personal Access Token** (PAT), содержимое `firebase-key.json` |
| Публичные параметры **Firebase** из клиентского кода (`apiKey`, `databaseURL`, `projectId` и т.д.) — они и так видны в браузере; доступ режется **правилами БД** и настройками в консоли Firebase | Сервисный аккаунт Google, секреты Cloudinary в репо (держите в GitHub Secrets / локально) |
| `store-deploy-config.json` — раскрывает **имена** репозиториев (`owner/repo`), не пароли | Секрет `STORE_SYNC_TOKEN` хранится только в **Settings → Secrets** репозитория, в git не попадает |

Если не хотите афишировать связку «какой GitHub-аккаунт какие магазины ведёт» — делайте основной или deploy-репозитории **приватными** (учитывайте лимиты GitHub и правила Pages для приватных репо).

---

## Что должно быть заранее

- Основной репозиторий с приложением, ветка **`main`**.
- Файл `.github/workflows/store-sync.yml` в основном репо.
- Домен второго уровня (например **`example.com`**) с DNS у регистратора (**reg.ru** или другой).
- Значения для подстановки:
  - **`YOUR_SHOP`** — поддомен **строчными** латиницей, как в URL: `your-shop` → `your-shop.example.com`.
  - **`YOUR_DOMAIN`** — `example.com` (без `www` для записи CNAME поддомена).
  - **`YOUR_GITHUB_USER`** — логин или организация на GitHub.
  - **`YOUR_PAGES_HOST`** — обычно `YOUR_GITHUB_USER.github.io` (цель CNAME в DNS).

---

## Шаг 0. Поддомен в Firebase и в Manager

1. Войдите в **Manager** (ваш прод-URL приложения).
2. Раздел магазина / витрины.
3. Укажите **поддомен** ровно **`YOUR_SHOP`** (как в будущем URL и в `storesBySubdomain`).
4. Заполните витрину (отображаемое имя магазина, товары и т.д.), **сохраните**.

Проверка (опционально): в Realtime Database есть `storesBySubdomain/YOUR_SHOP` → ваш `ownerUid`, и данные `users/{uid}/store`, `storeProducts` и т.д.

---

## Шаг 1. Репозиторий под GitHub Pages для этого магазина

1. GitHub → **New repository**.
2. **Owner:** `YOUR_GITHUB_USER`.
3. **Имя:** например **`store-YOUR_SHOP`** (соглашение `store-{поддомен}`).
4. Для бесплатного GitHub Pages на **своём** домене чаще нужен **Public** репозиторий — уточните [актуальные правила GitHub](https://docs.github.com/pages).
5. Без README / .gitignore / license (пустой репозиторий).
6. **Create repository.**

Полное имя: **`YOUR_GITHUB_USER/store-YOUR_SHOP`**.

---

## Шаг 2. Включить GitHub Pages в deploy-репо

1. Репозиторий **`store-YOUR_SHOP`** → **Settings** → **Pages**.
2. Source: **Deploy from a branch**.
3. Branch: **`main`**, folder: **`/ (root)`**.
4. Save.

До первого sync сайт может отдавать 404 — нормально.

---

## Шаг 3. Токен для push из основного репо

1. GitHub → **Settings** (профиль) → **Developer settings** → **Personal access tokens**.
2. Токен с правом пуша в **все** deploy-репо (**classic** `repo` или **fine-grained** с Contents: Read/Write на нужные репозитории).
3. В **основном** репо: **Settings** → **Secrets and variables** → **Actions**.
4. Секрет **`STORE_SYNC_TOKEN`** = значение токена (в git **не** коммитить).

При добавлении нового deploy-репо обновите права токена (fine-grained) или создайте новый PAT.

---

## Шаг 4. Конфиг `store-deploy-config.json` в основном репо

Добавьте объект в массив `deployRepos`:

```json
{
  "deployRepos": [
    {
      "repo": "YOUR_GITHUB_USER/store-YOUR_SHOP",
      "subdomain": "YOUR_SHOP"
    }
  ],
  "githubPagesBase": "YOUR_GITHUB_USER.github.io"
}
```

Несколько магазинов — несколько элементов в `deployRepos`.  
Поле **`githubPagesBase`** должно совпадать с хостом, на который указывает CNAME в DNS (**`YOUR_GITHUB_USER.github.io`**).

Commit + push в **`main`**.

---

## Шаг 5. Первый запуск синхронизации

1. **Actions** → **Store Sync to Deploy Repos** → **Run workflow** (ветка `main`),  
   или push в `main`, затронувший `store.html`, `store.js`, `style.css`, `store-deploy-config.json` или workflow.

2. Убедитесь, что job **успешен**. В **`store-YOUR_SHOP`** на **`main`** должны появиться: `index.html`, `store.js`, `style.css`, при наличии — `favicon.ico`, файл **`CNAME`** с одной строкой:

```text
YOUR_SHOP.YOUR_DOMAIN
```

(без `https://`)

---

## Шаг 6. DNS у регистратора (пример reg.ru)

1. Личный кабинет → ваш домен **`YOUR_DOMAIN`** → управление DNS / зоной.
2. Новая запись:
   - **Тип:** `CNAME`.
   - **Имя / поддомен:** `YOUR_SHOP` (только первая метка, без `.YOUR_DOMAIN`).
   - **Значение:** **`YOUR_GITHUB_USER.github.io`** (без `https://`, без `/`).
   - **TTL:** по умолчанию или 3600.

3. Сохранить. Подождать распространения DNS (от минут до нескольких часов).

Интерфейс reg.ru может называть поля чуть иначе; суть — CNAME с поддомена магазина на `username.github.io`.

---

## Шаг 7. Кастомный домен в GitHub Pages

1. Репозиторий **`store-YOUR_SHOP`** → **Settings** → **Pages**.
2. **Custom domain:** `YOUR_SHOP.YOUR_DOMAIN`.
3. После проверки DNS — при необходимости **Enforce HTTPS**.

---

## Шаг 8. Проверка

Откройте **`https://YOUR_SHOP.YOUR_DOMAIN`**. Должен открыться Store; данные из Firebase по поддомену **`YOUR_SHOP`**. При ошибках — поддомен в Manager, `storesBySubdomain`, консоль браузера (F12).

---

## Обновления кода магазина

Изменения в **`store.html`**, **`store.js`**, **`style.css`** в основном репо → push в **`main`** → sync обновит **все** репо из `deployRepos`. Ручной запуск: **Actions** → **Store Sync** → **Run workflow**.

---

## Краткий чеклист

| # | Действие |
|---|----------|
| 1 | Поддомен **`YOUR_SHOP`** в Manager, витрина сохранена |
| 2 | Создать **`YOUR_GITHUB_USER/store-YOUR_SHOP`**, Pages с ветки **`main`** |
| 3 | Секрет **`STORE_SYNC_TOKEN`** в основном репо |
| 4 | Запись в **`store-deploy-config.json`**, push в **`main`** |
| 5 | Запустить **Store Sync** |
| 6 | CNAME: **`YOUR_SHOP`** → **`YOUR_GITHUB_USER.github.io`** |
| 7 | Custom domain **`YOUR_SHOP.YOUR_DOMAIN`** в Pages deploy-репо, HTTPS |
| 8 | Проверить URL в браузере |

---

## См. также

- **`STORE_GITHUB_PAGES_PLAN.md`** — архитектура sync.
- **`STORE_MIGRATE_GITHUB_STEPS.md`** — перенос DNS/хостинга на reg.ru и GitHub Pages.

Для **второго** магазина: новый репо `store-…`, новая строка в JSON, новая CNAME-запись, тот же токен и workflow.
