# 3D Print Manager & Store

Manager (приложение) и Store (публичные магазины на поддоменах).

---

## Документация

| Файл | Описание |
|------|----------|
| **STORE_MIGRATE_GITHUB_STEPS.md** | Пошаговая миграция на GitHub Pages и reg.ru (лендинг, Manager, Store) |
| **STORE_GITHUB_PAGES_PLAN.md** | План deploy Store: один main-репо → GitHub Actions sync → deploy-репо по поддоменам |
| **STORE_PHASE5.md** | План фазы 5: UX/UI, шаблоны магазина |

---

## Структура

- **index.html**, **script.js** — Manager (app.my-3d-print.ru)
- **store.html**, **store.js** — Store SPA (test-shop.my-3d-print.ru и др.)
- **store-deploy-config.json** — конфиг deploy-репо для GitHub Actions
- **firebase.json**, **database.rules.json** — Firebase
