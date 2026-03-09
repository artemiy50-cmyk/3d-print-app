# Store на GitHub Pages — план (Вариант 2: GitHub Actions sync)

Цель: обойти блокировки Vercel в России, сохранив поддомены (`test-shop.my-3d-print.ru`).  
Один репозиторий — источник правды, GitHub Actions раскидывает код по deploy-репо.

---

## Архитектура

```
┌─────────────────────────────┐
│  3d-print-app (main repo)   │  ← редактируете здесь
│  - store.html               │
│  - store.js                 │
│  - style.css                │
│  - store-deploy-config.json │  ← список deploy-репо
│  - .github/workflows/       │
└──────────────┬──────────────┘
               │  push / manual
               ▼
┌─────────────────────────────┐
│     GitHub Action           │  копирует файлы в каждый deploy-репо
└──────────────┬──────────────┘
               │
       ┌───────┼───────┐
       ▼       ▼       ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│store-    │ │store-    │ │store-    │  GitHub Pages
│test-shop │ │shop2     │ │my-shop   │  + CNAME
│CNAME:    │ │CNAME:    │ │CNAME:    │
│test-shop.│ │shop2.    │ │my-shop.  │
│my-3d-    │ │my-3d-    │ │my-3d-    │
│print.ru  │ │print.ru  │ │print.ru  │
└──────────┘ └──────────┘ └──────────┘
```

---

## Шаг 1. Подготовка основного репо

### 1.1 Файл конфигурации deploy-репо

Создайте `store-deploy-config.json` в корне проекта:

```json
{
  "deployRepos": [
    {
      "repo": "YOUR_USERNAME/store-test-shop",
      "subdomain": "test-shop"
    }
  ],
  "githubPagesBase": "YOUR_USERNAME.github.io"
}
```

- `repo` — полное имя репозитория (owner/name).
- `subdomain` — поддомен (без `.my-3d-print.ru`).
- `githubPagesBase` — для DNS: CNAME указывает сюда.

### 1.2 Какие файлы синхронизировать

| Источник (main) | Назначение (deploy) |
|-----------------|---------------------|
| `store.html`    | `index.html`        |
| `store.js`      | `store.js`          |
| `style.css`     | `style.css`         |
| —               | `favicon.ico` (если есть) |
| —               | `CNAME` (генерируется: `{subdomain}.my-3d-print.ru`) |

`index.html` — это копия `store.html`, чтобы корень `test-shop.my-3d-print.ru/` открывал Store.

---

## Шаг 2. GitHub Action workflow

Создайте `.github/workflows/store-sync.yml`:

```yaml
name: Store Sync to Deploy Repos

on:
  push:
    branches: [main]
    paths:
      - 'store.html'
      - 'store.js'
      - 'style.css'
      - 'store-deploy-config.json'
      - '.github/workflows/store-sync.yml'
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Read config
        id: config
        run: |
          echo "config<<EOF" >> $GITHUB_OUTPUT
          cat store-deploy-config.json >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Sync to deploy repos
        env:
          PAT: ${{ secrets.STORE_SYNC_TOKEN }}
        run: |
          # Установка git и jq
          git config --global user.email "github-actions@github.com"
          git config --global user.name "Store Sync"
          
          config='${{ toJson(fromJson(steps.config.outputs.config)) }}'
          # В реальном workflow используйте jq для разбора
          # Ниже — псевдокод, в рабочем файле будет полный скрипт
          echo "См. полный скрипт в следующей версии файла"
```

Полноценный workflow (со скриптом sync) см. в разделе «Приложение A» ниже.

---

## Шаг 3. Секрет для push в другие репо

1. GitHub → Settings → Developer settings → Personal access tokens.
2. Создайте токен с правами `repo` (полный доступ к репозиториям).
3. В основном репо: Settings → Secrets and variables → Actions → New repository secret.
4. Имя: `STORE_SYNC_TOKEN`, значение — токен.

Токен нужен, чтобы Action мог пушить в deploy-репо. Используйте fine-grained token с доступом только к нужным репо, если возможно.

---

## Шаг 4. Добавление нового магазина

### 4.1 Создать deploy-репо

1. GitHub → New repository.
2. Имя: `store-{subdomain}` (например, `store-my-shop`).
3. Public, без README.
4. Создать репо.

### 4.2 Включить GitHub Pages

1. В новом репо: Settings → Pages.
2. Source: Deploy from a branch.
3. Branch: `main` (или `gh-pages`), folder: `/ (root)`.

### 4.3 Добавить репо в конфиг

В `store-deploy-config.json`:

```json
{
  "deployRepos": [
    { "repo": "YOUR_USERNAME/store-test-shop", "subdomain": "test-shop" },
    { "repo": "YOUR_USERNAME/store-my-shop", "subdomain": "my-shop" }
  ],
  "githubPagesBase": "YOUR_USERNAME.github.io"
}
```

### 4.4 DNS в reg.ru

1. Reg.ru → Управление зоной → Добавить запись.
2. Тип: **CNAME**.
3. Имя: `my-shop` (поддомен без домена).
4. Значение: `YOUR_USERNAME.github.io`.
5. TTL: 3600.

### 4.5 Запустить синхронизацию

- Либо push в `main` (если изменили store-файлы).
- Либо Actions → Store Sync to Deploy Repos → Run workflow.

После деплоя в репо появится `CNAME` с `my-shop.my-3d-print.ru`. GitHub Pages автоматически привяжет кастомный домен.

---

## Шаг 5. Порядок работ (чеклист)

- [ ] Создать `store-deploy-config.json`.
- [ ] Создать Personal Access Token.
- [ ] Добавить секрет `STORE_SYNC_TOKEN`.
- [ ] Создать deploy-репо `store-test-shop`.
- [ ] Включить GitHub Pages в deploy-репо.
- [ ] Добавить workflow `.github/workflows/store-sync.yml`.
- [ ] Добавить CNAME в reg.ru для `test-shop`.
- [ ] Запустить workflow вручную.
- [ ] Проверить: `https://test-shop.my-3d-print.ru` открывается.

---

## Manager и Landing

- **Manager** (`app.my-3d-print.ru`) — один репо, CNAME `app.my-3d-print.ru`. Синхронизация не нужна.
- **Landing** (`my-3d-print.ru`) — отдельный репо или тот же, что Manager (через редирект). Один репо, один CNAME.
- **Store** — множество deploy-репо, sync через Actions (этот план).

Manager и Landing можно перевести на GitHub Pages отдельно: создать репо, настроить CNAME, добавить DNS в reg.ru.

---

## Миграция на reg.ru при росте клиентов

Когда появится платный хостинг reg.ru:

1. **Лендинг + Manager + Store** — на VPS/хостинге reg.ru.
2. **Nginx** — wildcard для Store (VPS РФ).
3. **DNS** — A/CNAME на IP reg.ru, wildcard для поддоменов.
4. GitHub Pages — можно оставить как fallback или отключить.
5. **Firebase** — без изменений, доступ с любого хоста.

GitHub Actions sync станет не нужен: один деплой на reg.ru, все поддомены работают из одной папки.

---

## Приложение A. Workflow уже создан

Файл `.github/workflows/store-sync.yml` создан и содержит полную логику sync.  
Перед первым запуском:

1. Замените `YOUR_USERNAME` в `store-deploy-config.json` на ваш GitHub username/org.
2. Добавьте секрет `STORE_SYNC_TOKEN`.
3. Создайте deploy-репо и добавьте CNAME в reg.ru.
