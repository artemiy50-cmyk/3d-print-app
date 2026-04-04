"""
Плановый бэкап Firebase Realtime Database для 3d-print-app.

Полный снимок (/) уже содержит всё: users, storeOrders, storesBySubdomain, storeOrderSeq.
Файл user_{uid}.json повторяет формат экспорта из приложения: корень = users/{uid}/data,
служебные ключи _subscription_backup и _storeBackup (camelCase), чтобы пользователь мог
восстановить снимок через кнопку «Восстановить».

Зависимости: pip install firebase-admin

Переменные окружения (опционально):
  FIREBASE_SERVICE_ACCOUNT — JSON сервисного аккаунта (строка). Читается в память, файл в репозитории не создаётся.
  FIREBASE_KEY_PATH — путь к файлу ключа, если предпочитаете файл (по умолчанию firebase-key.json рядом со скриптом).
"""

from __future__ import annotations

import copy
import json
import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, db

# Настройки (при необходимости переопределите через env)
FIREBASE_KEY_PATH = os.environ.get("FIREBASE_KEY_PATH", "firebase-key.json")
FIREBASE_DB_URL = os.environ.get(
    "FIREBASE_DB_URL",
    "https://d-print-app-3655b-default-rtdb.europe-west1.firebasedatabase.app",
)


def _get_firebase_certificate():
    """Файл ключа или FIREBASE_SERVICE_ACCOUNT (без записи секрета на диск)."""
    if os.path.exists(FIREBASE_KEY_PATH):
        return credentials.Certificate(FIREBASE_KEY_PATH)
    key_content = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not key_content:
        print(
            "Ошибка: нет файла "
            + FIREBASE_KEY_PATH
            + " и переменной FIREBASE_SERVICE_ACCOUNT",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        data = json.loads(key_content)
    except json.JSONDecodeError as e:
        print(
            "Ошибка: FIREBASE_SERVICE_ACCOUNT не является валидным JSON: " + str(e),
            file=sys.stderr,
        )
        sys.exit(1)
    if not isinstance(data, dict):
        print("Ошибка: JSON в FIREBASE_SERVICE_ACCOUNT должен быть объектом.", file=sys.stderr)
        sys.exit(1)
    return credentials.Certificate(data)


def _init_firebase() -> None:
    if not firebase_admin._apps:
        cred = _get_firebase_certificate()
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})


def _store_orders_for_owner(full_data: Dict[str, Any], owner_uid: str) -> List[Dict[str, Any]]:
    """Заказы владельца в том же виде, что и в экспорте приложения: массив { id, ...поля }."""
    orders = full_data.get("storeOrders") or {}
    if not isinstance(orders, dict):
        return []
    out: List[Dict[str, Any]] = []
    for oid, payload in orders.items():
        if isinstance(payload, dict) and payload.get("ownerUid") == owner_uid:
            row = dict(payload)
            row["id"] = oid
            out.append(row)
    return out


def _stores_by_subdomain_for_user(
    full_data: Dict[str, Any], user_data: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Запись storesBySubdomain/{subdomain}, если в store указан поддомен."""
    store = user_data.get("store")
    if not isinstance(store, dict):
        return None
    sub = store.get("subdomain")
    if not sub:
        return None
    root = full_data.get("storesBySubdomain") or {}
    if not isinstance(root, dict):
        return None
    entry = root.get(sub)
    if entry is None:
        return None
    return {sub: entry}


def build_user_backup_payload(
    uid: str, user_data: Dict[str, Any], full_data: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Собирает объект для user_{uid}.json: основное приложение (data) + метаданные.
    Не мутирует full_data / user_data (используется deepcopy для ветки data).
    """
    raw_data = user_data.get("data")
    has_im = any(
        user_data.get(k) is not None
        for k in ("store", "storeProducts", "storeCategories", "storeAttributeDefinitions")
    )

    if raw_data is not None:
        payload = copy.deepcopy(raw_data)
    elif has_im:
        payload = {}
    else:
        return None

    if "subscription" in user_data:
        payload["_subscription_backup"] = copy.deepcopy(user_data["subscription"])

    store_orders_list = _store_orders_for_owner(full_data, uid)
    # store — deepcopy целиком: SEO, Яндекс-верификация, Метрика и пр. (как в collectStoreBackup в script.js).
    store_backup = {
        "store": copy.deepcopy(user_data.get("store")),
        "storeProducts": copy.deepcopy(user_data.get("storeProducts")),
        "storeCategories": copy.deepcopy(user_data.get("storeCategories")),
        "storeAttributeDefinitions": copy.deepcopy(user_data.get("storeAttributeDefinitions")),
        "storeOrders": store_orders_list,
        "storesBySubdomain": _stores_by_subdomain_for_user(full_data, user_data),
    }

    def _store_block_nonempty(v: Any) -> bool:
        if v is None:
            return False
        if isinstance(v, (dict, list)) and len(v) == 0:
            return False
        return True

    if any(_store_block_nonempty(v) for v in store_backup.values()):
        # Ключ как в script.js (import «Восстановить»)
        payload["_storeBackup"] = store_backup

    return payload


def backup() -> None:
    print("--- СТАРТ БЭКАПА ---")
    _init_firebase()

    ref = db.reference("/")
    full_data = ref.get()

    if not full_data:
        print("⚠️ База пуста или ошибка доступа")
        return

    if not isinstance(full_data, dict):
        print("⚠️ Неожиданный формат корня БД")
        return

    timestamp_str = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_root = "backups"
    run_folder = os.path.join(backup_root, timestamp_str)
    os.makedirs(run_folder, exist_ok=True)

    full_path = os.path.join(run_folder, "FULL_DB.json")
    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)
    print(f"✅ Полный дамп сохранен: {full_path}")
    print(
        "   (включая storeOrders, storesBySubdomain, storeOrderSeq и всех пользователей целиком)"
    )

    users = full_data.get("users") or {}
    if not isinstance(users, dict):
        users = {}

    user_count = 0
    for uid, user_data in users.items():
        if not isinstance(user_data, dict):
            continue
        payload = build_user_backup_payload(uid, user_data, full_data)
        if payload is None:
            continue
        user_file = os.path.join(run_folder, f"user_{uid}.json")
        with open(user_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        user_count += 1

    print(f"✅ Сохранено пользовательских снимков (data + витрина/заказы): {user_count}")
    print(f"📁 Папка бэкапа: {run_folder}")
    print("--- БЭКАП ЗАВЕРШЕН ---")


if __name__ == "__main__":
    backup()
