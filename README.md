# 3D Print Manager & Store

Manager (приложение) и Store (публичные магазины на поддоменах).

---

## Документация

| Файл | Описание |
|------|----------|
| **STORE_GITHUB_PAGES_PLAN.md** | План deploy Store: один main-репо → GitHub Actions sync → deploy-репо по поддоменам |
| **STORE_PRODUCTION_SETUP.md** | Вывод магазина в прод на поддомене (GitHub Pages, sync, DNS/reg.ru); плейсхолдеры вместо личных имён |
| **BACKUP.md** | Состав бэкапов (приложение и `backup.py`), сценарии восстановления |
| **CLOUDINARY_CLEANER.md** | Логика `cleaner.py`, секреты и зависимости |
| **backup.py**, **cleaner.py** | Эталонные скрипты для отдельного приватного репозитория с CI |

---

## Структура

- **index.html**, **script.js** — Manager (app.my-3d-print.ru)
- **store.html**, **store.js** — Store SPA (test-shop.my-3d-print.ru и др.)
- **store-deploy-config.json** — конфиг deploy-репо для GitHub Actions
- **firebase.json**, **database.rules.json** — Firebase
