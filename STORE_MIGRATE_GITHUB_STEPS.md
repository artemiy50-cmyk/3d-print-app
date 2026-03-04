# Переход на GitHub Pages и reg.ru — пошаговая инструкция

Цель: вернуть DNS на reg.ru и хостить сайты на GitHub Pages (обход блокировок).

---

## Что меняется

| Было | Станет |
|------|--------|
| NS: Cloudflare (aspen, sean) | NS: reg.ru (ns1.reg.ru, ns2.reg.ru) |
| Хостинг: Vercel | Хостинг: GitHub Pages |
| DNS: Cloudflare | DNS: reg.ru (управление зоной) |

---

## ЧАСТЬ 1. Перенастройка сети (reg.ru)

### Шаг 1.1. Вернуть NS на reg.ru

1. Откройте [reg.ru](https://www.reg.ru) → войдите в **Личный кабинет**.
2. **Мои домены** → выберите **my-3d-print.ru**.
3. **«Смена DNS-серверов»** (или «DNS-серверы»).
4. Замените Cloudflare на reg.ru:
   - Было: `aspen.ns.cloudflare.com`, `sean.ns.cloudflare.com`
   - Станет: `ns1.reg.ru`, `ns2.reg.ru`
5. **Сохранить**.

> ⏱ Подождите 30–60 минут (иногда до 24 часов), пока делегирование обновится.  
> Проверка: `nslookup -type=ns my-3d-print.ru` — должны вернуться `ns1.reg.ru`, `ns2.reg.ru`.

---

### Шаг 1.2. Добавить DNS-записи в reg.ru

**Важно:** зону DNS снова управляет reg.ru. Записи добавляются в reg.ru.

1. **reg.ru** → **Мои домены** → **my-3d-print.ru** → **«Управление зоной»**.
2. Если там есть старые записи — удалите лишние. Нужно добавить:

| Тип | Имя | Значение | Назначение |
|-----|-----|----------|------------|
| A | `@` | `185.199.108.153` | Apex (лендинг) — GitHub Pages |
| A | `@` | `185.199.109.153` | Apex (2-й IP GitHub) |
| A | `@` | `185.199.110.153` | Apex (3-й IP GitHub) |
| A | `@` | `185.199.111.153` | Apex (4-й IP GitHub) |
| CNAME | `www` | `YOUR_USERNAME.github.io` | www (лендинг) |
| CNAME | `app` | `YOUR_USERNAME.github.io` | Manager |
| CNAME | `test-shop` | `YOUR_USERNAME.github.io` | Store |

Замените `YOUR_USERNAME` на ваш GitHub username (или имя организации).

**Apex (4 A-записи):** GitHub рекомендует 4 IP. В reg.ru добавьте 4 записи A с именем `@` и разными значениями (185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153). Если reg.ru позволяет только одну A-запись для apex, используйте `185.199.108.153`.

3. **Сохранить изменения**.

---

## ЧАСТЬ 2. Репозитории на GitHub

### Шаг 2.1. Создать репо для лендинга (my-3d-print.ru, www)

1. GitHub → **New repository**.
2. Имя: `landing` или `3d-print-landing` (любое).
3. Public, можно без README.
4. Клонируйте репо и скопируйте в него:
   - Файлы лендинга (HTML, CSS, JS, favicon — из проекта 3d-print-landing на Vercel).
5. В корне репо создайте файл **CNAME** (без расширения), одна строка:
   ```
   my-3d-print.ru
   ```
6. **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main` → folder `/ (root)` → **Save**.
7. Залейте код и сделайте push.

---

### Шаг 2.2. Создать репо для Manager (app.my-3d-print.ru)

1. GitHub → **New repository**.
2. Имя: `3d-print-app` или `manager` (любое).
3. Public.
4. Скопируйте в репо файлы Manager: `index.html`, `script.js`, `style.css`, `favicon.ico` и др.
5. В корне создайте **CNAME**:
   ```
   app.my-3d-print.ru
   ```
6. **Settings** → **Pages** → Deploy from branch `main` → **Save**.
7. Push кода.

---

### Шаг 2.3. Создать репо для Store (test-shop.my-3d-print.ru)

1. GitHub → **New repository**.
2. Имя: `store-test-shop` (или `store-{subdomain}`).
3. Public.
4. Скопируйте: `store.html`, `store.js`, `style.css`, `favicon.ico`.
5. **Переименуйте** `store.html` → `index.html` (чтобы корень поддомена открывал Store).
6. Создайте **CNAME**:
   ```
   test-shop.my-3d-print.ru
   ```
7. **Settings** → **Pages** → Deploy from branch `main` → **Save**.
8. Push кода.

---

### Шаг 2.4. Подключить GitHub Actions sync (опционально)

Чтобы при изменении Store в основном репо автоматически обновлять deploy-репо:

1. В основном репо (`3d-print-app`) должны быть:
   - `store-deploy-config.json`
   - `.github/workflows/store-sync.yml`
2. Добавьте секрет `STORE_SYNC_TOKEN` (Personal Access Token с правами `repo`).
3. Добавьте deploy-репо в `store-deploy-config.json`.
4. При push в `store.html`, `store.js`, `style.css` Action скопирует код в deploy-репо.

Подробнее: `STORE_GITHUB_PAGES_PLAN.md`.

---

## ЧАСТЬ 3. Проверка

### Шаг 3.1. Проверить NS

```powershell
nslookup -type=ns my-3d-print.ru
```

Ожидаемо: `ns1.reg.ru`, `ns2.reg.ru`.

---

### Шаг 3.2. Проверить A-запись apex

```powershell
nslookup my-3d-print.ru
```

Ожидаемо: IP из диапазона 185.199.108.x – 185.199.111.x (GitHub).

---

### Шаг 3.3. Проверить CNAME для app и test-shop

```powershell
nslookup app.my-3d-print.ru
nslookup test-shop.my-3d-print.ru
```

Ожидаемо: указание на `username.github.io` и далее на IP GitHub.

---

### Шаг 3.4. Открыть сайты в браузере

- https://my-3d-print.ru — лендинг
- https://app.my-3d-print.ru — Manager
- https://test-shop.my-3d-print.ru — Store

---

## Краткий чеклист

- [ ] Шаг 1.1: NS в reg.ru переведены на ns1.reg.ru, ns2.reg.ru
- [ ] Шаг 1.2: В reg.ru добавлены A (apex) и CNAME (www, app, test-shop)
- [ ] Шаг 2.1: Репо лендинга создан, CNAME `my-3d-print.ru`, Pages включены
- [ ] Шаг 2.2: Репо Manager создан, CNAME `app.my-3d-print.ru`, Pages включены
- [ ] Шаг 2.3: Репо Store создан, CNAME `test-shop.my-3d-print.ru`, Pages включены
- [ ] Шаг 2.4 (опц.): GitHub Actions sync настроен
- [ ] Шаг 3: Сайты открываются без VPN
